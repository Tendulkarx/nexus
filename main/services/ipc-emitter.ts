/**
 * Sends backend→renderer events (transfer progress, terminal data) to all open
 * windows. Renderer subscribes via window.glazeAPI.glaze.ipc.on(channel, cb),
 * which is backed by ipcRenderer.on — so we deliver with webContents.send() to
 * preserve rest-argument delivery (broadcast() is reserved for onNotification).
 */
import { BrowserWindow, logger } from "@glaze/core/backend";

export function emitToRenderer(channel: string, payload: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      logger.warn("ipc-emitter", `Failed to emit ${channel}`, err);
    }
  }
}
