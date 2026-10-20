/**
 * A mosh (mobile shell) session — unlike SshSession/FtpSession, mosh has no
 * file-transfer capability of its own; it's terminal-only (see SessionInfo.kind).
 *
 * Each openShell() call redoes mosh's own two-step bootstrap from scratch:
 * 1. SSH into the target (reusing the same ssh2 machinery as SshSession) and
 *    run `mosh-server`, which allocates a fresh UDP session and prints
 *    "MOSH CONNECT <port> <key>" on stdout, then detaches into the background.
 * 2. Spawn the local `mosh-client` binary with that port/key, which opens the
 *    actual roaming-resilient UDP connection.
 * There's no SSH-style multiplexed channel to reuse across shells the way
 * SshSession.openShell's ssh2 shells share one connection — mosh has no such
 * concept, so every terminal tab against a mosh session gets its own
 * independent mosh-server session, same as running the `mosh` CLI twice.
 *
 * mosh-client needs a real controlling terminal (it puts its stdin into raw
 * mode with tcgetattr and reads the window size from it), so it runs in a
 * node-pty pseudo-terminal — the same PtyChannel local shells use — which
 * also carries resizes through to it.
 */
import { execFile } from "child_process";
import * as fsp from "fs/promises";
import { promisify } from "util";

import { Client } from "ssh2";

import { logger } from "../../logger.js";
import { PtyChannel } from "./local-shell-session.js";
import { connectViaJumpHost, verifyHostKey } from "./ssh-connect.js";

import type { ConnectionProfile } from "@shared/ipc-contract";
import type { SessionInfo } from "@shared/ipc-contract";
import type { TerminalChannel } from "./terminal-channel.js";
import type { ConnectConfig } from "ssh2";

const execFileAsync = promisify(execFile);

/**
 * Parses mosh-server's stdout for its bootstrap line, e.g.
 * "MOSH CONNECT 60001 rjNv0mB4hOsQVjjJ7HjIVA". Exported (pure function, no
 * I/O) so it can be unit tested against sample output without a real server.
 */
export function parseMoshServerOutput(output: string): { port: number; key: string } {
  const match = /^MOSH CONNECT (\d+) (\S+)$/m.exec(output);
  if (!match) {
    throw new Error(
      `Could not find mosh-server's connection info in its output — is mosh-server installed on the remote host?\n${output.trim()}`,
    );
  }
  return { port: Number(match[1]), key: match[2] };
}

/**
 * Apps opened from Finder get launchd's minimal PATH, which has no Homebrew,
 * so the usual install locations are checked as well as `which`.
 */
const MOSH_CLIENT_CANDIDATES = ["/opt/homebrew/bin/mosh-client", "/usr/local/bin/mosh-client", "/opt/local/bin/mosh-client"];

async function findMoshClient(): Promise<string> {
  for (const candidate of MOSH_CLIENT_CANDIDATES) {
    if (await fsp.access(candidate, fsp.constants.X_OK).then(() => true, () => false)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync("which", ["mosh-client"]);
    const path = stdout.trim();
    if (!path) throw new Error("empty");
    return path;
  } catch {
    throw new Error("Mosh isn't installed — run `brew install mosh`");
  }
}

export class MoshSession {
  readonly info: SessionInfo;
  readonly onConnectCommand: string | null;
  /**
   * No OSC 7 hook: mosh-client redraws from its own screen state and drops
   * OSC sequences, so neither the cwd reports nor the hook's ready marker
   * would get through (and there's no file pane to follow).
   */
  readonly injectShellIntegration = false;
  private readonly profile: ConnectionProfile;
  private readonly secret: string | null;
  private readonly jumpSecret: string | null;
  private readonly moshClientPath: string;

  private constructor(
    sessionId: string,
    profile: ConnectionProfile,
    secret: string | null,
    jumpSecret: string | null,
    moshClientPath: string,
  ) {
    this.profile = profile;
    this.secret = secret;
    this.jumpSecret = jumpSecret;
    this.moshClientPath = moshClientPath;
    this.onConnectCommand = profile.onConnectCommand ?? null;
    this.info = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: profile.username,
      homeDir: "",
      supportsTerminal: true,
      kind: "terminal",
    };
  }

  /**
   * Checks that mosh-client is installed locally and builds the session
   * object — deliberately doesn't touch the network yet (same philosophy as
   * DisplaySession: the real work happens lazily, here in openShell(), once
   * a terminal tab actually needs a shell).
   */
  static async connect(
    sessionId: string,
    profile: ConnectionProfile,
    secret: string | null,
    jumpSecret: string | null = null,
  ): Promise<MoshSession> {
    if (profile.protocol !== "mosh") {
      throw new Error(`MoshSession created for non-mosh protocol: ${profile.protocol}`);
    }
    const moshClientPath = await findMoshClient();
    return new MoshSession(sessionId, profile, secret, jumpSecret, moshClientPath);
  }

  async openShell(cols: number, rows: number): Promise<TerminalChannel> {
    const { port, key } = await this.bootstrapMoshServer();
    logger.info("mosh", "Bootstrapped mosh-server, spawning local mosh-client", {
      sessionId: this.info.sessionId,
      port,
    });
    return this.spawnMoshClient(port, key, cols, rows);
  }

  private async spawnMoshClient(port: number, key: string, cols: number, rows: number): Promise<TerminalChannel> {
    const pty = await import("node-pty");
    const proc = pty.spawn(this.moshClientPath, [this.profile.host, String(port)], {
      name: "xterm-256color",
      cols: Math.max(cols, 1),
      rows: Math.max(rows, 1),
      // mosh-client refuses to start without a UTF-8 locale, and Finder-launched apps often have none.
      env: { ...process.env, TERM: "xterm-256color", LANG: process.env.LANG || "en_US.UTF-8", MOSH_KEY: key },
    });
    return new PtyChannel(proc);
  }

  /** SSHes into the target, runs mosh-server, and parses its bootstrap output. */
  private async bootstrapMoshServer(): Promise<{ port: number; key: string }> {
    const host = this.profile.host;
    const port = this.profile.port || 22;
    const config: ConnectConfig = {
      host,
      port,
      username: this.profile.username,
      readyTimeout: 20_000,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        verifyHostKey(host, port, key)
          .then(verify)
          .catch((err) => {
            logger.error("mosh", "Host key verification failed", err);
            verify(false);
          });
      },
    };

    if (this.profile.authType === "key") {
      if (!this.profile.privateKeyPath) {
        throw new Error("Key authentication selected but no private key file was provided");
      }
      config.privateKey = await fsp.readFile(this.profile.privateKeyPath);
      if (this.secret) config.passphrase = this.secret;
    } else {
      if (!this.secret) throw new Error("No password provided for this connection");
      config.password = this.secret;
    }

    let jumpClient: Client | null = null;
    if (this.profile.jumpHost) {
      const jump = await connectViaJumpHost(this.profile.jumpHost, this.jumpSecret, host, port);
      jumpClient = jump.client;
      config.sock = jump.sock;
    }

    const client = new Client();
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("ready", resolve);
        client.once("error", reject);
        client.connect(config);
      });

      const output = await new Promise<string>((resolve, reject) => {
        // Forcing a UTF-8 locale matters here — mosh-server refuses to start
        // ("needs a UTF-8 native locale to run") when the remote shell's
        // default locale isn't UTF-8, which is common on a bare `exec` (no
        // login-shell environment/locale negotiation like an interactive SSH
        // session would get).
        client.exec("LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 mosh-server new -s", (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let stdout = "";
          let stderr = "";
          stream.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf-8");
          });
          stream.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf-8");
          });
          stream.on("error", reject);
          stream.on("close", () => {
            if (stdout.includes("MOSH CONNECT")) resolve(stdout);
            else reject(new Error(stderr.trim() || "mosh-server produced no output — is it installed on the remote host?"));
          });
        });
      });

      return parseMoshServerOutput(output);
    } finally {
      client.end();
      jumpClient?.end();
    }
  }

  async close(): Promise<void> {
    // Nothing persistent to tear down here — each openShell() call's SSH
    // bootstrap connection already closed itself; TerminalService owns the
    // lifecycle of the spawned mosh-client processes (PtyChannel.close()).
  }
}
