/**
 * Runs port and network scans in the background, keyed by scanId. Progress
 * is batched (at most every PROGRESS_INTERVAL_MS) so a 65k-port scan doesn't
 * send 65k IPC messages, and every scan ends with exactly one scan:done event,
 * including after cancel() or an error.
 */
import { randomUUID } from "crypto";
import { promises as dns } from "dns";

import { logger } from "../../logger.js";
import { emitToRenderer } from "../ipc-emitter.js";

import { expandCidr, probeHost } from "./network-scan.js";
import { COMMON_PORTS, parsePortList, probeTcpPort, runPool } from "./port-scan.js";

import { IPC } from "../../../renderer/shared/ipc-contract.js";
import type {
  NetworkHost,
  NetworkScanProgressEvent,
  PortScanHit,
  PortScanProgressEvent,
  ScanDoneEvent,
  ScanStartResult,
} from "@shared/ipc-contract";

const PROGRESS_INTERVAL_MS = 150;
const PORT_CONCURRENCY = 200;
const HOST_CONCURRENCY = 64;
const DEFAULT_PORT_TIMEOUT_MS = 800;

/** Collects results between progress events and flushes them on a timer. */
class ProgressBatcher<T> {
  private pending: T[] = [];
  private done = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly flushTo: (done: number, items: T[]) => void) {}

  record(item?: T): void {
    this.done++;
    if (item) this.pending.push(item);
    this.timer ??= setTimeout(() => this.flush(), PROGRESS_INTERVAL_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const items = this.pending;
    this.pending = [];
    this.flushTo(this.done, items);
  }
}

export class ScanService {
  private running = new Map<string, AbortController>();

  async startPortScan(host: string, portSpec: string, timeoutMs = DEFAULT_PORT_TIMEOUT_MS): Promise<ScanStartResult> {
    const ports = parsePortList(portSpec);
    // Resolve once up front so a typo fails immediately instead of as 65k "filtered" ports.
    const { address } = await dns.lookup(host.trim()).catch(() => {
      throw new Error(`Couldn't resolve "${host}"`);
    });

    const scanId = randomUUID();
    const batcher = new ProgressBatcher<PortScanHit>((done, open) =>
      emitToRenderer(IPC.tools.portScanProgress, {
        scanId,
        done,
        total: ports.length,
        open,
      } satisfies PortScanProgressEvent),
    );

    this.run(scanId, `port scan of ${host} (${ports.length} ports)`, async (signal) => {
      await runPool(ports, PORT_CONCURRENCY, signal, async (port) => {
        const result = await probeTcpPort(address, port, timeoutMs);
        batcher.record(
          result.state === "open"
            ? { port, service: COMMON_PORTS[port] ?? null, latencyMs: result.latencyMs }
            : undefined,
        );
      });
      batcher.flush();
    });
    return { scanId, total: ports.length };
  }

  startNetworkScan(cidr: string): ScanStartResult {
    const addresses = expandCidr(cidr);
    const scanId = randomUUID();
    const batcher = new ProgressBatcher<NetworkHost>((done, hosts) =>
      emitToRenderer(IPC.tools.networkScanProgress, {
        scanId,
        done,
        total: addresses.length,
        hosts,
      } satisfies NetworkScanProgressEvent),
    );

    this.run(scanId, `network scan of ${cidr}`, async (signal) => {
      await runPool(addresses, HOST_CONCURRENCY, signal, async (address) => {
        batcher.record((await probeHost(address)) ?? undefined);
      });
      batcher.flush();
    });
    return { scanId, total: addresses.length };
  }

  cancel(scanId: string): void {
    this.running.get(scanId)?.abort();
  }

  cancelAll(): void {
    for (const controller of this.running.values()) controller.abort();
  }

  private run(scanId: string, label: string, body: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    this.running.set(scanId, controller);
    logger.info("tools", `Started ${label}`, { scanId });
    // Deferred so the start reply (carrying scanId) reaches the renderer before
    // any progress or done event; otherwise a tiny scan could finish unclaimed.
    void new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => body(controller.signal))
      .then(
        () => ({ scanId, canceled: controller.signal.aborted }) satisfies ScanDoneEvent,
        (err: unknown) => {
          logger.warn("tools", `${label} failed`, err);
          const error = err instanceof Error ? err.message : String(err);
          return { scanId, canceled: false, error } satisfies ScanDoneEvent;
        },
      )
      .then((done) => {
        this.running.delete(scanId);
        emitToRenderer(IPC.tools.scanDone, done);
      });
  }
}

export const scanService = new ScanService();
