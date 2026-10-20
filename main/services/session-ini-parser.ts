/**
 * Reads saved sessions out of a sessions.ini (or a .mxtsessions export).
 *
 * Sessions live in [Bookmarks] and [Bookmarks_N] sections. SubRep= holds the
 * folder path (backslash-separated); every other key is one session:
 *
 *   name=<reconnect marker>#<icon>#<type>%<host>%<port>%<user>%…#<terminal settings>#…
 *
 * The number between the first two "#" is only the icon. The session type is
 * field 0 of the first "%" group. Only the codes documented for that format
 * are mapped (SSH 0, RDP 4, VNC 5, SFTP 7 — see
 * https://gist.github.com/Ruzgfpegk/ab597838e4abbe8de30d7224afd062ea); others
 * come back with protocol null so the import dialog can list them as skipped
 * instead of guessing. Stored passwords ([Passwords]) are never read.
 */
import type { IniSession } from "@shared/ipc-contract";

const TYPE_TO_PROTOCOL: Record<number, IniSession["protocol"]> = {
  0: "ssh",
  4: "rdp",
  5: "vnc",
  7: "sftp",
};

/** Names for documented types Nexus can't open, so skipped rows say what they were. */
export const SESSION_TYPE_NAMES: Record<number, string> = {
  0: "SSH",
  4: "RDP",
  5: "VNC",
  7: "SFTP",
  11: "Browser",
};

/** SSH gateway fields in the first "%" group (host, port, user). RDP's gateway layout differs and isn't imported. */
const SSH_GATEWAY = { host: 8, port: 9, user: 10 };

/** Multi-hop gateways are joined with "__PIPE__"; Nexus supports one jump host, so take the first. */
function firstOf(value: string | undefined): string {
  return (value ?? "").split("__PIPE__")[0].trim();
}

function parsePort(value: string | undefined): number | null {
  const n = Number(firstOf(value));
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null;
}

/** Decodes as UTF-8 when the bytes are valid UTF-8, otherwise as Windows-1252/Latin-1 (the other client's usual ANSI save). */
export function decodeIni(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

export function parseSessionLine(name: string, value: string, folderPath: string[]): IniSession | null {
  const groups = value.split("#");
  if (groups.length < 3) return null;
  const fields = groups[2].split("%");
  const typeCode = Number(fields[0]);
  if (!Number.isInteger(typeCode)) return null;
  const host = (fields[1] ?? "").trim();
  if (!host) return null;

  const protocol = TYPE_TO_PROTOCOL[typeCode] ?? null;
  const gatewayHost = protocol === "ssh" ? firstOf(fields[SSH_GATEWAY.host]) : "";
  return {
    name: name.trim(),
    folderPath,
    protocol,
    typeCode,
    host,
    port: parsePort(fields[2]),
    username: (fields[3] ?? "").trim(),
    jumpHost: gatewayHost
      ? {
          host: gatewayHost,
          port: parsePort(fields[SSH_GATEWAY.port]),
          username: firstOf(fields[SSH_GATEWAY.user]),
        }
      : null,
  };
}

export function parseSessionIni(text: string): IniSession[] {
  const sessions: IniSession[] = [];
  let inBookmarks = false;
  let folderPath: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/.test(section[1]);
      folderPath = [];
      continue;
    }
    if (!inBookmarks) continue;
    // Split on the first "=" only: session values are full of "=" and "#", so an ordinary INI parser mangles them.
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (key === "SubRep") {
      folderPath = value
        .split("\\")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (key !== "ImgNum") {
      const session = parseSessionLine(key, value, folderPath);
      if (session) sessions.push(session);
    }
  }
  return sessions;
}
