/**
 * Thin, lazily-loaded wrapper around the `native/nexus-display-host` addon —
 * a Node-API (node-addon-api) module written in Objective-C++ that embeds a
 * native NSView (driving a live RDP session) as a child view directly
 * inside a BrowserWindow, composited by macOS itself rather than drawn via a
 * web canvas. See native/nexus-display-host/README.md for the build steps
 * (requires Xcode Command Line Tools; `npm run build:native` vendors a
 * from-source FreeRDP build automatically) — this repo ships the addon's
 * *source*, not a prebuilt binary, so `npm run build:native` must be run
 * locally before any of this actually works.
 *
 * Loading is lazy and wrapped so the rest of the app (file sessions, the
 * terminal, transfers — everything that isn't rdp) works completely
 * normally even when the native addon hasn't been built yet. Only connecting
 * to an rdp profile touches this module.
 */
import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";

import { app } from "electron";

import type { DisplayBounds, DisplaySessionState, Protocol } from "@shared/ipc-contract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface NativeDisplayConnectOptions {
  sessionId: string;
  protocol: Extract<Protocol, "rdp">;
  host: string;
  port: number;
  username: string;
  secret: string | null;
  /** Native window handle buffer from BrowserWindow.getNativeWindowHandle(). */
  nativeWindowHandle: Buffer;
  bounds: DisplayBounds;
  onStatus: (state: DisplaySessionState, message?: string) => void;
}

interface NativeAddon {
  createSession(options: {
    sessionId: string;
    protocol: string;
    host: string;
    port: number;
    username: string;
    secret: string | null;
    nativeWindowHandle: Buffer;
    bounds: DisplayBounds;
    onStatus: (state: string, message?: string) => void;
  }): void;
  resizeSession(sessionId: string, bounds: DisplayBounds): void;
  destroySession(sessionId: string): void;
}

let addon: NativeAddon | null = null;
let loadError: Error | null = null;

function resolveAddonPath(): string {
  // Packaged builds unpack native addons out of the asar archive (see the
  // `asarUnpack` entry this feature adds to package.json's "build" config);
  // dev builds load straight from the repo's native/ directory.
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "native", "nexus-display-host", "build", "Release", "nexus_display_host.node")
    : path.join(__dirname, "..", "..", "native", "nexus-display-host", "build", "Release", "nexus_display_host.node");
}

function loadAddon(): NativeAddon {
  if (addon) return addon;
  if (loadError) throw loadError;
  try {
    addon = require(resolveAddonPath()) as NativeAddon;
    return addon;
  } catch (err) {
    loadError = new Error(
      "The native Remote Desktop addon (native/nexus-display-host) hasn't been built. " +
        "Run `npm run build:native` (requires Xcode Command Line Tools) before connecting to an RDP profile. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw loadError;
  }
}

export const nativeDisplayHost = {
  connect(options: NativeDisplayConnectOptions): void {
    const native = loadAddon();
    native.createSession({
      sessionId: options.sessionId,
      protocol: options.protocol,
      host: options.host,
      port: options.port,
      username: options.username,
      secret: options.secret,
      nativeWindowHandle: options.nativeWindowHandle,
      bounds: options.bounds,
      onStatus: (state, message) => options.onStatus(state as DisplaySessionState, message),
    });
  },

  resize(sessionId: string, bounds: DisplayBounds): void {
    loadAddon().resizeSession(sessionId, bounds);
  },

  destroy(sessionId: string): void {
    // Best-effort — if the addon never loaded there's nothing native to tear down.
    if (!addon) return;
    try {
      addon.destroySession(sessionId);
    } catch {
      // ignore — session may already be gone
    }
  },

  get isAvailable(): boolean {
    try {
      loadAddon();
      return true;
    } catch {
      return false;
    }
  },
};
