/**
 * Starts and stops the local servers (one of each kind) and reports their
 * status to the renderer on every change and log line. Everything stops on
 * app quit.
 */
import { app } from "electron";

import { logger } from "../../logger.js";
import { emitToRenderer } from "../ipc-emitter.js";
import { localNetworks } from "../tools/network-scan.js";

import { startHttpServer } from "./http-server.js";
import { startIperfServer } from "./iperf-server.js";
import { startSftpServer } from "./sftp-server.js";
import { startTftpServer } from "./tftp-server.js";

import { IPC } from "../../../renderer/shared/ipc-contract.js";
import type { LocalServerConfig, LocalServerKind, LocalServerStatus } from "@shared/ipc-contract";
import type { RunningServer, ServerStarter } from "./types.js";

const KINDS: LocalServerKind[] = ["http", "tftp", "sftp", "iperf3"];
const STARTERS: Record<LocalServerKind, ServerStarter> = {
  http: startHttpServer,
  tftp: startTftpServer,
  sftp: startSftpServer,
  iperf3: startIperfServer,
};
const LOG_LINES = 50;

interface Slot {
  status: LocalServerStatus;
  running: RunningServer | null;
}

export class ServerManager {
  private slots = new Map<LocalServerKind, Slot>(
    KINDS.map((kind) => [
      kind,
      {
        running: null,
        status: { kind, running: false, config: null, addresses: [], startedAt: null, error: null, log: [] },
      },
    ]),
  );

  list(): LocalServerStatus[] {
    return KINDS.map((kind) => this.slots.get(kind)!.status);
  }

  async start(config: LocalServerConfig): Promise<LocalServerStatus> {
    validate(config);
    const slot = this.slots.get(config.kind)!;
    if (slot.running) await this.stop(config.kind);

    const host = config.lan ? "0.0.0.0" : "127.0.0.1";
    const publicConfig: LocalServerConfig = { ...config, password: undefined };
    slot.status = { ...slot.status, config: publicConfig, error: null, log: [] };
    try {
      slot.running = await STARTERS[config.kind]({
        config,
        host,
        dataDir: app.getPath("userData"),
        log: (line) => this.log(config.kind, line),
        onFatal: (error) => void this.handleFatal(config.kind, error),
      });
    } catch (err) {
      const error = friendlyError(err, config);
      logger.warn("servers", `Failed to start ${config.kind}`, err);
      return this.update(config.kind, { running: false, error });
    }
    logger.info("servers", `Started ${config.kind}`, { port: config.port, lan: config.lan });
    return this.update(config.kind, {
      running: true,
      startedAt: Date.now(),
      addresses: serverAddresses(config),
    });
  }

  async stop(kind: LocalServerKind): Promise<LocalServerStatus> {
    const slot = this.slots.get(kind)!;
    const running = slot.running;
    slot.running = null;
    if (running) await running.stop().catch((err) => logger.warn("servers", `Error stopping ${kind}`, err));
    return this.update(kind, { running: false, startedAt: null, addresses: [] });
  }

  async stopAll(): Promise<void> {
    await Promise.all(KINDS.map((kind) => this.stop(kind)));
  }

  private async handleFatal(kind: LocalServerKind, error: Error) {
    this.slots.get(kind)!.running = null;
    this.update(kind, { running: false, startedAt: null, addresses: [], error: error.message });
  }

  private log(kind: LocalServerKind, line: string) {
    const slot = this.slots.get(kind)!;
    const stamped = `${new Date().toLocaleTimeString("en-GB")}  ${line}`;
    this.update(kind, { log: [...slot.status.log, stamped].slice(-LOG_LINES) });
  }

  private update(kind: LocalServerKind, patch: Partial<LocalServerStatus>): LocalServerStatus {
    const slot = this.slots.get(kind)!;
    slot.status = { ...slot.status, ...patch };
    emitToRenderer(IPC.servers.status, slot.status);
    return slot.status;
  }
}

function validate(config: LocalServerConfig) {
  if (!KINDS.includes(config.kind)) throw new Error(`Unknown server "${config.kind}"`);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Port must be 1-65535");
  if (config.kind !== "iperf3" && !config.rootDir) throw new Error("Choose a folder to share");
}

function friendlyError(err: unknown, config: LocalServerConfig): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EADDRINUSE") return `Port ${config.port} is already in use by another program`;
  if (code === "EACCES") return `Not allowed to use port ${config.port}`;
  if (code === "ENOENT" && config.rootDir) return `Folder not found: ${config.rootDir}`;
  return err instanceof Error ? err.message : String(err);
}

/** Where clients should connect: every LAN address, or just loopback. */
function serverAddresses(config: LocalServerConfig): string[] {
  const hosts = config.lan ? localNetworks().map((n) => n.address) : [];
  hosts.push("127.0.0.1");
  return hosts.map((h) => `${h}:${config.port}`);
}

export const serverManager = new ServerManager();
