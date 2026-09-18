/**
 * A live connection to a remote host. Concrete implementations wrap SFTP/SSH
 * (SshSession) or FTP/FTPS (FtpSession).
 */
import type { DirListing, SessionInfo } from "@shared/ipc-contract";

export type ProgressCallback = (transferred: number, total: number) => void;

/** Thrown by a transfer when its AbortSignal fires — surfaced as "canceled". */
export class TransferCanceledError extends Error {
  constructor() {
    super("__transfer_canceled__");
    this.name = "TransferCanceledError";
  }
}

export abstract class BaseSession {
  abstract readonly info: SessionInfo;

  abstract list(remotePath: string): Promise<DirListing>;
  abstract mkdir(remotePath: string): Promise<void>;
  abstract rename(from: string, to: string): Promise<void>;
  abstract delete(remotePath: string, isDir: boolean): Promise<void>;

  abstract upload(
    localPath: string,
    remotePath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void>;

  abstract download(
    remotePath: string,
    localPath: string,
    onProgress: ProgressCallback,
    signal: AbortSignal,
  ): Promise<void>;

  /** Reads up to maxBytes of a remote file into memory (for preview/edit). */
  abstract readFile(remotePath: string, maxBytes: number): Promise<Buffer>;

  /** Uploads a local file to a remote path without transfer-queue progress. */
  abstract putFile(localPath: string, remotePath: string): Promise<void>;

  abstract close(): Promise<void>;
}
