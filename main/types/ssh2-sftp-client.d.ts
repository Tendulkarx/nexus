/**
 * Minimal ambient declaration for ssh2-sftp-client v10 (ships no bundled types).
 * Only the surface Nexus uses is declared.
 */
declare module "ssh2-sftp-client" {
  import type { Readable } from "stream";
  import type { Client as SSH2Client, ConnectConfig } from "ssh2";

  export interface FileInfo {
    /** "d" = directory, "-" = file, "l" = symlink */
    type: "d" | "-" | "l";
    name: string;
    size: number;
    /** epoch ms */
    modifyTime: number;
    /** epoch ms */
    accessTime: number;
    rights: { user: string; group: string; other: string };
    owner: number;
    group: number;
    longname: string;
  }

  export interface TransferOptions {
    /** ssh2 fastGet/fastPut step callback: (totalTransferred, chunkLength, total) */
    step?: (totalTransferred: number, chunk: number, total: number) => void;
    mode?: number | string;
    concurrency?: number;
    chunkSize?: number;
  }

  export default class SftpClient {
    constructor(name?: string);
    /** Underlying ssh2 client — used to open an interactive shell channel. */
    client: SSH2Client;
    connect(config: ConnectConfig): Promise<unknown>;
    list(remotePath: string): Promise<FileInfo[]>;
    exists(remotePath: string): Promise<false | "d" | "-" | "l">;
    stat(remotePath: string): Promise<{ size: number; isDirectory: boolean; isFile: boolean }>;
    createReadStream(remotePath: string, options?: Record<string, unknown>): Readable;
    cwd(): Promise<string>;
    realPath(remotePath: string): Promise<string>;
    fastGet(remotePath: string, localPath: string, options?: TransferOptions): Promise<string>;
    fastPut(localPath: string, remotePath: string, options?: TransferOptions): Promise<string>;
    mkdir(remotePath: string, recursive?: boolean): Promise<string>;
    rmdir(remotePath: string, recursive?: boolean): Promise<string>;
    delete(remotePath: string, notFoundOK?: boolean): Promise<string>;
    rename(fromPath: string, toPath: string): Promise<string>;
    end(): Promise<boolean>;
    on(event: string, callback: (...args: unknown[]) => void): this;
  }
}
