/**
 * Native macOS notifications for events worth surfacing while the app isn't
 * in front of the user. Fires only when no Nexus window is focused — if the
 * user is already looking at the app, the in-app toast/UI is enough.
 */
import { BrowserWindow, Notification } from "electron";

import { logger } from "../logger.js";

function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
}

/** Best-effort — a notification failing to show should never break the feature that triggered it. */
export function notify(title: string, body: string): void {
  try {
    if (isAppFocused()) return;
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch (err) {
    logger.warn("notification-service", "Failed to show notification", err);
  }
}
