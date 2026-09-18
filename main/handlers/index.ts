/**
 * Registers every IPC handler group. Called once from main/index.ts.
 */

import { appHandlers } from "./app.js";
import { registerConnectionHandlers } from "./connections.js";
import { registerDisplayHandlers } from "./display.js";
import { registerEditHandlers } from "./edit.js";
import { registerFilesystemHandlers } from "./filesystem.js";
import { registerPortForwardHandlers } from "./port-forwards.js";
import { registerRemotePlacesHandlers } from "./remote-places.js";
import { registerSearchHandlers } from "./search.js";
import { registerSessionHandlers } from "./sessions.js";
import { registerSyncHandlers } from "./sync.js";
import { registerTerminalHandlers } from "./terminal.js";
import { registerTransferHandlers } from "./transfers.js";
import { getSettingsWindow, openSettingsWindow } from "../windows/settings-window.js";

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

  // Nexus feature handlers
  registerConnectionHandlers();
  registerSessionHandlers();
  registerFilesystemHandlers();
  registerTransferHandlers();
  registerTerminalHandlers();
  registerEditHandlers();
  registerDisplayHandlers();
  registerSyncHandlers();
  registerPortForwardHandlers();
  registerSearchHandlers();
  registerRemotePlacesHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
