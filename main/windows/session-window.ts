/**
 * Pops a single session's WorkspaceView into its own BrowserWindow — the
 * session itself is owned by session-manager.ts (main process), independent
 * of any window, so this just points a second renderer at it via a
 * `?sessionId=` query param (see renderer/session-window/index.tsx). Unlike
 * settings-window.ts (one singleton window), several session windows can be
 * open at once, keyed by sessionId.
 */
import { BrowserWindow } from "electron";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";
import { logger } from "../logger.js";

const sessionWindows = new Map<string, BrowserWindow>();

export async function openSessionWindow(sessionId: string): Promise<void> {
  const existing = sessionWindows.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    logger.debug("session-window", "Session window already exists, showing it", { sessionId });
    existing.show();
    existing.focus();
    return;
  }

  logger.info("session-window", "Creating session window", { sessionId });

  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 640,
    minHeight: 420,
    show: false,
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
      sandbox: true,
    },
  });

  sessionWindows.set(sessionId, win);

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    sessionWindows.delete(sessionId);
  });

  const baseUrl = await getWindowUrl("session-window.html");
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}sessionId=${encodeURIComponent(sessionId)}`;
  logger.info("session-window", "Loading session window URL", { url });

  await win.loadURL(url);
}

export function getSessionWindow(sessionId: string): BrowserWindow | null {
  const win = sessionWindows.get(sessionId);
  return win && !win.isDestroyed() ? win : null;
}
