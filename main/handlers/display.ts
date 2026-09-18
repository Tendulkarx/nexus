/**
 * IPC handlers for Remote Desktop (rdp) sessions. Unlike file-session
 * handlers, these never carry pixel data — display:connect/resize only tell
 * the main process where to position the native child view that the
 * `nexus-display-host` addon composites directly into this window (see
 * services/sessions/display-session.ts + services/native-display-host.ts).
 * Status changes (connecting/connected/error/closed) stream back to the
 * renderer via the display:status event.
 */
import { BrowserWindow, ipcMain } from "electron";

import { asRecord, reqNumber, reqString } from "./validate.js";
import { sessionManager } from "../services/session-manager.js";
import { logger } from "../logger.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { DisplayBounds } from "../../renderer/shared/ipc-contract.js";

function reqBounds(obj: Record<string, unknown>, context: string): DisplayBounds {
  const bounds = asRecord(obj.bounds, context);
  return {
    x: reqNumber(bounds, "x", context),
    y: reqNumber(bounds, "y", context),
    width: reqNumber(bounds, "width", context),
    height: reqNumber(bounds, "height", context),
  };
}

export function registerDisplayHandlers(): void {
  ipcMain.handle(IPC.display.connect, (event, payload: unknown) => {
    const obj = asRecord(payload, "display:connect");
    const sessionId = reqString(obj, "sessionId", "display:connect");
    const bounds = reqBounds(obj, "display:connect");

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("display:connect: no owning window for this session");

    const session = sessionManager.getDisplay(sessionId);

    // Forward status changes to whichever window's renderer asked to connect.
    session.onStatus((state, message) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IPC.display.status, { sessionId, state, message });
    });

    try {
      session.connectNative(window, bounds);
    } catch (err) {
      logger.error("display-handler", "display:connect failed", { sessionId, err });
      throw err;
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC.display.resize, (_e, payload: unknown) => {
    const obj = asRecord(payload, "display:resize");
    const sessionId = reqString(obj, "sessionId", "display:resize");
    const bounds = reqBounds(obj, "display:resize");
    sessionManager.getDisplay(sessionId).resizeNative(bounds);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.display.disconnect, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "display:disconnect");
    const sessionId = reqString(obj, "sessionId", "display:disconnect");
    await sessionManager.getDisplay(sessionId).close();
    return { ok: true as const };
  });
}
