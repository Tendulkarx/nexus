/**
 * Local filesystem browsing for the left pane. Pure Node fs — no shell.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import type { DirListing, FsEntry, LocalRoots } from "@shared/ipc-contract";

function formatMode(mode: number): string {
  const perms = ["r", "w", "x"];
  let out = "";
  for (let group = 2; group >= 0; group--) {
    for (let bit = 2; bit >= 0; bit--) {
      out += mode & (1 << (group * 3 + bit)) ? perms[2 - bit] : "-";
    }
  }
  return out;
}

export class LocalFsService {
  async list(dirPath?: string): Promise<DirListing> {
    const target = dirPath && dirPath.trim() ? dirPath : os.homedir();
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries: FsEntry[] = [];

    for (const dirent of dirents) {
      const fullPath = path.join(target, dirent.name);
      try {
        const stat = await fs.lstat(fullPath);
        const isSymlink = stat.isSymbolicLink();
        let isDir = dirent.isDirectory();
        if (isSymlink) {
          try {
            const real = await fs.stat(fullPath);
            isDir = real.isDirectory();
          } catch {
            // Broken symlink — treat as file.
          }
        }
        entries.push({
          name: dirent.name,
          path: fullPath,
          isDir,
          size: stat.size,
          mtime: stat.mtimeMs,
          permissions: formatMode(stat.mode),
          symlink: isSymlink,
        });
      } catch {
        // Unreadable entry (permissions) — skip it rather than failing the listing.
      }
    }

    return { path: target, entries };
  }

  async roots(): Promise<LocalRoots> {
    const home = os.homedir();
    const volumes: FsEntry[] = [];
    try {
      const volNames = await fs.readdir("/Volumes", { withFileTypes: true });
      for (const v of volNames) {
        const fullPath = path.join("/Volumes", v.name);
        volumes.push({ name: v.name, path: fullPath, isDir: true, size: 0, mtime: 0 });
      }
    } catch {
      // /Volumes not readable — return home only.
    }
    return { home, volumes };
  }

  async readFile(filePath: string, maxBytes: number): Promise<Buffer> {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(from, to);
  }

  async delete(targetPath: string, isDir: boolean): Promise<void> {
    if (isDir) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }
  }
}

export const localFsService = new LocalFsService();
