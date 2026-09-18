/**
 * IPC handlers for connection sessions (connect / disconnect / list).
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqString } from "./validate.js";
import { editManager } from "../services/edit-manager.js";
import { sessionManager } from "../services/session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { ConnectionInput, SessionConnectRequest } from "@shared/ipc-contract";

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC.session.connect, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "session:connect");
    const request: SessionConnectRequest = {
      profileId: optString(obj, "profileId"),
      inlineProfile: obj.inlineProfile ? (obj.inlineProfile as ConnectionInput) : undefined,
      secret: optString(obj, "secret") ?? null,
    };
    return sessionManager.connect(request);
  });

  ipcMain.handle(IPC.session.disconnect, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "session:disconnect");
    const sessionId = reqString(obj, "sessionId", "session:disconnect");
    editManager.closeForSession(sessionId);
    await sessionManager.disconnect(sessionId);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.session.list, async () => sessionManager.list());
}
