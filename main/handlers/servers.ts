/**
 * IPC handlers for the local servers in the Servers sidebar. Status changes
 * and log lines arrive separately as servers:status events.
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqBool, reqNumber, reqString } from "./validate.js";
import { serverManager } from "../services/servers/server-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { LocalServerConfig, LocalServerKind } from "@shared/ipc-contract";

export function registerServerHandlers(): void {
  ipcMain.handle(IPC.servers.list, async () => serverManager.list());

  ipcMain.handle(IPC.servers.start, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "servers:start");
    const config: LocalServerConfig = {
      kind: reqString(obj, "kind", "servers:start") as LocalServerKind,
      port: reqNumber(obj, "port", "servers:start"),
      rootDir: optString(obj, "rootDir") ?? null,
      lan: reqBool(obj, "lan", "servers:start"),
      allowWrites: reqBool(obj, "allowWrites", "servers:start"),
      username: optString(obj, "username"),
      password: optString(obj, "password"),
    };
    return serverManager.start(config);
  });

  ipcMain.handle(IPC.servers.stop, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "servers:stop");
    return serverManager.stop(reqString(obj, "kind", "servers:stop") as LocalServerKind);
  });
}
