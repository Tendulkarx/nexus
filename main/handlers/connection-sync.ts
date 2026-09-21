/**
 * IPC handlers for cross-device connection-profile sync (folder-based —
 * see connection-sync-service.ts for the full design). Thin, like
 * connections.ts — all logic lives in ConnectionSyncService.
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqBool, reqString } from "./validate.js";
import { connectionSyncService } from "../services/connection-sync-service.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { ConnectionSyncConfigInput } from "@shared/ipc-contract";

export function registerConnectionSyncHandlers(): void {
  ipcMain.handle(IPC.connectionSync.getStatus, async () => connectionSyncService.getStatus());

  ipcMain.handle(IPC.connectionSync.configure, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "connectionSync:configure");
    const configObj = asRecord(obj.config, "connectionSync:configure.config");
    const config: ConnectionSyncConfigInput = {
      folderPath: reqString(configObj, "folderPath", "connectionSync:configure.config"),
      enabled: reqBool(configObj, "enabled", "connectionSync:configure.config"),
      passphrase: optString(configObj, "passphrase"),
    };
    return connectionSyncService.configure(config);
  });

  ipcMain.handle(IPC.connectionSync.disable, async () => connectionSyncService.disable());

  ipcMain.handle(IPC.connectionSync.syncNow, async () => connectionSyncService.syncNow());
}
