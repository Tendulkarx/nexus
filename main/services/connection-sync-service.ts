/**
 * Cross-device sync of saved connection profiles through a user-chosen
 * folder (iCloud Drive, Dropbox, or anywhere else already synced by some
 * other means — Nexus only reads/writes one file there and never talks to a
 * sync backend itself). See ConnectionSyncStatus in ipc-contract.ts for the
 * user-facing shape and the security rationale.
 *
 * IMPORTANT: the safeStorage-encrypted `secret` field on a stored
 * ConnectionProfile is bound to THIS machine's login Keychain — it is not
 * decryptable on another Mac (see credential-vault.ts). The shared sync file
 * therefore never contains a safeStorage ciphertext. Instead the whole
 * snapshot (including secrets, decrypted to plaintext in memory only) is
 * encrypted as one blob with a key derived from a user-chosen sync
 * passphrase via scrypt — connection-export-crypto.ts, the exact module
 * connections:export/import already use for the same "safeStorage doesn't
 * travel" problem. Getting this distinction backwards would either silently
 * break sync (writing safeStorage blobs nobody else can read) or leak
 * secrets in plaintext into a third-party-synced folder, so every
 * plaintext<->ciphertext boundary below is deliberate.
 *
 * Conflict resolution: last-write-wins per record by `updatedAt`, with
 * conflicts reported (never silently dropped) via `lastConflictNames` — see
 * connection-sync-merge.ts's doc comment for the full reasoning. A
 * three-way merge needs a baseline (the state as of the last successful
 * sync) to tell "only one side changed" apart from "both changed
 * independently"; unlike sync-manager.ts's file diffing (which has no
 * reliable place to keep one), this module owns both sync partners' data
 * end-to-end, so it just persists that baseline locally.
 */
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import { type FSWatcher, watch } from "fs";
import * as path from "path";

import { logger } from "../logger.js";

import { connectionStore } from "./connection-store.js";
import { credentialVault } from "./credential-vault.js";
import {
  generateKdfParams,
  deriveExportKey,
  encryptSecret,
  decryptSecret,
  type KdfParams,
  type EncryptedPayload,
} from "./connection-export-crypto.js";
import { DataStore } from "./data-store.js";
import { emitToRenderer } from "./ipc-emitter.js";
import { mergeConnectionSyncRecords, type SyncRecord } from "./connection-sync-merge.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type {
  AuthType,
  ConnectionProfile,
  ConnectionSyncConfigInput,
  ConnectionSyncStatus,
  Folder,
  JumpHost,
  Protocol,
} from "@shared/ipc-contract";

const SYNC_FILE_NAME = "nexus-connections-sync.json";
const LOCAL_CHANGE_DEBOUNCE_MS = 1_000;
const WATCH_DEBOUNCE_MS = 1_500;

// ── Local (never synced) bookkeeping ────────────────────────────────────

interface BaselineRecord {
  name: string;
  updatedAt: number;
  deleted: boolean;
}

interface SyncStateFile {
  folderPath: string | null;
  enabled: boolean;
  /** safeStorage-encrypted base64 — same handling as every other secret field in this app (credential-vault.ts, app-settings-store.ts's AI API key). Entered once per device; NEVER sent to the renderer or written into the synced file. */
  passphraseSecret: string | null;
  deviceId: string;
  lastSyncedAt: number | null;
  lastConflictNames: string[];
  lastError: string | null;
  baselineProfiles: Record<string, BaselineRecord>;
  baselineFolders: Record<string, BaselineRecord>;
}

const DEFAULT_STATE: SyncStateFile = {
  folderPath: null,
  enabled: false,
  passphraseSecret: null,
  deviceId: randomUUID(),
  lastSyncedAt: null,
  lastConflictNames: [],
  lastError: null,
  baselineProfiles: {},
  baselineFolders: {},
};

// ── The shared file's contents (written into the sync folder) ──────────

interface PortableJumpHost {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath: string | null;
  /** Plaintext — safe here only because the *entire* envelope this sits inside is encrypted at rest; see the module doc comment. */
  secret: string | null;
}

interface PortableProfile {
  id: string;
  name: string;
  updatedAt: number;
  deleted: boolean;
  protocol?: Protocol;
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  privateKeyPath?: string | null;
  folderId?: string | null;
  tags?: string[];
  defaultRemotePath?: string | null;
  color?: string | null;
  agentForward?: boolean;
  onConnectCommand?: string | null;
  /** Plaintext — see PortableJumpHost.secret. */
  secret?: string | null;
  jumpHost?: PortableJumpHost | null;
}

interface PortableFolder {
  id: string;
  name: string;
  updatedAt: number;
  deleted: boolean;
  parentId?: string | null;
}

interface SyncPayload {
  writtenAt: number;
  deviceId: string;
  profiles: PortableProfile[];
  folders: PortableFolder[];
}

interface SyncEnvelope {
  version: 1;
  kdf: KdfParams;
  payload: EncryptedPayload;
}

function isSyncEnvelope(value: unknown): value is SyncEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as SyncEnvelope).version === 1 &&
    typeof (value as SyncEnvelope).kdf === "object" &&
    typeof (value as SyncEnvelope).payload === "object"
  );
}

// ── Profile/folder <-> portable-record conversion ───────────────────────

async function profileToPortable(profile: ConnectionProfile): Promise<PortableProfile> {
  const secret = profile.secret ? await credentialVault.decrypt(profile.secret) : null;
  const jumpHost: PortableJumpHost | null = profile.jumpHost
    ? {
        host: profile.jumpHost.host,
        port: profile.jumpHost.port,
        username: profile.jumpHost.username,
        authType: profile.jumpHost.authType,
        privateKeyPath: profile.jumpHost.privateKeyPath ?? null,
        secret: profile.jumpHost.secret ? await credentialVault.decrypt(profile.jumpHost.secret) : null,
      }
    : null;

  return {
    id: profile.id,
    name: profile.name,
    updatedAt: profile.updatedAt ?? 0,
    deleted: false,
    protocol: profile.protocol,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authType: profile.authType,
    privateKeyPath: profile.privateKeyPath ?? null,
    folderId: profile.folderId ?? null,
    tags: profile.tags,
    defaultRemotePath: profile.defaultRemotePath ?? null,
    color: profile.color ?? null,
    agentForward: profile.agentForward ?? false,
    onConnectCommand: profile.onConnectCommand ?? null,
    secret,
    jumpHost,
  };
}

async function portableToProfile(portable: PortableProfile): Promise<ConnectionProfile> {
  const secret = portable.secret ? await credentialVault.encrypt(portable.secret) : null;
  const jumpHost: JumpHost | null = portable.jumpHost
    ? {
        host: portable.jumpHost.host,
        port: portable.jumpHost.port,
        username: portable.jumpHost.username,
        authType: portable.jumpHost.authType,
        privateKeyPath: portable.jumpHost.privateKeyPath ?? null,
        secret: portable.jumpHost.secret ? await credentialVault.encrypt(portable.jumpHost.secret) : null,
      }
    : null;

  return {
    id: portable.id,
    name: portable.name,
    protocol: portable.protocol ?? "sftp",
    host: portable.host ?? "",
    port: portable.port ?? 22,
    username: portable.username ?? "",
    authType: portable.authType ?? "password",
    privateKeyPath: portable.privateKeyPath ?? null,
    folderId: portable.folderId ?? null,
    tags: portable.tags ?? [],
    defaultRemotePath: portable.defaultRemotePath ?? null,
    color: portable.color ?? null,
    lastConnectedAt: null,
    updatedAt: portable.updatedAt,
    secret,
    jumpHost,
    agentForward: portable.agentForward ?? false,
    onConnectCommand: portable.onConnectCommand ?? null,
  };
}

function profileToSyncRecord(portable: PortableProfile): SyncRecord<PortableProfile> {
  return { id: portable.id, name: portable.name, updatedAt: portable.updatedAt, deleted: portable.deleted, data: portable.deleted ? null : portable };
}

function folderToSyncRecord(folder: PortableFolder): SyncRecord<PortableFolder> {
  return { id: folder.id, name: folder.name, updatedAt: folder.updatedAt, deleted: folder.deleted, data: folder.deleted ? null : folder };
}

export class ConnectionSyncService {
  private store = new DataStore<SyncStateFile>("connection-sync-state.json", DEFAULT_STATE);
  private watcher: FSWatcher | null = null;
  private watchedFolderPath: string | null = null;
  private localChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private rerunRequested = false;

  async init(): Promise<void> {
    const state = await this.store.load();
    if (state.enabled && state.folderPath) {
      this.startWatcher(state.folderPath);
      void this.runCycle();
    }
  }

  async getStatus(): Promise<ConnectionSyncStatus> {
    const state = await this.store.load();
    return this.toStatus(state);
  }

  async configure(input: ConnectionSyncConfigInput): Promise<ConnectionSyncStatus> {
    const state = await this.store.load();
    state.folderPath = input.folderPath;
    if (input.passphrase) {
      state.passphraseSecret = await credentialVault.encrypt(input.passphrase);
    }
    if (input.enabled && !state.passphraseSecret) {
      throw new Error("A sync passphrase is required the first time sync is enabled on this device");
    }
    state.enabled = input.enabled;
    state.lastError = null;
    await this.store.save(state);

    if (state.enabled && state.folderPath) {
      this.startWatcher(state.folderPath);
      await this.runCycle();
    } else {
      this.stopWatcher();
    }
    return this.getStatus();
  }

  async disable(): Promise<ConnectionSyncStatus> {
    const state = await this.store.load();
    state.enabled = false;
    await this.store.save(state);
    this.stopWatcher();
    return this.toStatus(state);
  }

  async syncNow(): Promise<ConnectionSyncStatus> {
    await this.runCycle();
    return this.getStatus();
  }

  /** Called by main/handlers/connections.ts after any local profile/folder mutation. Debounced so a burst of edits triggers one cycle, not one per field. */
  notifyLocalChange(): void {
    if (this.localChangeTimer) clearTimeout(this.localChangeTimer);
    this.localChangeTimer = setTimeout(() => {
      this.localChangeTimer = null;
      void this.runCycle();
    }, LOCAL_CHANGE_DEBOUNCE_MS);
  }

  private startWatcher(folderPath: string): void {
    if (this.watcher && this.watchedFolderPath === folderPath) return;
    this.stopWatcher();
    try {
      this.watcher = watch(folderPath, { persistent: false }, (_event, filename) => {
        if (filename && filename !== SYNC_FILE_NAME) return;
        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(() => {
          this.watchDebounceTimer = null;
          void this.runCycle();
        }, WATCH_DEBOUNCE_MS);
      });
      this.watchedFolderPath = folderPath;
    } catch (err) {
      logger.warn("connection-sync-service", "Failed to watch sync folder", err);
    }
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    this.watchedFolderPath = null;
  }

  private toStatus(state: SyncStateFile): ConnectionSyncStatus {
    return {
      enabled: state.enabled,
      folderPath: state.folderPath,
      hasPassphrase: Boolean(state.passphraseSecret),
      syncing: this.syncing,
      lastSyncedAt: state.lastSyncedAt,
      lastConflictNames: state.lastConflictNames,
      lastError: state.lastError,
    };
  }

  private async emitStatus(): Promise<void> {
    const state = await this.store.load();
    emitToRenderer(IPC.connectionSync.statusChanged, this.toStatus(state));
  }

  private async runCycle(): Promise<void> {
    if (this.syncing) {
      this.rerunRequested = true;
      return;
    }
    this.syncing = true;
    try {
      await this.emitStatus();
      await this.doSync();
    } finally {
      this.syncing = false;
      await this.emitStatus();
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.runCycle();
      }
    }
  }

  private async doSync(): Promise<void> {
    const state = await this.store.load();
    if (!state.enabled || !state.folderPath || !state.passphraseSecret) return;

    const passphrase = await credentialVault.decrypt(state.passphraseSecret);
    if (!passphrase) {
      state.lastError = "Could not unlock the sync passphrase on this device";
      await this.store.save(state);
      return;
    }

    const filePath = path.join(state.folderPath, SYNC_FILE_NAME);

    let remotePayload: SyncPayload | null;
    let kdf: KdfParams;
    try {
      const existing = await this.readEnvelope(filePath, passphrase);
      remotePayload = existing?.payload ?? null;
      kdf = existing?.kdf ?? generateKdfParams();
    } catch (err) {
      logger.warn("connection-sync-service", "Failed to read/decrypt sync file", err);
      state.lastError =
        err instanceof Error && err.message === "WRONG_PASSPHRASE"
          ? "Incorrect sync passphrase — could not decrypt the shared file"
          : "Could not read the sync folder — check it still exists and is writable";
      await this.store.save(state);
      return;
    }

    const { profiles: localProfiles, folders: localFolders } = await connectionStore.listRaw();
    const localPortableProfiles = await Promise.all(localProfiles.map(profileToPortable));
    const localPortableFolders: PortableFolder[] = localFolders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId ?? null,
      updatedAt: f.updatedAt ?? 0,
      deleted: false,
    }));

    const baselineProfiles = this.baselineToRecords<PortableProfile>(state.baselineProfiles);
    const baselineFolders = this.baselineToRecords<PortableFolder>(state.baselineFolders);

    const localProfileRecords = this.buildLocalView(localPortableProfiles, profileToSyncRecord, baselineProfiles);
    const localFolderRecords = this.buildLocalView(localPortableFolders, folderToSyncRecord, baselineFolders);

    const remoteProfileRecords = new Map(
      (remotePayload?.profiles ?? []).map((p) => [p.id, profileToSyncRecord(p)] as const),
    );
    const remoteFolderRecords = new Map(
      (remotePayload?.folders ?? []).map((f) => [f.id, folderToSyncRecord(f)] as const),
    );

    const profileMerge = mergeConnectionSyncRecords(baselineProfiles, localProfileRecords, remoteProfileRecords);
    const folderMerge = mergeConnectionSyncRecords(baselineFolders, localFolderRecords, remoteFolderRecords);

    // Only touch connectionStore for ids where the resolved outcome actually
    // differs from what's already stored locally — every write re-encrypts
    // the secret via safeStorage and hits disk, so a cycle where local
    // already agrees with the resolved state (the common case once both
    // sides have converged) should be a no-op rather than rewriting
    // everything with fresh, functionally-identical ciphertext every time
    // the watcher or a debounce timer fires.
    const localProfileById = new Map(localProfiles.map((p) => [p.id, p]));
    const localFolderById = new Map(localFolders.map((f) => [f.id, f]));

    const upsertProfiles: ConnectionProfile[] = [];
    const deleteProfileIds: string[] = [];
    for (const record of profileMerge.resolved.values()) {
      const current = localProfileById.get(record.id);
      if (record.deleted) {
        if (current) deleteProfileIds.push(record.id);
      } else if (record.data && current?.updatedAt !== record.updatedAt) {
        upsertProfiles.push(await portableToProfile(record.data));
      }
    }

    const upsertFolders: Folder[] = [];
    for (const record of folderMerge.resolved.values()) {
      const current = localFolderById.get(record.id);
      if (!record.deleted && record.data && current?.updatedAt !== record.updatedAt) {
        upsertFolders.push({
          id: record.data.id,
          name: record.data.name,
          parentId: record.data.parentId ?? null,
          updatedAt: record.data.updatedAt,
        });
      }
    }
    // Folder deletions are intentionally not propagated — see the module
    // doc comment / report: losing a folder LABEL is low-severity and this
    // keeps the scope to what profile sync actually needs (folderId still
    // round-trips; an orphaned folderId just shows as "no folder" locally,
    // same as connections:import already tolerates).

    await connectionStore.applySync({ upsertProfiles, deleteProfileIds, upsertFolders });

    const outgoingPayload: SyncPayload = {
      writtenAt: Date.now(),
      deviceId: state.deviceId,
      profiles: [...profileMerge.resolved.values()].map((r) =>
        r.deleted ? this.tombstonePortableProfile(r) : r.data!,
      ),
      folders: [...folderMerge.resolved.values()].map((r) =>
        r.deleted ? this.tombstonePortableFolder(r) : r.data!,
      ),
    };

    if (JSON.stringify(outgoingPayload.profiles) !== JSON.stringify(remotePayload?.profiles ?? []) ||
        JSON.stringify(outgoingPayload.folders) !== JSON.stringify(remotePayload?.folders ?? [])) {
      await this.writeEnvelope(filePath, passphrase, kdf, outgoingPayload);
    }

    state.baselineProfiles = this.recordsToBaseline(profileMerge.resolved);
    state.baselineFolders = this.recordsToBaseline(folderMerge.resolved);
    state.lastSyncedAt = Date.now();
    state.lastConflictNames = [...profileMerge.conflicts, ...folderMerge.conflicts].map((c) => c.name);
    state.lastError = null;
    await this.store.save(state);
  }

  private tombstonePortableProfile(record: SyncRecord<PortableProfile>): PortableProfile {
    return { id: record.id, name: record.name, updatedAt: record.updatedAt, deleted: true };
  }

  private tombstonePortableFolder(record: SyncRecord<PortableFolder>): PortableFolder {
    return { id: record.id, name: record.name, updatedAt: record.updatedAt, deleted: true };
  }

  private baselineToRecords<T>(baseline: Record<string, BaselineRecord>): Map<string, SyncRecord<T>> {
    return new Map(
      Object.entries(baseline).map(([id, b]) => [
        id,
        { id, name: b.name, updatedAt: b.updatedAt, deleted: b.deleted, data: null } satisfies SyncRecord<T>,
      ]),
    );
  }

  private recordsToBaseline<T>(records: Map<string, SyncRecord<T>>): Record<string, BaselineRecord> {
    const out: Record<string, BaselineRecord> = {};
    for (const [id, r] of records) {
      out[id] = { name: r.name, updatedAt: r.updatedAt, deleted: r.deleted };
    }
    return out;
  }

  /**
   * Builds this side's current view for the merge: every live local record,
   * plus a synthesized tombstone for any id the baseline knew as alive but
   * that's now missing locally (i.e. deleted since the last sync). An id the
   * baseline already had as deleted and that's still absent just carries the
   * baseline's tombstone forward unchanged — no new "deletion event", so it
   * doesn't look like a fresh local change every cycle.
   */
  private buildLocalView<T extends { id: string }>(
    live: T[],
    toRecord: (item: T) => SyncRecord<T>,
    baseline: Map<string, SyncRecord<T>>,
  ): Map<string, SyncRecord<T>> {
    const view = new Map<string, SyncRecord<T>>();
    const liveIds = new Set<string>();
    for (const item of live) {
      liveIds.add(item.id);
      view.set(item.id, toRecord(item));
    }
    for (const [id, baseRecord] of baseline) {
      if (liveIds.has(id)) continue;
      if (baseRecord.deleted) {
        view.set(id, baseRecord);
      } else {
        view.set(id, { id, name: baseRecord.name, updatedAt: Date.now(), deleted: true, data: null });
      }
    }
    return view;
  }

  private async readEnvelope(
    filePath: string,
    passphrase: string,
  ): Promise<{ payload: SyncPayload; kdf: KdfParams } | null> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new Error("Not a valid Nexus sync file");
    }
    if (!isSyncEnvelope(envelope)) throw new Error("Not a valid Nexus sync file");

    const key = deriveExportKey(passphrase, envelope.kdf);
    let json: string;
    try {
      json = decryptSecret(envelope.payload, key);
    } catch {
      throw new Error("WRONG_PASSPHRASE");
    }
    return { payload: JSON.parse(json) as SyncPayload, kdf: envelope.kdf };
  }

  private async writeEnvelope(filePath: string, passphrase: string, kdf: KdfParams, payload: SyncPayload): Promise<void> {
    const key = deriveExportKey(passphrase, kdf);
    const envelope: SyncEnvelope = {
      version: 1,
      kdf,
      payload: encryptSecret(JSON.stringify(payload), key),
    };
    await fs.writeFile(filePath, JSON.stringify(envelope, null, 2), "utf-8");
  }
}

export const connectionSyncService = new ConnectionSyncService();
