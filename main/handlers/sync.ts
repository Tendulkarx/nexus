/**
 * IPC handlers for local<->remote directory sync. sync:plan computes a plan
 * without touching either filesystem; sync:execute runs a plan the renderer
 * already showed the user and got confirmation on.
 */
import { ipcMain } from "electron";

import { asRecord, reqBool, reqString } from "./validate.js";
import { syncManager } from "../services/sync-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { SyncMode, SyncPlanEntry } from "@shared/ipc-contract";

function reqSyncMode(obj: Record<string, unknown>, context: string): SyncMode {
  const mode = reqString(obj, "mode", context);
  if (mode !== "upload" && mode !== "download" && mode !== "two-way") {
    throw new Error(`${context}: invalid sync mode "${mode}"`);
  }
  return mode;
}

function reqPlanEntries(obj: Record<string, unknown>, context: string): SyncPlanEntry[] {
  const entries = obj.entries;
  if (!Array.isArray(entries)) throw new Error(`${context}: missing required array "entries"`);
  return entries as SyncPlanEntry[];
}

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.sync.plan, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "sync:plan");
    return syncManager.plan({
      sessionId: reqString(obj, "sessionId", "sync:plan"),
      localRoot: reqString(obj, "localRoot", "sync:plan"),
      remoteRoot: reqString(obj, "remoteRoot", "sync:plan"),
      mode: reqSyncMode(obj, "sync:plan"),
      deleteOrphans: reqBool(obj, "deleteOrphans", "sync:plan"),
    });
  });

  ipcMain.handle(IPC.sync.execute, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "sync:execute");
    return syncManager.execute({
      sessionId: reqString(obj, "sessionId", "sync:execute"),
      localRoot: reqString(obj, "localRoot", "sync:execute"),
      remoteRoot: reqString(obj, "remoteRoot", "sync:execute"),
      entries: reqPlanEntries(obj, "sync:execute"),
    });
  });

  ipcMain.handle(IPC.sync.diff, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "sync:diff");
    return syncManager.diffEntry({
      sessionId: reqString(obj, "sessionId", "sync:diff"),
      localRoot: reqString(obj, "localRoot", "sync:diff"),
      remoteRoot: reqString(obj, "remoteRoot", "sync:diff"),
      relPath: reqString(obj, "relPath", "sync:diff"),
    });
  });
}
