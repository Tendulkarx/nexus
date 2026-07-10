/**
 * IPC handlers for remote (per-session) and local filesystem browsing/mutation.
 */
import { ipcMain } from "@glaze/core/backend";

import { asRecord, optString, reqBool, reqString } from "./validate.js";
import { localFsService } from "../services/local-fs.js";
import { sessionManager } from "../services/session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerFilesystemHandlers(): void {
  // ── Remote ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.remote.list, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remote:list");
    const session = sessionManager.get(reqString(obj, "sessionId", "remote:list"));
    return session.list(reqString(obj, "path", "remote:list"));
  });

  ipcMain.handle(IPC.remote.mkdir, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remote:mkdir");
    const session = sessionManager.get(reqString(obj, "sessionId", "remote:mkdir"));
    await session.mkdir(reqString(obj, "path", "remote:mkdir"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.remote.rename, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remote:rename");
    const session = sessionManager.get(reqString(obj, "sessionId", "remote:rename"));
    await session.rename(reqString(obj, "from", "remote:rename"), reqString(obj, "to", "remote:rename"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.remote.delete, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remote:delete");
    const session = sessionManager.get(reqString(obj, "sessionId", "remote:delete"));
    await session.delete(reqString(obj, "path", "remote:delete"), reqBool(obj, "isDir", "remote:delete"));
    return { ok: true as const };
  });

  // ── Local ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.local.list, async (_e, payload: unknown) => {
    const obj = payload ? asRecord(payload, "local:list") : {};
    return localFsService.list(optString(obj, "path"));
  });

  ipcMain.handle(IPC.local.roots, async () => localFsService.roots());

  ipcMain.handle(IPC.local.mkdir, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "local:mkdir");
    await localFsService.mkdir(reqString(obj, "path", "local:mkdir"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.local.rename, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "local:rename");
    await localFsService.rename(reqString(obj, "from", "local:rename"), reqString(obj, "to", "local:rename"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.local.delete, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "local:delete");
    await localFsService.delete(reqString(obj, "path", "local:delete"), reqBool(obj, "isDir", "local:delete"));
    return { ok: true as const };
  });
}
