/**
 * Persists connection profiles and folders, encrypting each profile's secret
 * with the CredentialVault. All renderer-facing results are DTOs with the
 * secret stripped (replaced by a `hasSecret` flag).
 */
import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";
import { credentialVault } from "./credential-vault.js";

import type {
  ConnectionInput,
  ConnectionProfile,
  ConnectionProfileDTO,
  ConnectionsListResult,
  Folder,
  JumpHost,
  JumpHostDTO,
  JumpHostInput,
} from "@shared/ipc-contract";

interface ConnectionFile {
  version: number;
  folders: Folder[];
  profiles: ConnectionProfile[];
}

const DEFAULT_FILE: ConnectionFile = { version: 1, folders: [], profiles: [] };

function toJumpHostDTO(jumpHost: JumpHost): JumpHostDTO {
  const { secret, ...rest } = jumpHost;
  return { ...rest, hasSecret: Boolean(secret) };
}

function toDTO(profile: ConnectionProfile): ConnectionProfileDTO {
  const { secret, jumpHost, ...rest } = profile;
  return { ...rest, hasSecret: Boolean(secret), jumpHost: jumpHost ? toJumpHostDTO(jumpHost) : null };
}

export class ConnectionStore {
  private store = new DataStore<ConnectionFile>("connections.json", DEFAULT_FILE);

  private async data(): Promise<ConnectionFile> {
    return this.store.load();
  }

  async list(): Promise<ConnectionsListResult> {
    const data = await this.data();
    return {
      profiles: data.profiles.map(toDTO),
      folders: data.folders,
    };
  }

  async get(id: string): Promise<ConnectionProfileDTO | null> {
    const data = await this.data();
    const profile = data.profiles.find((p) => p.id === id);
    return profile ? toDTO(profile) : null;
  }

  /** Backend-only: returns the full profile including encrypted secret. */
  async getRaw(id: string): Promise<ConnectionProfile | null> {
    const data = await this.data();
    return data.profiles.find((p) => p.id === id) ?? null;
  }

  private async buildJumpHost(input: JumpHostInput): Promise<JumpHost> {
    return {
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      privateKeyPath: input.privateKeyPath ?? null,
      secret: input.secret ? await credentialVault.encrypt(input.secret) : null,
    };
  }

  async create(input: ConnectionInput): Promise<ConnectionProfileDTO> {
    const data = await this.data();
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: input.name,
      protocol: input.protocol,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      privateKeyPath: input.privateKeyPath ?? null,
      folderId: input.folderId ?? null,
      tags: input.tags ?? [],
      defaultRemotePath: input.defaultRemotePath ?? null,
      color: input.color ?? null,
      lastConnectedAt: null,
      secret: input.secret ? await credentialVault.encrypt(input.secret) : null,
      jumpHost: input.jumpHost ? await this.buildJumpHost(input.jumpHost) : null,
    };
    data.profiles.push(profile);
    await this.store.save(data);
    return toDTO(profile);
  }

  async update(id: string, patch: Partial<ConnectionInput>): Promise<ConnectionProfileDTO> {
    const data = await this.data();
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`Connection profile not found: ${id}`);

    if (patch.name !== undefined) profile.name = patch.name;
    if (patch.protocol !== undefined) profile.protocol = patch.protocol;
    if (patch.host !== undefined) profile.host = patch.host;
    if (patch.port !== undefined) profile.port = patch.port;
    if (patch.username !== undefined) profile.username = patch.username;
    if (patch.authType !== undefined) profile.authType = patch.authType;
    if (patch.privateKeyPath !== undefined) profile.privateKeyPath = patch.privateKeyPath;
    if (patch.folderId !== undefined) profile.folderId = patch.folderId;
    if (patch.tags !== undefined) profile.tags = patch.tags;
    if (patch.defaultRemotePath !== undefined) profile.defaultRemotePath = patch.defaultRemotePath;
    if (patch.color !== undefined) profile.color = patch.color;
    // Only re-encrypt when a non-empty secret is supplied; undefined leaves it unchanged.
    if (patch.secret !== undefined && patch.secret !== null && patch.secret !== "") {
      profile.secret = await credentialVault.encrypt(patch.secret);
    }
    if (patch.jumpHost !== undefined) {
      if (patch.jumpHost === null) {
        profile.jumpHost = null;
      } else {
        // A blank secret on an edit means "keep the existing one", same as the profile's own secret above.
        const existingSecret = profile.jumpHost?.secret ?? null;
        profile.jumpHost = {
          host: patch.jumpHost.host,
          port: patch.jumpHost.port,
          username: patch.jumpHost.username,
          authType: patch.jumpHost.authType,
          privateKeyPath: patch.jumpHost.privateKeyPath ?? null,
          secret: patch.jumpHost.secret ? await credentialVault.encrypt(patch.jumpHost.secret) : existingSecret,
        };
      }
    }

    await this.store.save(data);
    return toDTO(profile);
  }

  async delete(id: string): Promise<void> {
    const data = await this.data();
    data.profiles = data.profiles.filter((p) => p.id !== id);
    await this.store.save(data);
  }

  async moveToFolder(id: string, folderId: string | null): Promise<ConnectionProfileDTO> {
    return this.update(id, { folderId });
  }

  /** Backend-only: records a successful session:connect. Not part of ConnectionInput — never user-editable. */
  async recordConnected(id: string): Promise<void> {
    const data = await this.data();
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) return;
    profile.lastConnectedAt = Date.now();
    await this.store.save(data);
  }

  async createFolder(name: string, parentId: string | null = null): Promise<Folder> {
    const data = await this.data();
    const folder: Folder = { id: randomUUID(), name, parentId };
    data.folders.push(folder);
    await this.store.save(data);
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<Folder> {
    const data = await this.data();
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new Error(`Folder not found: ${id}`);
    folder.name = name;
    await this.store.save(data);
    return folder;
  }

  async deleteFolder(id: string): Promise<void> {
    const data = await this.data();
    data.folders = data.folders.filter((f) => f.id !== id);
    // Orphan any profiles that lived in the deleted folder.
    for (const profile of data.profiles) {
      if (profile.folderId === id) profile.folderId = null;
    }
    await this.store.save(data);
  }
}

export const connectionStore = new ConnectionStore();
