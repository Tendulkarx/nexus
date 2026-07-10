/**
 * FTP/FTPS session backed by basic-ftp. Uses two control connections: one for
 * browsing and one for transfers, so a long transfer never blocks navigation.
 * FTP has no interactive shell, so this session does not support terminals.
 */
import * as fsp from "fs/promises";
import * as posix from "path/posix";

import { Client, FileType, type AccessOptions } from "basic-ftp";

import { BaseSession, TransferCanceledError, type ProgressCallback } from "./base-session.js";

import type { ConnectionProfile } from "@shared/ipc-contract";
import type { DirListing, FsEntry, SessionInfo } from "@shared/ipc-contract";

export class FtpSession extends BaseSession {
  readonly info: SessionInfo;
  private browseClient: Client;
  private transferClient: Client | null = null;
  private transferClientDead = false;

  private constructor(
    browseClient: Client,
    info: SessionInfo,
    private readonly access: AccessOptions,
  ) {
    super();
    this.browseClient = browseClient;
    this.info = info;
  }

  static async connect(
    sessionId: string,
    profile: ConnectionProfile,
    secret: string | null,
  ): Promise<FtpSession> {
    const access: AccessOptions = {
      host: profile.host,
      port: profile.port || 21,
      user: profile.username,
      password: secret ?? "",
      secure: profile.protocol === "ftps",
    };

    const browseClient = new Client(30_000);
    await browseClient.access(access);
    const home = await browseClient.pwd();

    const info: SessionInfo = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: profile.username,
      homeDir: home || "/",
      supportsTerminal: false,
    };
    return new FtpSession(browseClient, info, access);
  }

  private async getTransferClient(): Promise<Client> {
    if (!this.transferClient || this.transferClientDead) {
      this.transferClient = new Client(0); // no idle timeout during long transfers
      await this.transferClient.access(this.access);
      this.transferClientDead = false;
    }
    return this.transferClient;
  }

  async list(remotePath: string): Promise<DirListing> {
    const items = await this.browseClient.list(remotePath);
    const entries: FsEntry[] = items.map((item) => ({
      name: item.name,
      path: posix.join(remotePath, item.name),
      isDir: item.type === FileType.Directory,
      size: item.size,
      mtime: item.modifiedAt ? item.modifiedAt.getTime() : 0,
      symlink: item.type === FileType.SymbolicLink,
    }));
    return { path: remotePath, entries };
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.browseClient.ensureDir(remotePath);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.browseClient.rename(from, to);
  }

  async delete(remotePath: string, isDir: boolean): Promise<void> {
    if (isDir) {
      await this.browseClient.removeDir(remotePath);
    } else {
      await this.browseClient.remove(remotePath);
    }
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const total = (await fsp.stat(localPath)).size;
    const client = await this.getTransferClient();
    await this.runTransfer(client, signal, () => {
      client.trackProgress((info) => onProgress(info.bytes, total));
      return client.uploadFrom(localPath, remotePath);
    });
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const client = await this.getTransferClient();
    let total = 0;
    try {
      total = await client.size(remotePath);
    } catch {
      // Server may not support SIZE — progress will report against 0 total.
    }
    await this.runTransfer(client, signal, () => {
      client.trackProgress((info) => onProgress(info.bytes, total));
      return client.downloadTo(localPath, remotePath);
    });
  }

  /** Wires cancellation (closing the transfer client aborts the in-flight op). */
  private async runTransfer(
    client: Client,
    signal: AbortSignal,
    run: () => Promise<unknown>,
  ): Promise<void> {
    const onAbort = () => {
      this.transferClientDead = true;
      client.close();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await run();
    } catch (err) {
      if (signal.aborted) throw new TransferCanceledError();
      throw err;
    } finally {
      client.trackProgress();
      signal.removeEventListener("abort", onAbort);
    }
  }

  async close(): Promise<void> {
    try {
      this.browseClient.close();
    } catch {
      // Best-effort.
    }
    try {
      this.transferClient?.close();
    } catch {
      // Best-effort.
    }
  }
}
