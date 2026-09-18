/**
 * Builds and applies portable connection-profile export files (backup / move
 * to another machine). See ConnectionsExportRequest/ConnectionsImportRequest
 * in ipc-contract.ts for the secrets-are-opt-in rationale; the actual
 * password-based re-encryption lives in connection-export-crypto.ts.
 */
import * as fs from "fs/promises";

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

import type {
  AuthType,
  ConnectionInput,
  ConnectionsExportRequest,
  ConnectionsExportResult,
  ConnectionsImportRequest,
  ConnectionsImportResult,
  Protocol,
} from "@shared/ipc-contract";

interface ExportedJumpHost {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath: string | null;
  secret: EncryptedPayload | null;
}

interface ExportedProfile {
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath: string | null;
  folderId: string | null;
  tags: string[];
  defaultRemotePath: string | null;
  color: string | null;
  secret: EncryptedPayload | null;
  jumpHost: ExportedJumpHost | null;
}

interface ExportFileFolder {
  id: string;
  name: string;
}

interface ExportFile {
  version: 1;
  exportedAt: number;
  secretsIncluded: boolean;
  kdf?: KdfParams;
  folders: ExportFileFolder[];
  profiles: ExportedProfile[];
}

/** Encrypts a vault secret for export, or returns null when it's absent or being omitted. */
async function exportSecret(
  vaultSecret: string | null | undefined,
  key: Buffer | null,
): Promise<EncryptedPayload | null> {
  if (!vaultSecret || !key) return null;
  const plaintext = await credentialVault.decrypt(vaultSecret);
  if (plaintext === null) return null;
  return encryptSecret(plaintext, key);
}

export async function exportConnections(request: ConnectionsExportRequest): Promise<ConnectionsExportResult> {
  if (request.includeSecrets && !request.password) {
    throw new Error("An export password is required to include secrets");
  }

  const { profiles: allProfiles, folders: allFolders } = await connectionStore.list();
  const selectedIds = request.profileIds ? new Set(request.profileIds) : null;
  const selectedDTOs = selectedIds ? allProfiles.filter((p) => selectedIds.has(p.id)) : allProfiles;

  const kdf = request.includeSecrets ? generateKdfParams() : undefined;
  const key = request.includeSecrets && kdf && request.password ? deriveExportKey(request.password, kdf) : null;

  const usedFolderIds = new Set<string>();
  const profiles: ExportedProfile[] = [];
  for (const dto of selectedDTOs) {
    const raw = await connectionStore.getRaw(dto.id);
    if (!raw) continue;
    if (raw.folderId) usedFolderIds.add(raw.folderId);
    profiles.push({
      name: raw.name,
      protocol: raw.protocol,
      host: raw.host,
      port: raw.port,
      username: raw.username,
      authType: raw.authType,
      privateKeyPath: raw.privateKeyPath ?? null,
      folderId: raw.folderId ?? null,
      tags: raw.tags,
      defaultRemotePath: raw.defaultRemotePath ?? null,
      color: raw.color ?? null,
      secret: await exportSecret(raw.secret, key),
      jumpHost: raw.jumpHost
        ? {
            host: raw.jumpHost.host,
            port: raw.jumpHost.port,
            username: raw.jumpHost.username,
            authType: raw.jumpHost.authType,
            privateKeyPath: raw.jumpHost.privateKeyPath ?? null,
            secret: await exportSecret(raw.jumpHost.secret, key),
          }
        : null,
    });
  }

  const folders: ExportFileFolder[] = allFolders
    .filter((f) => usedFolderIds.has(f.id))
    .map((f) => ({ id: f.id, name: f.name }));

  const file: ExportFile = {
    version: 1,
    exportedAt: Date.now(),
    secretsIncluded: request.includeSecrets,
    kdf,
    folders,
    profiles,
  };

  await fs.writeFile(request.filePath, JSON.stringify(file, null, 2), "utf-8");
  return { profileCount: profiles.length, folderCount: folders.length };
}

function isExportFile(value: unknown): value is ExportFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ExportFile).version === 1 &&
    Array.isArray((value as ExportFile).folders) &&
    Array.isArray((value as ExportFile).profiles)
  );
}

export async function importConnections(request: ConnectionsImportRequest): Promise<ConnectionsImportResult> {
  const raw = await fs.readFile(request.filePath, "utf-8");
  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch {
    throw new Error("Not a valid Nexus connections export file");
  }
  if (!isExportFile(file)) {
    throw new Error("Not a valid Nexus connections export file");
  }

  if (file.secretsIncluded && !request.password) {
    throw new Error("This file's secrets are password-protected — enter the export password to import them");
  }
  const key = file.secretsIncluded && file.kdf && request.password
    ? deriveExportKey(request.password, file.kdf)
    : null;

  // Fail fast (before creating anything) if the password is wrong — GCM auth-tag
  // verification throws on any secret encrypted with a different key.
  if (key) {
    try {
      for (const p of file.profiles) {
        if (p.secret) decryptSecret(p.secret, key);
        if (p.jumpHost?.secret) decryptSecret(p.jumpHost.secret, key);
      }
    } catch {
      throw new Error("Incorrect password — could not decrypt this file's secrets");
    }
  }

  // Folders are imported flat (parentId is dropped): the app's current folder
  // UI has no nesting affordance to preserve anyway (see connection-manager-view.tsx).
  const folderIdMap = new Map<string, string>();
  for (const folder of file.folders) {
    const created = await connectionStore.createFolder(folder.name, null);
    folderIdMap.set(folder.id, created.id);
  }

  let profileCount = 0;
  for (const p of file.profiles) {
    const input: ConnectionInput = {
      name: p.name,
      protocol: p.protocol,
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      privateKeyPath: p.privateKeyPath,
      folderId: p.folderId ? (folderIdMap.get(p.folderId) ?? null) : null,
      tags: p.tags,
      defaultRemotePath: p.defaultRemotePath,
      color: p.color,
      secret: p.secret && key ? decryptSecret(p.secret, key) : undefined,
      jumpHost: p.jumpHost
        ? {
            host: p.jumpHost.host,
            port: p.jumpHost.port,
            username: p.jumpHost.username,
            authType: p.jumpHost.authType,
            privateKeyPath: p.jumpHost.privateKeyPath,
            secret: p.jumpHost.secret && key ? decryptSecret(p.jumpHost.secret, key) : undefined,
          }
        : null,
    };
    await connectionStore.create(input);
    profileCount++;
  }

  return { profileCount, folderCount: folderIdMap.size };
}
