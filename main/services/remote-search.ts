/**
 * Recursive remote text search over an open SSH/SFTP session, implemented by
 * shelling out to `grep -r` via SshSession.exec (ssh2's Client.exec). FTP/FTPS
 * has no remote exec capability, so this only ever runs against an SshSession
 * — callers get one via sessionManager.getSsh(), which throws for ftp/ftps.
 */
import type { SshSession } from "./sessions/ssh-session.js";
import type { SearchMatch } from "@shared/ipc-contract";

export const DEFAULT_MAX_RESULTS = 200;
const EXEC_TIMEOUT_MS = 20_000;
const SNIPPET_MAX_CHARS = 300;

/** Wraps a value in single quotes for a POSIX shell, escaping embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `grep -r` over `path` for a fixed (non-regex) string, skipping binary files
 * and capping output at maxResults+1 lines (the "+1" lets the caller detect
 * truncation without a second round trip).
 */
export function buildGrepCommand(path: string, query: string, maxResults: number): string {
  const limit = Math.max(1, maxResults) + 1;
  return `grep -rIn -F -e ${shellQuote(query)} -- ${shellQuote(path)} | head -n ${limit}`;
}

/** Parses `grep -n` output lines of the form "path:line:content" into SearchMatch entries. */
export function parseGrepOutput(stdout: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const m = /^(.*?):(\d+):(.*)$/s.exec(line);
    if (!m) continue;
    matches.push({ path: m[1], line: Number(m[2]), snippet: m[3].trim().slice(0, SNIPPET_MAX_CHARS) });
  }
  return matches;
}

export async function searchRemote(
  session: SshSession,
  path: string,
  query: string,
  maxResults: number = DEFAULT_MAX_RESULTS,
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  if (!query.trim()) return { matches: [], truncated: false };

  const command = buildGrepCommand(path, query, maxResults);
  const { stdout, stderr, code } = await session.exec(command, EXEC_TIMEOUT_MS);

  // grep exits 1 for "no matches" (not an error) and >1 for a real failure
  // (bad path, permission denied, etc).
  if (code !== null && code > 1 && stdout.trim().length === 0) {
    throw new Error(stderr.trim() || `Search failed (exit code ${code})`);
  }

  const matches = parseGrepOutput(stdout);
  const truncated = matches.length > maxResults;
  return { matches: matches.slice(0, maxResults), truncated };
}
