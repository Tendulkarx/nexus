/**
 * SFTP/SSH session backed by ssh2-sftp-client. File operations use the SFTP
 * subsystem; interactive terminals reuse the same connection's SSH client.
 */
import * as fsp from "fs/promises";
import * as posix from "path/posix";

import SftpClient from "ssh2-sftp-client";

import { BaseSession, TransferCanceledError, type ProgressCallback } from "./base-session.js";

import type { ConnectionProfile } from "@shared/ipc-contract";
import type { DirListing, FsEntry, SessionInfo } from "@shared/ipc-contract";
import type { ClientChannel, ConnectConfig } from "ssh2";

export class SshSession extends BaseSession {
  readonly info: SessionInfo;
  private sftp: SftpClient;

  private constructor(sftp: SftpClient, info: SessionInfo) {
    super();
    this.sftp = sftp;
    this.info = info;
  }

  static async connect(
    sessionId: string,
    profile: ConnectionProfile,
    secret: string | null,
  ): Promise<SshSession> {
    const sftp = new SftpClient(sessionId);
    const config: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
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

    await sftp.connect(config);
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
    };
    return new SshSession(sftp, info);
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

  async close(): Promise<void> {
    try {
      await this.sftp.end();
    } catch {
      // Best-effort teardown.
    }
  }
}
