/**
 * SFTP/SSH session backed by ssh2-sftp-client. File operations use the SFTP
 * subsystem; interactive terminals reuse the same connection's SSH client.
 */
import * as fsp from "fs/promises";
import * as posix from "path/posix";

import { dialog } from "electron";
import { Client } from "ssh2";
import SftpClient from "ssh2-sftp-client";

import { BaseSession, TransferCanceledError, type ProgressCallback } from "./base-session.js";
import { fingerprintKey, knownHostsStore } from "../known-hosts-store.js";
import { logger } from "../../logger.js";

import type { ConnectionProfile, JumpHost } from "@shared/ipc-contract";
import type { DirListing, FsEntry, SessionInfo } from "@shared/ipc-contract";
import type {
  AcceptConnection,
  ClientChannel,
  ConnectConfig,
  RejectConnection,
  TcpConnectionDetails,
} from "ssh2";

/**
 * Trust-on-first-use host key verification. First connection to a host:port
 * records its key fingerprint; later connections compare against it and
 * block (with a native warning dialog) on mismatch, since that indicates a
 * possible MITM attack or a reinstalled/rotated server host key.
 */
async function verifyHostKey(host: string, port: number, key: Buffer): Promise<boolean> {
  const fingerprint = fingerprintKey(key);
  const stored = await knownHostsStore.get(host, port);

  if (!stored) {
    await knownHostsStore.trust(host, port, fingerprint);
    logger.info("ssh", "Trusting new host key on first use", { host, port });
    return true;
  }

  if (stored === fingerprint) {
    return true;
  }

  logger.warn("ssh", "Host key mismatch — possible MITM or reinstalled server", { host, port });
  const result = await dialog.showMessageBox({
    type: "warning",
    title: "Host Key Changed",
    message: `The host key for ${host}:${port} has changed since you last connected.`,
    detail:
      "This could mean the server was reinstalled or its key was rotated — or it could mean someone is " +
      "intercepting your connection. Only continue if you're sure this is expected.",
    buttons: ["Cancel", "Connect Anyway"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (result.response === 1) {
    await knownHostsStore.trust(host, port, fingerprint);
    logger.warn("ssh", "User accepted new host key after mismatch warning", { host, port });
    return true;
  }

  return false;
}

/**
 * Connects to a jump/bastion host as a plain ssh2 Client (no SFTP needed
 * there), then opens a direct-tcpip channel through it to the real target.
 * That channel is handed to the target's own connection as `sock`, so the
 * target's SSH handshake tunnels entirely inside the jump host's
 * already-authenticated connection instead of a second real TCP connection.
 */
async function connectViaJumpHost(
  jump: JumpHost,
  jumpSecret: string | null,
  targetHost: string,
  targetPort: number,
): Promise<{ client: Client; sock: ClientChannel }> {
  const jumpHostAddr = jump.host;
  const jumpPort = jump.port || 22;
  const config: ConnectConfig = {
    host: jumpHostAddr,
    port: jumpPort,
    username: jump.username,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
    hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
      verifyHostKey(jumpHostAddr, jumpPort, key)
        .then(verify)
        .catch((err) => {
          logger.error("ssh", "Jump host key verification failed", err);
          verify(false);
        });
    },
  };

  if (jump.authType === "key") {
    if (!jump.privateKeyPath) {
      throw new Error("Jump host key authentication selected but no private key file was provided");
    }
    config.privateKey = await fsp.readFile(jump.privateKeyPath);
    if (jumpSecret) config.passphrase = jumpSecret;
  } else {
    if (!jumpSecret) throw new Error("No password provided for the jump host connection");
    config.password = jumpSecret;
  }

  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect(config);
  });

  try {
    const sock = await new Promise<ClientChannel>((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
    return { client, sock };
  } catch (err) {
    client.end();
    throw err;
  }
}

export class SshSession extends BaseSession {
  readonly info: SessionInfo;
  /** Command(s) to auto-type into each new shell opened on this session, one per line — see SshTerminalService.open(). */
  readonly onConnectCommand: string | null;
  private sftp: SftpClient;
  private jumpClient: Client | null;

  private constructor(
    sftp: SftpClient,
    info: SessionInfo,
    onConnectCommand: string | null,
    jumpClient: Client | null = null,
  ) {
    super();
    this.sftp = sftp;
    this.info = info;
    this.onConnectCommand = onConnectCommand;
    this.jumpClient = jumpClient;
  }

  static async connect(
    sessionId: string,
    profile: ConnectionProfile,
    secret: string | null,
    jumpSecret: string | null = null,
  ): Promise<SshSession> {
    const sftp = new SftpClient(sessionId);
    const host = profile.host;
    const port = profile.port || 22;
    const config: ConnectConfig = {
      host,
      port,
      username: profile.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        verifyHostKey(host, port, key)
          .then(verify)
          .catch((err) => {
            logger.error("ssh", "Host key verification failed", err);
            verify(false);
          });
      },
    };

    if (profile.authType === "key") {
      if (!profile.privateKeyPath) {
        throw new Error("Key authentication selected but no private key file was provided");
      }
      config.privateKey = await fsp.readFile(profile.privateKeyPath);
      if (secret) config.passphrase = secret;
    } else {
      if (!secret) throw new Error("No password provided for this connection");
      config.password = secret;
    }

    if (profile.agentForward) {
      if (process.env.SSH_AUTH_SOCK) {
        config.agent = process.env.SSH_AUTH_SOCK;
        config.agentForward = true;
      } else {
        logger.warn("ssh", "Agent forwarding requested but SSH_AUTH_SOCK is not set — skipping", { host, port });
      }
    }

    let jumpClient: Client | null = null;
    if (profile.jumpHost) {
      const jump = await connectViaJumpHost(profile.jumpHost, jumpSecret, host, port);
      jumpClient = jump.client;
      config.sock = jump.sock;
    }

    try {
      await sftp.connect(config);
    } catch (err) {
      jumpClient?.end();
      throw err;
    }
    const homeDir = await sftp.cwd();

    const info: SessionInfo = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: profile.username,
      homeDir: homeDir || ".",
      supportsTerminal: true,
      kind: "file",
    };
    return new SshSession(sftp, info, profile.onConnectCommand ?? null, jumpClient);
  }

  async list(remotePath: string): Promise<DirListing> {
    const items = await this.sftp.list(remotePath);
    const entries: FsEntry[] = items.map((item) => ({
      name: item.name,
      path: posix.join(remotePath, item.name),
      isDir: item.type === "d",
      size: item.size,
      mtime: item.modifyTime,
      permissions: item.longname.slice(0, 10),
      symlink: item.type === "l",
    }));
    return { path: remotePath, entries };
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.sftp.mkdir(remotePath, true);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.sftp.rename(from, to);
  }

  async delete(remotePath: string, isDir: boolean): Promise<void> {
    if (isDir) {
      await this.sftp.rmdir(remotePath, true);
    } else {
      await this.sftp.delete(remotePath);
    }
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void> {
    await this.transfer(() =>
      this.sftp.fastPut(localPath, remotePath, {
        step: (transferred, _chunk, total) => {
          if (signal.aborted) throw new TransferCanceledError();
          onProgress(transferred, total);
        },
      }),
    );
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void> {
    await this.transfer(() =>
      this.sftp.fastGet(remotePath, localPath, {
        step: (transferred, _chunk, total) => {
          if (signal.aborted) throw new TransferCanceledError();
          onProgress(transferred, total);
        },
      }),
    );
  }

  async readFile(remotePath: string, maxBytes: number): Promise<Buffer> {
    // Bounded stream read so a huge remote file never loads fully into memory.
    const stream = this.sftp.createReadStream(remotePath);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= maxBytes) {
        stream.destroy();
        break;
      }
    }
    return Buffer.concat(chunks).subarray(0, maxBytes);
  }

  async putFile(localPath: string, remotePath: string): Promise<void> {
    await this.sftp.fastPut(localPath, remotePath);
  }

  /** Normalizes the "throw from step callback" abort into a TransferCanceledError. */
  private async transfer(run: () => Promise<string>): Promise<void> {
    try {
      await run();
    } catch (err) {
      if (err instanceof TransferCanceledError) throw err;
      if (err instanceof Error && err.message.includes("__transfer_canceled__")) {
        throw new TransferCanceledError();
      }
      throw err;
    }
  }

  /**
   * Runs a single non-interactive command over the existing SSH connection
   * (e.g. remote search's `grep -r`) and collects its output. Does not throw
   * on a non-zero exit code — callers decide what that means for their command.
   */
  exec(command: string, timeoutMs = 20_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      this.sftp.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          stream.destroy();
          reject(new Error("Command timed out"));
        }, timeoutMs);
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf-8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        });
        stream.on("error", (streamErr: Error) => {
          clearTimeout(timer);
          reject(streamErr);
        });
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  /** Opens an interactive shell channel over the existing SSH connection. */
  openShell(cols: number, rows: number): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.sftp.client.shell(
        { term: "xterm-256color", cols, rows },
        (err: Error | undefined, channel: ClientChannel) => {
          if (err) reject(err);
          else resolve(channel);
        },
      );
    });
  }

  /** Opens a direct-tcpip channel through this session (local (-L) forwards and the dynamic/SOCKS proxy). */
  forwardOut(srcHost: string, srcPort: number, dstHost: string, dstPort: number): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.sftp.client.forwardOut(srcHost, srcPort, dstHost, dstPort, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
  }

  /** Asks the remote server to listen on bindHost:bindPort and forward connections back here (remote (-R) forwards). */
  forwardIn(bindHost: string, bindPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.sftp.client.forwardIn(bindHost, bindPort, (err, port) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  }

  unforwardIn(bindHost: string, bindPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.client.unforwardIn(bindHost, bindPort, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Subscribes to inbound connections on a remote forward opened via forwardIn(). Returns an unsubscribe function. */
  onTcpConnection(
    handler: (
      details: TcpConnectionDetails,
      accept: AcceptConnection<ClientChannel>,
      reject: RejectConnection,
    ) => void,
  ): () => void {
    this.sftp.client.on("tcp connection", handler);
    return () => this.sftp.client.removeListener("tcp connection", handler);
  }

  async close(): Promise<void> {
    try {
      await this.sftp.end();
    } catch {
      // Best-effort teardown.
    }
    if (this.jumpClient) {
      try {
        this.jumpClient.end();
      } catch {
        // Best-effort teardown.
      }
    }
  }
}
