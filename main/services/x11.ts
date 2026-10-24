/**
 * X11 forwarding to XQuartz, so `xclock`, `virt-manager` and other remote GUI
 * apps open as windows on the Mac (a built-in X server, minus
 * bundling one). Like `ssh -Y`: the remote side gets XQuartz's real
 * MIT-MAGIC-COOKIE, and every X11 channel the server opens is piped to the
 * local display socket.
 *
 * XQuartz registers a launchd socket (/private/tmp/com.apple.launchd.<id>/
 * org.xquartz:0) and exports DISPLAY pointing at it; connecting to that socket
 * starts XQuartz on demand. GUI apps don't always inherit DISPLAY, so it's
 * also read from launchd and found by scanning /private/tmp.
 */
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import * as net from "net";
import * as path from "path";

import type { Client } from "ssh2";

export type XTarget = { kind: "unix"; path: string } | { kind: "tcp"; host: string; port: number };

const XQUARTZ_APPS = ["/Applications/Utilities/XQuartz.app", "/Applications/XQuartz.app"];
const XAUTH = "/opt/X11/bin/xauth";
const LAUNCHD_TMP = "/private/tmp";
const LAUNCHD_SOCKET_NAMES = ["org.xquartz:0", "org.macosforge.xquartz:0"];

/**
 * Where a DISPLAY value points. Handles XQuartz's launchd socket path,
 * ":N" / "unix:N" (the conventional /tmp/.X11-unix socket), and "host:N"
 * over TCP (port 6000+N). Screen suffixes (".0") are ignored.
 */
export function parseDisplay(display: string): XTarget | null {
  const value = display.trim();
  if (!value) return null;
  if (value.startsWith("/")) return { kind: "unix", path: value };
  const match = /^([^:]*):(\d+)(?:\.\d+)?$/.exec(value);
  if (!match) return null;
  const [, host, num] = match;
  if (host === "" || host === "unix") return { kind: "unix", path: `/tmp/.X11-unix/X${num}` };
  return { kind: "tcp", host, port: 6000 + Number(num) };
}

export interface XCookie {
  protocol: string;
  cookie: string;
}

/** First cookie from `xauth list` output: "<display>  MIT-MAGIC-COOKIE-1  <hex>". */
export function parseXauthList(output: string): XCookie | null {
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && /^[0-9a-f]+$/i.test(parts[2])) return { protocol: parts[1], cookie: parts[2] };
  }
  return null;
}

export async function isXQuartzInstalled(): Promise<boolean> {
  for (const app of XQUARTZ_APPS) {
    if (
      await fs.stat(app).then(
        () => true,
        () => false,
      )
    )
      return true;
  }
  return false;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile(file, args, { timeout: 3_000 }, (err, stdout) => resolve(err ? "" : stdout)),
  );
}

/** The local display to forward to, or null when no X server can be found. */
export async function findLocalDisplay(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.DISPLAY) return env.DISPLAY;
  const fromLaunchd = (await run("/bin/launchctl", ["getenv", "DISPLAY"])).trim();
  if (fromLaunchd) return fromLaunchd;
  const dirs = await fs.readdir(LAUNCHD_TMP).catch(() => [] as string[]);
  for (const dir of dirs.filter((d) => d.startsWith("com.apple.launchd."))) {
    for (const name of LAUNCHD_SOCKET_NAMES) {
      const candidate = path.join(LAUNCHD_TMP, dir, name);
      if (
        await fs.stat(candidate).then(
          (s) => s.isSocket(),
          () => false,
        )
      )
        return candidate;
    }
  }
  return null;
}

/** XQuartz's cookie for `display`; a random one if xauth has none (XQuartz then admits local connections by user). */
export async function cookieFor(display: string): Promise<XCookie> {
  const found = parseXauthList(await run(XAUTH, ["list", display]));
  return found ?? { protocol: "MIT-MAGIC-COOKIE-1", cookie: randomBytes(16).toString("hex") };
}

export interface X11Forwarding {
  /** Passed to client.shell() so the server sets DISPLAY in the remote shell. */
  shellOption: { single: false; screen: 0; protocol: string; cookie: string };
}

/**
 * Pipes every X11 channel the server opens on `client` to the local X server.
 * Call once per connection; the returned option goes on each shell request.
 */
export function attachX11Forwarding(
  client: Client,
  target: XTarget,
  cookie: XCookie,
  log: (message: string) => void = () => {},
): X11Forwarding {
  client.on("x11", (info, accept, reject) => {
    const local = target.kind === "unix" ? net.connect(target.path) : net.connect(target.port, target.host);
    local.once("connect", () => {
      const channel = accept();
      channel.pipe(local).pipe(channel);
      channel.on("close", () => local.destroy());
      local.on("close", () => channel.close());
    });
    local.once("error", (err) => {
      log(`X11 connection from ${info.srcIP} failed: ${err.message}`);
      reject();
    });
  });
  return { shellOption: { single: false, screen: 0, protocol: cookie.protocol, cookie: cookie.cookie } };
}
