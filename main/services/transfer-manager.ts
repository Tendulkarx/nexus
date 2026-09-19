/**
 * Orchestrates uploads/downloads. Each transfer runs against its session with a
 * throttled progress stream (~10 Hz) and is cancelable via an AbortController.
 */
import { randomUUID } from "crypto";
import * as path from "path";

import { logger } from "../logger.js";

import { activityLog } from "./activity-log.js";
import { emitToRenderer } from "./ipc-emitter.js";
import { notify } from "./notification-service.js";
import { sessionManager } from "./session-manager.js";
import { TransferCanceledError } from "./sessions/base-session.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type {
  TransferDirection,
  TransferDoneEvent,
  TransferErrorEvent,
  TransferProgressEvent,
} from "@shared/ipc-contract";

const PROGRESS_INTERVAL_MS = 100;

export class TransferManager {
  private controllers = new Map<string, AbortController>();
  private active = new Map<string, { transferred: number; total: number }>();

  start(direction: TransferDirection, sessionId: string, localPath: string, remotePath: string): string {
    // Fire-and-forget; progress and completion flow through events.
    return this.startTracked(direction, sessionId, localPath, remotePath).transferId;
  }

  /**
   * Like `start`, but also hands back a promise that resolves once the
   * transfer finishes (success or failure) — used by callers that queue
   * several transfers as a batch (e.g. directory sync) and need to know when
   * each one is done, while still sharing the same queueing/progress/cancel
   * machinery and events as a manually-started transfer.
   *
   * `silent: true` skips this transfer's own activity-log entry and native
   * notification — used by directory sync, which logs/notifies once for the
   * whole batch instead of once per file (see SyncManager.execute).
   */
  startTracked(
    direction: TransferDirection,
    sessionId: string,
    localPath: string,
    remotePath: string,
    options: { silent?: boolean } = {},
  ): { transferId: string; done: Promise<{ ok: boolean; message?: string }> } {
    const transferId = randomUUID();
    const controller = new AbortController();
    this.controllers.set(transferId, controller);
    this.active.set(transferId, { transferred: 0, total: 0 });

    const done = this.run(
      transferId,
      direction,
      sessionId,
      localPath,
      remotePath,
      controller.signal,
      options.silent ?? false,
    );
    return { transferId, done };
  }

  /** Aggregate progress across every in-flight transfer, for the Dock badge/progress bar. */
  getActiveSummary(): { count: number; progress: number } {
    const entries = Array.from(this.active.values());
    if (entries.length === 0) return { count: 0, progress: 0 };
    const transferred = entries.reduce((sum, e) => sum + e.transferred, 0);
    const total = entries.reduce((sum, e) => sum + e.total, 0);
    return { count: entries.length, progress: total > 0 ? transferred / total : 0 };
  }

  private async run(
    transferId: string,
    direction: TransferDirection,
    sessionId: string,
    localPath: string,
    remotePath: string,
    signal: AbortSignal,
    silent: boolean,
  ): Promise<{ ok: boolean; message?: string }> {
    const session = sessionManager.get(sessionId);
    let lastEmit = 0;
    let lastBytes = 0;
    let lastTime = Date.now();

    const onProgress = (transferred: number, total: number) => {
      this.active.set(transferId, { transferred, total });
      const now = Date.now();
      if (now - lastEmit < PROGRESS_INTERVAL_MS) return;
      const elapsed = (now - lastTime) / 1000;
      const bytesPerSec = elapsed > 0 ? Math.max(0, (transferred - lastBytes) / elapsed) : 0;
      lastEmit = now;
      lastBytes = transferred;
      lastTime = now;
      emitToRenderer(IPC.transfer.progress, {
        transferId,
        transferred,
        total,
        bytesPerSec,
      } satisfies TransferProgressEvent);
    };

    const name = path.basename(direction === "upload" ? localPath : remotePath);

    try {
      if (direction === "upload") {
        await session.upload(localPath, remotePath, onProgress, signal);
      } else {
        await session.download(remotePath, localPath, onProgress, signal);
      }
      emitToRenderer(IPC.transfer.done, { transferId } satisfies TransferDoneEvent);
      if (!silent) {
        const verb = direction === "upload" ? "Uploaded" : "Downloaded";
        activityLog
          .record("transfer-done", `${verb} ${name}`)
          .catch((err) => logger.warn("transfer-manager", "Failed to record activity log entry", err));
        void notify("Transfer complete", `${verb} ${name}`);
      }
      return { ok: true };
    } catch (err) {
      const canceled = err instanceof TransferCanceledError;
      const message = canceled ? "Transfer canceled" : err instanceof Error ? err.message : "Transfer failed";
      logger.warn("transfer-manager", "Transfer ended with error", { transferId, message });
      emitToRenderer(IPC.transfer.error, { transferId, message } satisfies TransferErrorEvent);
      // A user-initiated cancel isn't a failure worth logging/notifying about.
      if (!silent && !canceled) {
        activityLog
          .record("transfer-error", `Failed to transfer ${name}`, message)
          .catch((err2) => logger.warn("transfer-manager", "Failed to record activity log entry", err2));
        void notify("Transfer failed", `${name}: ${message}`);
      }
      return { ok: false, message };
    } finally {
      this.controllers.delete(transferId);
      this.active.delete(transferId);
    }
  }

  cancel(transferId: string): void {
    this.controllers.get(transferId)?.abort();
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.active.clear();
  }
}

export const transferManager = new TransferManager();
