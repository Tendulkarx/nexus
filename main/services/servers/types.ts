import type { LocalServerConfig } from "@shared/ipc-contract";

/** What every local server gets from ServerManager. */
export interface ServerContext {
  config: LocalServerConfig;
  /** The address to listen on: 0.0.0.0 for the local network, 127.0.0.1 for this Mac only. */
  host: string;
  /** App data folder, for state a server keeps between runs (the SFTP host key). */
  dataDir: string;
  log(line: string): void;
  /** The server died on its own after starting (e.g. iperf3 exited). */
  onFatal(error: Error): void;
}

export interface RunningServer {
  stop(): Promise<void>;
}

export type ServerStarter = (ctx: ServerContext) => Promise<RunningServer>;
