/**
 * A shell on this Mac — the user's login shell in a real pseudo-terminal via
 * node-pty, so full-screen programs (vim, htop, less) and job control work.
 * Terminal-only like MoshSession (SessionInfo.kind "terminal"): no filesystem,
 * no connection, nothing to authenticate. Every openShell() spawns its own
 * shell process; close() kills any still running.
 *
 * node-pty is imported lazily so a broken native build only breaks local
 * shells, not app startup. Its macOS prebuilds need build/fix-node-pty-
 * permissions.cjs (run on postinstall) or every spawn fails with
 * "posix_spawnp failed.".
 */
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import * as os from "os";

import { logger } from "../../logger.js";
import { appSettingsStore } from "../app-settings-store.js";
import { expandHome } from "../../../renderer/shared/preferences.js";

import type { SessionInfo } from "@shared/ipc-contract";
import type { IPty } from "node-pty";
import type { TerminalCapableSession, TerminalChannel } from "./terminal-channel.js";

/** Adapts a node-pty process to the TerminalChannel shape TerminalService expects. */
export class PtyChannel extends EventEmitter implements TerminalChannel {
  private exited = false;

  constructor(private readonly pty: IPty) {
    super();
    pty.onData((data) => this.emit("data", data));
    pty.onExit(({ exitCode }) => {
      this.exited = true;
      this.emit("exit", exitCode);
    });
  }

  write(data: string): void {
    if (!this.exited) this.pty.write(data);
  }

  setWindow(rows: number, cols: number): void {
    // xterm can report 0×0 while its container is hidden; node-pty rejects that.
    if (this.exited || rows < 1 || cols < 1) return;
    this.pty.resize(cols, rows);
  }

  close(): void {
    if (this.exited) return;
    this.pty.kill();
  }
}

/** The user's login shell: $SHELL, falling back to zsh (the macOS default). */
export function resolveLoginShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL && env.SHELL.startsWith("/") ? env.SHELL : "/bin/zsh";
}

/** The configured start folder if it exists, else home (a missing folder would make spawn fail). */
async function existingDir(dir: string): Promise<string> {
  if (!dir) return os.homedir();
  const stat = await fs.stat(dir).catch(() => null);
  return stat?.isDirectory() ? dir : os.homedir();
}

export class LocalShellSession implements TerminalCapableSession {
  readonly info: SessionInfo;
  readonly onConnectCommand = null;
  /** There's no remote file pane to follow, so don't type the OSC 7 hook into the user's own shell. */
  readonly injectShellIntegration = false;
  private readonly channels = new Set<PtyChannel>();

  constructor(sessionId: string) {
    const user = os.userInfo().username;
    const host = os.hostname().replace(/\.local$/, "");
    this.info = {
      sessionId,
      profileId: null,
      name: "Local shell",
      protocol: "local",
      host,
      username: user,
      homeDir: os.homedir(),
      supportsTerminal: true,
      kind: "terminal",
    };
  }

  async openShell(cols: number, rows: number): Promise<TerminalChannel> {
    const pty = await import("node-pty");
    const prefs = (await appSettingsStore.getPreferences()).localShell;
    const shell = prefs.shell || resolveLoginShell();
    const cwd = await existingDir(expandHome(prefs.startDir, os.homedir()));
    const proc = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: Math.max(cols, 1),
      rows: Math.max(rows, 1),
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Nexus" },
    });
    logger.info("local-shell", "Spawned local shell", { sessionId: this.info.sessionId, shell, pid: proc.pid });

    const channel = new PtyChannel(proc);
    this.channels.add(channel);
    channel.on("exit", () => this.channels.delete(channel));
    return channel;
  }

  async close(): Promise<void> {
    for (const channel of this.channels) channel.close();
    this.channels.clear();
  }
}
