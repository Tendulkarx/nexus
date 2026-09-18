/**
 * "Edit in default app" round-trip: downloads a remote file to a temp path,
 * opens it in the OS default editor, watches the temp file, and re-uploads to
 * the server on each save. Emits edit:saved / edit:error events.
 */
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

import { shell } from "electron";
import { logger } from "../logger.js";

import { emitToRenderer } from "./ipc-emitter.js";
import { sessionManager } from "./session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { EditErrorEvent, EditSavedEvent } from "@shared/ipc-contract";

const SYNC_DEBOUNCE_MS = 400;

interface EditEntry {
  remotePath: string;
  name: string;
  sessionId: string;
  lastHash: string;
  timer: NodeJS.Timeout | null;
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fsp.readFile(filePath);
  return createHash("sha1").update(data).digest("hex");
}

export class EditManager {
  private watchers = new Map<string, fs.FSWatcher>(); // key: session temp dir
  private edits = new Map<string, EditEntry>(); // key: temp file path

  private sessionDir(sessionId: string): string {
    return path.join(os.tmpdir(), "nexus-edits", sessionId);
  }

  async open(sessionId: string, remotePath: string): Promise<void> {
    const session = sessionManager.get(sessionId);
    const name = path.posix.basename(remotePath) || "file";
    const dir = this.sessionDir(sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const tempPath = path.join(dir, name);

    // Pull the full file down to disk, then hand it to the default editor.
    await session.download(remotePath, tempPath, () => {}, new AbortController().signal);
    const lastHash = await hashFile(tempPath);
    this.edits.set(tempPath, { remotePath, name, sessionId, lastHash, timer: null });
    this.ensureWatcher(dir);

    const err = await shell.openPath(tempPath);
    if (err) throw new Error(`Couldn't open the file in an editor: ${err}`);
    logger.info("edit-manager", "Editing remote file", { sessionId, remotePath, tempPath });
  }

  /**
   * Save path for the in-app quick editor: writes `content` to a scratch
   * temp file and uploads it via the session's existing putFile, same as the
   * external-editor round trip's re-upload but without a download or watcher.
   */
  async quickSave(sessionId: string, remotePath: string, content: string): Promise<void> {
    const session = sessionManager.get(sessionId);
    const dir = path.join(os.tmpdir(), "nexus-quick-edit");
    await fsp.mkdir(dir, { recursive: true });
    const name = path.posix.basename(remotePath) || "file";
    const tempPath = path.join(dir, `${randomUUID()}-${name}`);
    await fsp.writeFile(tempPath, content, "utf-8");
    try {
      await session.putFile(tempPath, remotePath);
      logger.info("edit-manager", "Quick-saved remote file", { sessionId, remotePath });
    } finally {
      await fsp.rm(tempPath, { force: true });
    }
  }

  private ensureWatcher(dir: string): void {
    if (this.watchers.has(dir)) return;
    const watcher = fs.watch(dir, (_event, filename) => {
      if (!filename) return;
      const tempPath = path.join(dir, filename.toString());
      const entry = this.edits.get(tempPath);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => void this.sync(tempPath), SYNC_DEBOUNCE_MS);
    });
    this.watchers.set(dir, watcher);
  }

  private async sync(tempPath: string): Promise<void> {
    const entry = this.edits.get(tempPath);
    if (!entry) return;
    entry.timer = null;
    let hash: string;
    try {
      hash = await hashFile(tempPath);
    } catch {
      // File briefly missing (atomic-save rename) — ignore this event.
      return;
    }
    if (hash === entry.lastHash) return; // no real change

    try {
      const session = sessionManager.get(entry.sessionId); // throws if disconnected
      await session.putFile(tempPath, entry.remotePath);
      entry.lastHash = hash;
      emitToRenderer(IPC.edit.saved, { path: entry.remotePath, name: entry.name } satisfies EditSavedEvent);
      logger.info("edit-manager", "Saved edit back to server", { remotePath: entry.remotePath });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      emitToRenderer(IPC.edit.error, { path: entry.remotePath, message } satisfies EditErrorEvent);
      logger.warn("edit-manager", "Failed to save edit", { remotePath: entry.remotePath, message });
    }
  }

  closeForSession(sessionId: string): void {
    const dir = this.sessionDir(sessionId);
    this.watchers.get(dir)?.close();
    this.watchers.delete(dir);
    for (const [tempPath, entry] of this.edits) {
      if (entry.sessionId !== sessionId) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.edits.delete(tempPath);
    }
  }

  closeAll(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    for (const entry of this.edits.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.edits.clear();
  }
}

export const editManager = new EditManager();
