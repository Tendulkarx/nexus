/**
 * Keeps every local server inside the folder it was told to share. Paths from
 * clients are untrusted: "..", absolute paths, backslashes and symlinks that
 * point outside the root must all fail closed.
 */
import { promises as fs } from "fs";
import * as path from "path";

export class OutsideRootError extends Error {
  constructor(requested: string) {
    super(`"${requested}" is outside the shared folder`);
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Maps a client path ("/sub/file.txt", "sub\\file.txt", "../x") onto `root`.
 * Lexical only: use resolveExisting() before reading, to also catch symlinks.
 */
export function resolveInside(root: string, requested: string): string {
  // Treat the client path as rooted at the share, so ".." can at most reach "/".
  const normalized = path.posix.normalize("/" + requested.replace(/\\/g, "/"));
  // resolve() rather than join(): it drops the trailing slash, so "/" maps to exactly `root`.
  const resolved = path.resolve(root, "." + normalized);
  if (!isInside(root, resolved)) throw new OutsideRootError(requested);
  return resolved;
}

/** resolveInside(), then follows symlinks and checks the real target is still inside the (real) root. */
export async function resolveExisting(root: string, requested: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(resolveInside(realRoot, requested));
  if (!isInside(realRoot, real)) throw new OutsideRootError(requested);
  return real;
}

/** For writes: the parent folder must exist inside the root; the file itself may not exist yet. */
export async function resolveForWrite(root: string, requested: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const target = resolveInside(realRoot, requested);
  if (target === realRoot) throw new OutsideRootError(requested);
  const parent = await fs.realpath(path.dirname(target));
  if (!isInside(realRoot, parent)) throw new OutsideRootError(requested);
  const final = path.join(parent, path.basename(target));
  // Refuse to write through a symlink that already exists at the target.
  const existing = await fs.lstat(final).catch(() => null);
  if (existing?.isSymbolicLink()) throw new OutsideRootError(requested);
  return final;
}
