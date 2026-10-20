/**
 * IPC for VNC viewers: noVNC in the renderer talks to the server through
 * these channels (see services/vnc-bridge.ts).
 */
import { ipcMain } from "electron";

import { asRecord, reqString } from "./validate.js";
import { sessionManager } from "../services/session-manager.js";
import { vncBridge } from "../services/vnc-bridge.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { VncCredentials, VncOpenResult } from "@shared/ipc-contract";

export function registerVncHandlers(): void {
  ipcMain.handle(IPC.vnc.open, async (event, payload: unknown): Promise<VncOpenResult> => {
    const sessionId = reqString(asRecord(payload, "vnc:open"), "sessionId", "vnc:open");
    return { channelId: await vncBridge.open(sessionId, event.sender) };
  });

  ipcMain.on(IPC.vnc.send, (_event, payload: unknown) => {
    const obj = asRecord(payload, "vnc:send");
    if (obj.data instanceof Uint8Array) vncBridge.send(reqString(obj, "channelId", "vnc:send"), obj.data);
  });

  ipcMain.handle(IPC.vnc.close, async (_e, payload: unknown) => {
    vncBridge.close(reqString(asRecord(payload, "vnc:close"), "channelId", "vnc:close"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.vnc.credentials, async (_e, payload: unknown): Promise<VncCredentials> => {
    const sessionId = reqString(asRecord(payload, "vnc:credentials"), "sessionId", "vnc:credentials");
    return sessionManager.getVnc(sessionId).credentials();
  });
}
