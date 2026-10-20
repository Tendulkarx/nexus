/**
 * Registers every IPC handler group. Called once from main/index.ts.
 */

import { registerActivityLogHandlers } from "./activity-log.js";
import { appHandlers } from "./app.js";
import { registerConnectionSyncHandlers } from "./connection-sync.js";
import { registerConnectionHandlers } from "./connections.js";
import { registerDisplayHandlers } from "./display.js";
import { registerEditHandlers } from "./edit.js";
import { registerFilesystemHandlers } from "./filesystem.js";
import { registerPortForwardHandlers } from "./port-forwards.js";
import { registerRemotePlacesHandlers } from "./remote-places.js";
import { registerSearchHandlers } from "./search.js";
import { registerServerHandlers } from "./servers.js";
import { registerSessionHandlers } from "./sessions.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerSnippetHandlers } from "./snippets.js";
import { registerSshConfigHandlers } from "./ssh-config.js";
import { registerSyncHandlers } from "./sync.js";
import { registerTerminalHandlers } from "./terminal.js";
import { registerToolHandlers } from "./tools.js";
import { registerTransferHandlers } from "./transfers.js";
import { registerVncHandlers } from "./vnc.js";
import { asRecord, reqString } from "./validate.js";
import { getSettingsWindow, openSettingsWindow } from "../windows/settings-window.js";
import { openSessionWindow } from "../windows/session-window.js";

import { ipcMain } from "electron";
import { logger } from "../logger.js";

export function registerHandlers(): void {
  logger.info("handlers", "Registering IPC handlers...");

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Settings window handlers
  ipcMain.handle("window:openSettings", async (_event) => {
    await openSettingsWindow();
  });

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

  // Opens sessionId's WorkspaceView in its own BrowserWindow (see
  // main/windows/session-window.ts) — the session itself stays owned by
  // session-manager.ts regardless of which window shows it.
  ipcMain.handle("window:openSessionWindow", async (_event, payload: unknown) => {
    const obj = asRecord(payload, "window:openSessionWindow");
    const sessionId = reqString(obj, "sessionId", "window:openSessionWindow");
    await openSessionWindow(sessionId);
  });

  // Nexus feature handlers
  registerConnectionHandlers();
  registerConnectionSyncHandlers();
  registerSessionHandlers();
  registerFilesystemHandlers();
  registerTransferHandlers();
  registerTerminalHandlers();
  registerEditHandlers();
  registerDisplayHandlers();
  registerSyncHandlers();
  registerPortForwardHandlers();
  registerSshConfigHandlers();
  registerSnippetHandlers();
  registerSearchHandlers();
  registerRemotePlacesHandlers();
  registerActivityLogHandlers();
  registerSettingsHandlers();
  registerToolHandlers();
  registerServerHandlers();
  registerVncHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
