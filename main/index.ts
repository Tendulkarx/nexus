// Main process entry point. Registers app-feature IPC handlers plus a small
// set of "native bridge" handlers (dialog, shell, nativeTheme, Menu) that
// Electron doesn't auto-wire but that the preload/renderer actually call.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { app, BrowserWindow, Menu, shell, dialog, nativeTheme, ipcMain, protocol, net } from "electron";
import type { MenuItemConstructorOptions } from "electron";
// electron-updater ships as CommonJS with no real named exports — under
// Node ESM ("type": "module" in package.json) it must be imported via its
// default export and destructured, not `import { autoUpdater } from ...`.
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;

import { registerHandlers } from "./handlers/index.js";
import { getPreloadPath, getWindowUrl } from "./windows/window-paths.js";
import { openSettingsWindow } from "./windows/settings-window.js";
import { connectionSyncService } from "./services/connection-sync-service.js";
import { editManager } from "./services/edit-manager.js";
import { prepareDragDownload } from "./services/drag-download.js";
import { portForwardManager } from "./services/port-forward-manager.js";
import { sessionManager } from "./services/session-manager.js";
import { terminalService } from "./services/terminal-service.js";
import { transferManager } from "./services/transfer-manager.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Privileged scheme for dragging a remote file out to Finder (renderer sets a
// "DownloadURL" drag-data entry pointing at nexus-drag://<sessionId>/<path>;
// Chromium fetches it only once the OS drop target actually accepts the
// file). Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: "nexus-drag", privileges: { standard: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ── IPC Handlers ──────────────────────────────────────────────────────
registerHandlers();
registerNativeBridgeHandlers();

// ── State ─────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

// ── Window creation ───────────────────────────────────────────────────
async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug("main", "Main window already exists, skipping creation");
    return;
  }

  // Read display name from package.json (out/main/index.js -> ../../package.json)
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");

  // 720px used to be the floor, but the Quick Connect bar's fixed-width
  // fields (protocol/port/username/password/Connect) don't fit next to the
  // sidebar below that — the Connect button would get clipped with no
  // scrollbar to reach it. 900px is the smallest width that keeps everything
  // visible at the sidebar's minimum width.
  const minWindowWidth = 900;
  const minWindowHeight = 520;
  const windowWidth = 1200;
  const windowHeight = 800;
  let windowTitle = "Nexus";

  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf-8"));
      windowTitle = packageJson.productName || windowTitle;
    }
  } catch {
    // Use defaults
  }

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    title: windowTitle,
    show: false, // Don't show until ready-to-show (prevents flickering)
    // The renderer CSS (main-window.html's translucent --background, the
    // `.drag-region`/`data-toolbar` traffic-light-aware layout) expects a
    // hidden-title-bar, vibrancy-backed window rather than Electron's plain
    // default titled window.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // preload only uses contextBridge/ipcRenderer/webUtils — no Node built-ins needed
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const url = await getWindowUrl("main-window.html");
  logger.info("main", "Resolved main window URL", { url });
  await mainWindow.loadURL(url);
}

// ── Application menu ──────────────────────────────────────────────────
function setupApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "App",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: async () => await openSettingsWindow(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Connection",
          accelerator: "CommandOrControl+N",
          click: () => mainWindow?.webContents.send("menu:action", "new-connection"),
        },
        {
          label: "Close Tab",
          accelerator: "CommandOrControl+W",
          click: () => mainWindow?.webContents.send("menu:action", "close-tab"),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  logger.info("main", "Application menu configured with Settings");
}

// ── Native bridge handlers ──────────────────────────────────────────────
// Electron has no built-in "safe defaults" bridge for dialog/shell/nativeTheme/
// Menu, so we wire exactly what renderer/preload.ts actually calls.
interface PopupMenuItem {
  label?: string;
  commandId?: number;
  type?: "separator";
}
interface PopupMenuOptions {
  items: PopupMenuItem[];
}
interface PopupMenuResult {
  commandId: number | null;
}

function registerNativeBridgeHandlers(): void {
  ipcMain.handle("dialog:showOpenDialog", (_e, options) => dialog.showOpenDialog(options ?? {}));
  ipcMain.handle("dialog:showSaveDialog", (_e, options) => dialog.showSaveDialog(options ?? {}));
  ipcMain.handle("dialog:showMessageBox", (_e, options) => dialog.showMessageBox(options));
  ipcMain.handle("dialog:showErrorBox", (_e, title: string, content: string) => {
    dialog.showErrorBox(title, content);
  });

  ipcMain.handle("shell:beep", () => {
    shell.beep();
  });

  ipcMain.handle("nativeTheme:getInfo", () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
  }));
  ipcMain.handle("nativeTheme:setThemeSource", (_e, source: "system" | "light" | "dark") => {
    nativeTheme.themeSource = source;
    return true;
  });
  ipcMain.handle("nativeTheme:getShouldUseDarkColors", () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle("nativeTheme:getThemeSource", () => nativeTheme.themeSource);

  // Real Electron's Menu.popup() supports click callbacks directly, but the
  // renderer (file-pane.tsx) still speaks the commandId-dispatch shape it was
  // built against — this handler bridges the two rather than requiring a
  // renderer-side rewrite.
  ipcMain.handle("Menu:popup", (event, options: PopupMenuOptions): Promise<PopupMenuResult> => {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: PopupMenuResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const template: MenuItemConstructorOptions[] = (options.items ?? []).map((item) => {
        if (item.type === "separator") return { type: "separator" };
        return {
          label: item.label,
          click: () => settle({ commandId: item.commandId ?? null }),
        };
      });
      const menu = Menu.buildFromTemplate(template);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      menu.popup({ window: win, callback: () => settle({ commandId: null }) });
    });
  });

  ipcMain.handle("Menu:setApplicationMenu", (_e, template: MenuItemConstructorOptions[] | null) => {
    Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
  });
}

// ── Dock transfer progress (macOS only — app.dock is undefined elsewhere) ──
const DOCK_UPDATE_INTERVAL_MS = 500;

function updateDockTransferProgress(): void {
  const { count, progress } = transferManager.getActiveSummary();
  app.dock?.setBadge(count > 0 ? String(count) : "");
  mainWindow?.setProgressBar(count > 0 ? progress : -1);
}

// ── Lifecycle events ──────────────────────────────────────────────────
app.on("window-all-closed", () => {
  // On macOS, apps typically don't quit when all windows are closed.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on("before-quit", () => {
  logger.info("main", "App before-quit, cleaning up connections...");
  transferManager.cancelAll();
  editManager.closeAll();
  terminalService.closeAll();
  void portForwardManager.closeAll();
  void sessionManager.closeAll();
});

// ── Auto-update ───────────────────────────────────────────────────────
// Requires the "publish" block in package.json's "build" config to point at
// a real repo (currently placeholders) and a GH_TOKEN at publish time.
// Harmless no-op in dev / unpackaged builds — checkForUpdatesAndNotify()
// itself no-ops when app.isPackaged is false, but we still guard broadly so
// a network hiccup or missing publish config never blocks startup.
function checkForUpdates(): void {
  if (!app.isPackaged) {
    logger.debug("update", "Skipping update check — running unpackaged (dev build)");
    return;
  }
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    logger.warn("update", "Update check failed (non-fatal)", error);
  });
}

// ── App ready ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  setupApplicationMenu();
  registerDragDownloadProtocol();
  try {
    await createMainWindow();
  } catch (error) {
    logger.error("main", "Failed to create main window", error);
  }
  checkForUpdates();
  setInterval(updateDockTransferProgress, DOCK_UPDATE_INTERVAL_MS);
  void connectionSyncService.init();
});

function registerDragDownloadProtocol(): void {
  protocol.handle("nexus-drag", async (request) => {
    try {
      const url = new URL(request.url);
      const sessionId = url.hostname;
      const remotePath = decodeURIComponent(url.pathname.slice(1));
      const tempPath = await prepareDragDownload(sessionId, remotePath);
      return net.fetch(pathToFileURL(tempPath).toString());
    } catch (error) {
      logger.error("main", "Drag-out download failed", error);
      return new Response("Download failed", { status: 500 });
    }
  });
}
