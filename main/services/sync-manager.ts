/**
 * Local<->remote directory sync (WinSCP-style). Recursively diffs a local and
 * remote directory tree and computes/executes a plan of uploads, downloads,
 * and (opt-in) deletions. Upload/download actions run through TransferManager
 * so they share its queueing, progress, and cancellation with manual
 * transfers; deletions are simple one-shot operations with no meaningful
 * progress to track.
 */
import * as path from "path/posix";

import { logger } from "../logger.js";

import { emitToRenderer } from "./ipc-emitter.js";
import { localFsService } from "./local-fs.js";
import { sessionManager } from "./session-manager.js";
import { transferManager } from "./transfer-manager.js";
import type { BaseSession } from "./sessions/base-session.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type {
  SyncExecuteRequest,
  SyncExecuteResult,
  SyncMode,
  SyncPlanEntry,
  SyncPlanRequest,
  SyncPlanResult,
  SyncProgressEvent,
  TransferItem,
} from "@shared/ipc-contract";

/** SFTP/FTP servers commonly only report mtime to the second — tolerate small skew rather than treating clock-resolution noise as a real difference. */
const MTIME_TOLERANCE_MS = 2_000;

export interface SyncFileEntry {
  /** posix-relative path from the sync root, e.g. "sub/dir/file.txt" — always a file, never a directory. */
  relPath: string;
  size: number;
  /** epoch ms */
  mtime: number;
}

export interface SyncPlanOptions {
  mode: SyncMode;
  deleteOrphans: boolean;
}

function filesSame(a: SyncFileEntry, b: SyncFileEntry): boolean {
  return a.size === b.size && Math.abs(a.mtime - b.mtime) <= MTIME_TOLERANCE_MS;
}

/**
 * Pure diff-then-plan step: given a flat file listing for each side, decides
 * what to do with every path. No filesystem/network access, which makes it
 * easy to unit test with fabricated entries — see sync-manager.test.ts.
 */
export function computeSyncPlan(
  localEntries: SyncFileEntry[],
  remoteEntries: SyncFileEntry[],
  options: SyncPlanOptions,
): SyncPlanEntry[] {
  const localByPath = new Map(localEntries.map((e) => [e.relPath, e]));
  const remoteByPath = new Map(remoteEntries.map((e) => [e.relPath, e]));
  const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
  const plan: SyncPlanEntry[] = [];

  for (const relPath of allPaths) {
    const local = localByPath.get(relPath);
    const remote = remoteByPath.get(relPath);

    if (local && !remote) {
      if (options.mode === "download") {
        if (options.deleteOrphans) {
          plan.push({ relPath, action: "delete-local", size: local.size, detail: "only on local" });
        }
      } else {
        plan.push({ relPath, action: "upload", size: local.size, detail: "only on local" });
      }
      continue;
    }

    if (!local && remote) {
      if (options.mode === "upload") {
        if (options.deleteOrphans) {
          plan.push({ relPath, action: "delete-remote", size: remote.size, detail: "only on remote" });
        }
      } else {
        plan.push({ relPath, action: "download", size: remote.size, detail: "only on remote" });
      }
      continue;
    }

    if (local && remote) {
      if (filesSame(local, remote)) continue;

      if (options.mode === "upload") {
        if (local.mtime > remote.mtime + MTIME_TOLERANCE_MS) {
          plan.push({ relPath, action: "upload", size: local.size, detail: "local is newer" });
        }
        continue;
      }

      if (options.mode === "download") {
        if (remote.mtime > local.mtime + MTIME_TOLERANCE_MS) {
          plan.push({ relPath, action: "download", size: remote.size, detail: "remote is newer" });
        }
        continue;
      }

      // Two-way, without a stored "last synced" baseline: there's no reliable
      // way to tell whether only one side changed or both did, so any
      // both-sides-differ case is surfaced as a conflict for the user to
      // resolve by hand rather than guessing a winner and risking data loss.
      plan.push({ relPath, action: "conflict", size: local.size, detail: "changed on both sides" });
    }
  }

  return plan.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export class SyncManager {
  async plan(request: SyncPlanRequest): Promise<SyncPlanResult> {
    const session = sessionManager.get(request.sessionId);
    const [localEntries, remoteEntries] = await Promise.all([
      this.walkLocal(request.localRoot, ""),
      this.walkRemote(session, request.remoteRoot, ""),
    ]);
    const entries = computeSyncPlan(localEntries, remoteEntries, {
      mode: request.mode,
      deleteOrphans: request.deleteOrphans,
    });
    return { entries };
  }

  async execute(request: SyncExecuteRequest): Promise<SyncExecuteResult> {
    const session = sessionManager.get(request.sessionId);
    const total = request.entries.length;
    let completed = 0;
    const failed: SyncExecuteResult["failed"] = [];

    for (const entry of request.entries) {
      try {
        await this.executeEntry(session, request.localRoot, request.remoteRoot, entry);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("sync-manager", "Sync entry failed", { relPath: entry.relPath, message });
        failed.push({ relPath: entry.relPath, message });
      }
      completed++;
      emitToRenderer(IPC.sync.progress, {
        completed,
        total,
        relPath: entry.relPath,
      } satisfies SyncProgressEvent);
    }

    return { completed, total, failed };
  }

  private async executeEntry(
    session: BaseSession,
    localRoot: string,
    remoteRoot: string,
    entry: SyncPlanEntry,
  ): Promise<void> {
    const localPath = path.join(localRoot, entry.relPath);
    const remotePath = path.join(remoteRoot, entry.relPath);

    switch (entry.action) {
      case "upload":
        await this.ensureRemoteDir(session, path.dirname(remotePath));
        await this.runTransfer("upload", session, localPath, remotePath, entry);
        return;
      case "download":
        await this.ensureLocalDir(path.dirname(localPath));
        await this.runTransfer("download", session, localPath, remotePath, entry);
        return;
      case "delete-local":
        await localFsService.delete(localPath, false);
        return;
      case "delete-remote":
        await session.delete(remotePath, false);
        return;
      case "conflict":
        throw new Error("Conflicts must be resolved manually and are never executed");
    }
  }

  private async runTransfer(
    direction: "upload" | "download",
    session: BaseSession,
    localPath: string,
    remotePath: string,
    entry: SyncPlanEntry,
  ): Promise<void> {
    const { transferId, done } = transferManager.startTracked(
      direction,
      session.info.sessionId,
      localPath,
      remotePath,
    );
    const item: TransferItem = {
      transferId,
      sessionId: session.info.sessionId,
      direction,
      name: path.basename(entry.relPath),
      localPath,
      remotePath,
      status: "queued",
      transferred: 0,
      total: entry.size,
      bytesPerSec: 0,
    };
    emitToRenderer(IPC.transfer.queued, item);

    const result = await done;
    if (!result.ok) throw new Error(result.message ?? "Transfer failed");
  }

  /** Best-effort — a real permission/network error still surfaces from the transfer/delete call that follows. */
  private async ensureRemoteDir(session: BaseSession, dirPath: string): Promise<void> {
    try {
      await session.mkdir(dirPath);
    } catch {
      // See doc comment above.
    }
  }

  private async ensureLocalDir(dirPath: string): Promise<void> {
    try {
      await localFsService.mkdir(dirPath);
    } catch {
      // See ensureRemoteDir.
    }
  }

  private async walkLocal(root: string, relBase: string): Promise<SyncFileEntry[]> {
    const listing = await localFsService.list(path.join(root, relBase));
    const results: SyncFileEntry[] = [];
    for (const entry of listing.entries) {
      const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
      // Don't recurse into symlinked directories — a self- or mutually-referential
      // symlink chain would otherwise recurse forever.
      if (entry.isDir && !entry.symlink) {
        results.push(...(await this.walkLocal(root, relPath)));
      } else if (!entry.isDir) {
        results.push({ relPath, size: entry.size, mtime: entry.mtime });
      }
    }
    return results;
  }

  private async walkRemote(session: BaseSession, root: string, relBase: string): Promise<SyncFileEntry[]> {
    const listing = await session.list(relBase ? path.join(root, relBase) : root);
    const results: SyncFileEntry[] = [];
    for (const entry of listing.entries) {
      const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDir && !entry.symlink) {
        results.push(...(await this.walkRemote(session, root, relPath)));
      } else if (!entry.isDir) {
        results.push({ relPath, size: entry.size, mtime: entry.mtime });
      }
    }
    return results;
  }
}

export const syncManager = new SyncManager();
