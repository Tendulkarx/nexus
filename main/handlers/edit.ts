/**
 * IPC handler for the "edit in default app" round-trip. Downloads the remote
 * file, opens it in the OS editor, and auto-uploads on save (see EditManager).
 */
import { ipcMain } from "electron";

import { asRecord, reqAnyString, reqString } from "./validate.js";
import { editManager } from "../services/edit-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerEditHandlers(): void {
  ipcMain.handle(IPC.edit.open, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "edit:open");
    await editManager.open(
      reqString(obj, "sessionId", "edit:open"),
      reqString(obj, "path", "edit:open"),
    );
    return { ok: true as const };
  });

  ipcMain.handle(IPC.edit.quickSave, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "edit:quickSave");
    await editManager.quickSave(
      reqString(obj, "sessionId", "edit:quickSave"),
      reqString(obj, "path", "edit:quickSave"),
      reqAnyString(obj, "content", "edit:quickSave"),
    );
    return { ok: true as const };
  });
}
