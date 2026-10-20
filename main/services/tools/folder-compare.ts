/**
 * Compares two local folder trees by relative path, size and mtime — the
 * same "probably equal" test sync uses, without reading file contents.
 * Each side's walk stops at MAX_FILES so pointing it at a huge tree (your
 * home folder) returns a partial answer instead of hanging.
 */
import * as path from "path/posix";

import { localFsService } from "../local-fs.js";

import type { FolderCompareEntry, FolderCompareResult, FolderCompareSide } from "@shared/ipc-contract";

export const MAX_FILES = 20_000;

/** Local filesystems report full mtime precision, but copies via FAT/SMB round to 2 s. */
const MTIME_TOLERANCE_MS = 2_000;

export interface TreeFile extends FolderCompareSide {
  relPath: string;
}

/** Pure comparison of two file lists, sorted by path. */
export function compareFileLists(left: TreeFile[], right: TreeFile[]): FolderCompareEntry[] {
  const rightByPath = new Map(right.map((f) => [f.relPath, f]));
  const entries: FolderCompareEntry[] = [];
  for (const l of left) {
    const r = rightByPath.get(l.relPath);
    rightByPath.delete(l.relPath);
    const leftSide = { size: l.size, mtime: l.mtime };
    if (!r) {
      entries.push({ relPath: l.relPath, status: "left-only", left: leftSide });
      continue;
    }
    const same = l.size === r.size && Math.abs(l.mtime - r.mtime) <= MTIME_TOLERANCE_MS;
    entries.push({
      relPath: l.relPath,
      status: same ? "same" : "different",
      left: leftSide,
      right: { size: r.size, mtime: r.mtime },
    });
  }
  for (const r of rightByPath.values()) {
    entries.push({ relPath: r.relPath, status: "right-only", right: { size: r.size, mtime: r.mtime } });
  }
  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function walk(root: string, relBase: string, out: TreeFile[]): Promise<boolean> {
  let listing;
  try {
    listing = await localFsService.list(relBase ? path.join(root, relBase) : root);
  } catch (err) {
    // An unreadable root is the user's mistake and should surface; an unreadable
    // subfolder (permissions, a vanished mount) shouldn't sink the whole compare.
    if (!relBase) throw err;
    return false;
  }
  for (const entry of listing.entries) {
    if (out.length >= MAX_FILES) return true;
    const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
    // Symlinked directories aren't followed: a link loop would never end.
    if (entry.isDir && !entry.symlink) {
      if (await walk(root, relPath, out)) return true;
    } else if (!entry.isDir) {
      out.push({ relPath, size: entry.size, mtime: entry.mtime });
    }
  }
  return false;
}

export async function compareFolders(left: string, right: string): Promise<FolderCompareResult> {
  const leftFiles: TreeFile[] = [];
  const rightFiles: TreeFile[] = [];
  const [leftCut, rightCut] = await Promise.all([walk(left, "", leftFiles), walk(right, "", rightFiles)]);
  return { entries: compareFileLists(leftFiles, rightFiles), truncated: leftCut || rightCut };
}
