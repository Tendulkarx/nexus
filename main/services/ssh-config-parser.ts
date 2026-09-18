/**
 * Parses an OpenSSH client config file's Host blocks into structured entries
 * for the connection-manager's import picker. Pure — takes the file's
 * contents as a string, not a path, so it doesn't need a real filesystem to
 * be unit tested (main/handlers/ssh-config.ts does the actual file read and
 * handles a missing ~/.ssh/config gracefully).
 */
import { homedir } from "os";

export interface ParsedSshHost {
  alias: string;
  hostName?: string;
  port?: number;
  user?: string;
  /** Absolute path, tilde-expanded against homeDir. */
  identityFile?: string;
  proxyJump?: string;
}

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return homeDir + path.slice(1);
  return path;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * A "Host" line may declare multiple space-separated aliases sharing one
 * block ("Host web1 web2"); each becomes its own entry. Wildcard aliases
 * ("*", "web*", "192.168.?.1") are skipped — those are config-inheritance
 * patterns (usually a trailing "Host *" block of defaults), not real,
 * importable hosts.
 */
export function parseSshConfig(contents: string, homeDir: string = homedir()): ParsedSshHost[] {
  const hosts: ParsedSshHost[] = [];
  let current: ParsedSshHost[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = unquote(match[2]);

    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((alias) => !alias.includes("*") && !alias.includes("?"))
        .map((alias) => {
          const host: ParsedSshHost = { alias };
          hosts.push(host);
          return host;
        });
      continue;
    }

    if (current.length === 0) continue;
    for (const host of current) {
      switch (key) {
        case "hostname":
          host.hostName = value;
          break;
        case "port": {
          const port = parseInt(value, 10);
          if (!Number.isNaN(port)) host.port = port;
          break;
        }
        case "user":
          host.user = value;
          break;
        case "identityfile":
          host.identityFile = expandHome(value, homeDir);
          break;
        case "proxyjump":
          host.proxyJump = value;
          break;
      }
    }
  }

  return hosts;
}
