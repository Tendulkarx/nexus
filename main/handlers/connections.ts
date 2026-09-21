/**
 * IPC handlers for connection-profile and folder CRUD. Thin — all logic lives in
 * ConnectionStore. Renderer never receives stored secrets (DTOs only).
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqBool, reqNumber, reqString } from "./validate.js";
import { connectionStore } from "../services/connection-store.js";
import { connectionSyncService } from "../services/connection-sync-service.js";
import { checkReachable } from "../services/reachability.js";
import { exportConnections, importConnections } from "../services/connection-transfer.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { AuthType, ConnectionInput, JumpHostInput, Protocol } from "@shared/ipc-contract";

const PROTOCOLS: Protocol[] = ["sftp", "ftp", "ftps", "ssh", "rdp", "mosh"];
const AUTH_TYPES: AuthType[] = ["password", "key"];

function coerceJumpHost(value: unknown, context: string): JumpHostInput {
  const obj = asRecord(value, context);
  const authType = reqString(obj, "authType", context) as AuthType;
  if (!AUTH_TYPES.includes(authType)) throw new Error(`${context}: invalid authType "${authType}"`);
  const portValue = obj.port;
  const port = typeof portValue === "number" && !Number.isNaN(portValue) ? portValue : 0;

  return {
    host: reqString(obj, "host", context),
    port,
    username: reqString(obj, "username", context),
    authType,
    privateKeyPath: optString(obj, "privateKeyPath") ?? null,
    secret: optString(obj, "secret") ?? undefined,
  };
}

function coerceInput(value: unknown, context: string): ConnectionInput {
  const obj = asRecord(value, context);
  const protocol = reqString(obj, "protocol", context) as Protocol;
  if (!PROTOCOLS.includes(protocol)) throw new Error(`${context}: invalid protocol "${protocol}"`);
  const authType = reqString(obj, "authType", context) as AuthType;
  if (!AUTH_TYPES.includes(authType)) throw new Error(`${context}: invalid authType "${authType}"`);

  const portValue = obj.port;
  const port = typeof portValue === "number" && !Number.isNaN(portValue) ? portValue : 0;
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string") : [];

  return {
    name: reqString(obj, "name", context),
    protocol,
    host: reqString(obj, "host", context),
    port,
    username: reqString(obj, "username", context),
    authType,
    privateKeyPath: optString(obj, "privateKeyPath") ?? null,
    folderId: optString(obj, "folderId") ?? null,
    tags,
    defaultRemotePath: optString(obj, "defaultRemotePath") ?? null,
    color: optString(obj, "color") ?? null,
    secret: optString(obj, "secret") ?? undefined,
    jumpHost: obj.jumpHost ? coerceJumpHost(obj.jumpHost, `${context}.jumpHost`) : null,
    agentForward: obj.agentForward === true,
    onConnectCommand: optString(obj, "onConnectCommand") ?? null,
  };
}

function coercePatch(value: unknown, context: string): Partial<ConnectionInput> {
  const obj = asRecord(value, context);
  const patch: Partial<ConnectionInput> = {};
  if (typeof obj.name === "string") patch.name = obj.name;
  if (typeof obj.protocol === "string" && PROTOCOLS.includes(obj.protocol as Protocol))
    patch.protocol = obj.protocol as Protocol;
  if (typeof obj.host === "string") patch.host = obj.host;
  if (typeof obj.port === "number") patch.port = obj.port;
  if (typeof obj.username === "string") patch.username = obj.username;
  if (typeof obj.authType === "string" && AUTH_TYPES.includes(obj.authType as AuthType))
    patch.authType = obj.authType as AuthType;
  if ("privateKeyPath" in obj) patch.privateKeyPath = optString(obj, "privateKeyPath") ?? null;
  if ("folderId" in obj) patch.folderId = optString(obj, "folderId") ?? null;
  if (Array.isArray(obj.tags))
    patch.tags = obj.tags.filter((t): t is string => typeof t === "string");
  if ("defaultRemotePath" in obj) patch.defaultRemotePath = optString(obj, "defaultRemotePath") ?? null;
  if ("color" in obj) patch.color = optString(obj, "color") ?? null;
  if (typeof obj.secret === "string") patch.secret = obj.secret;
  if ("jumpHost" in obj) {
    patch.jumpHost = obj.jumpHost === null ? null : coerceJumpHost(obj.jumpHost, `${context}.jumpHost`);
  }
  if (typeof obj.agentForward === "boolean") patch.agentForward = obj.agentForward;
  if ("onConnectCommand" in obj) patch.onConnectCommand = optString(obj, "onConnectCommand") ?? null;
  return patch;
}

export function registerConnectionHandlers(): void {
  ipcMain.handle(IPC.connections.list, async () => connectionStore.list());

  ipcMain.handle(IPC.connections.get, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:get");
    return connectionStore.get(reqString(obj, "id", "connections:get"));
  });

  ipcMain.handle(IPC.connections.create, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:create");
    const result = await connectionStore.create(coerceInput(obj.input, "connections:create.input"));
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.connections.update, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:update");
    const id = reqString(obj, "id", "connections:update");
    const result = await connectionStore.update(id, coercePatch(obj.patch, "connections:update.patch"));
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.connections.delete, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:delete");
    await connectionStore.delete(reqString(obj, "id", "connections:delete"));
    connectionSyncService.notifyLocalChange();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.connections.moveToFolder, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:moveToFolder");
    const id = reqString(obj, "id", "connections:moveToFolder");
    const folderId = optString(obj, "folderId") ?? null;
    const result = await connectionStore.moveToFolder(id, folderId);
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.connections.checkReachability, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:checkReachability");
    const host = reqString(obj, "host", "connections:checkReachability");
    const port = reqNumber(obj, "port", "connections:checkReachability");
    const reachable = await checkReachable(host, port);
    return { reachable };
  });

  ipcMain.handle(IPC.connections.export, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:export");
    const filePath = reqString(obj, "filePath", "connections:export");
    const includeSecrets = reqBool(obj, "includeSecrets", "connections:export");
    const profileIds = Array.isArray(obj.profileIds)
      ? obj.profileIds.filter((id): id is string => typeof id === "string")
      : undefined;
    return exportConnections({ filePath, includeSecrets, profileIds, password: optString(obj, "password") });
  });

  ipcMain.handle(IPC.connections.import, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connections:import");
    const filePath = reqString(obj, "filePath", "connections:import");
    const result = await importConnections({ filePath, password: optString(obj, "password") });
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.folders.create, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "folders:create");
    const result = await connectionStore.createFolder(
      reqString(obj, "name", "folders:create"),
      optString(obj, "parentId") ?? null,
    );
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.folders.rename, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "folders:rename");
    const result = await connectionStore.renameFolder(
      reqString(obj, "id", "folders:rename"),
      reqString(obj, "name", "folders:rename"),
    );
    connectionSyncService.notifyLocalChange();
    return result;
  });

  ipcMain.handle(IPC.folders.delete, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "folders:delete");
    await connectionStore.deleteFolder(reqString(obj, "id", "folders:delete"));
    connectionSyncService.notifyLocalChange();
    return { ok: true as const };
  });
}
