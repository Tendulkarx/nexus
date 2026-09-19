/**
 * Native macOS notifications for events worth surfacing while the app isn't
 * in front of the user. Fires only when no Nexus window is focused — if the
 * user is already looking at the app, the in-app toast/UI is enough — and
 * only when the user hasn't turned them off in Settings.
 */
import { BrowserWindow, Notification } from "electron";

import { logger } from "../logger.js";
import { appSettingsStore } from "./app-settings-store.js";

function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
}

/**
 * Best-effort — a notification failing to show should never break the
 * feature that triggered it. Callers fire-and-forget; the returned promise
 * always resolves, never rejects.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await appSettingsStore.getNotificationsEnabled())) return;
    if (isAppFocused()) return;
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch (err) {
    logger.warn("notification-service", "Failed to show notification", err);
  }
}
