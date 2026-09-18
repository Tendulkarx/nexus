/**
 * Orchestrates uploads/downloads. Each transfer runs against its session with a
 * throttled progress stream (~10 Hz) and is cancelable via an AbortController.
 */
import { randomUUID } from "crypto";

import { logger } from "../logger.js";

import { emitToRenderer } from "./ipc-emitter.js";
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

  start(
    direction: TransferDirection,
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): string {
    // Fire-and-forget; progress and completion flow through events.
    return this.startTracked(direction, sessionId, localPath, remotePath).transferId;
  }

  /**
   * Like `start`, but also hands back a promise that resolves once the
   * transfer finishes (success or failure) — used by callers that queue
   * several transfers as a batch (e.g. directory sync) and need to know when
   * each one is done, while still sharing the same queueing/progress/cancel
   * machinery and events as a manually-started transfer.
   */
  startTracked(
    direction: TransferDirection,
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): { transferId: string; done: Promise<{ ok: boolean; message?: string }> } {
    const transferId = randomUUID();
    const controller = new AbortController();
    this.controllers.set(transferId, controller);

    const done = this.run(transferId, direction, sessionId, localPath, remotePath, controller.signal);
    return { transferId, done };
  }

  private async run(
    transferId: string,
    direction: TransferDirection,
    sessionId: string,
    localPath: string,
    remotePath: string,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const session = sessionManager.get(sessionId);
    let lastEmit = 0;
    let lastBytes = 0;
    let lastTime = Date.now();

    const onProgress = (transferred: number, total: number) => {
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

    try {
      if (direction === "upload") {
        await session.upload(localPath, remotePath, onProgress, signal);
      } else {
        await session.download(remotePath, localPath, onProgress, signal);
      }
      emitToRenderer(IPC.transfer.done, { transferId } satisfies TransferDoneEvent);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof TransferCanceledError
          ? "Transfer canceled"
          : err instanceof Error
            ? err.message
            : "Transfer failed";
      logger.warn("transfer-manager", "Transfer ended with error", { transferId, message });
      emitToRenderer(IPC.transfer.error, { transferId, message } satisfies TransferErrorEvent);
      return { ok: false, message };
    } finally {
      this.controllers.delete(transferId);
    }
  }

  cancel(transferId: string): void {
    this.controllers.get(transferId)?.abort();
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

export const transferManager = new TransferManager();
