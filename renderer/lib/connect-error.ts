/**
 * Turns a failed session:connect into words a person can act on. Errors arrive
 * as raw library text ("connect: getConnection: All configured authentication
 * methods failed"), which reads like a crash in a toast that vanishes.
 */
import type { ConnectionProfileDTO } from "@shared/ipc-contract";

export interface ConnectErrorMessage {
  title: string;
  /** What to try next, when we can tell. */
  hint?: string;
  /** Offer to open the connection's editor: the fix is in its settings. */
  suggestEdit: boolean;
}

export function describeConnectFailure(
  raw: string,
  profile: Pick<ConnectionProfileDTO, "name" | "host" | "port" | "authType">,
): ConnectErrorMessage {
  const where = `${profile.host}:${profile.port}`;
  if (/All configured authentication methods failed|authentication failed|Permission denied/i.test(raw)) {
    return {
      title: `${profile.name.trim()} refused the sign-in`,
      hint:
        profile.authType === "password"
          ? "Check the username and password. Many Linux servers only accept SSH keys; if this one does, edit the connection and set Method to Private key."
          : "Check the username, and that the server has this key in ~/.ssh/authorized_keys.",
      suggestEdit: true,
    };
  }
  if (/ECONNREFUSED/.test(raw)) {
    return {
      title: `Nothing is accepting connections on ${where}`,
      hint: "Check the port, and that the service is running.",
      suggestEdit: true,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(raw)) {
    return {
      title: `Couldn't find ${profile.host}`,
      hint: "Check the host name, or use its IP address.",
      suggestEdit: true,
    };
  }
  if (/ETIMEDOUT|Timed out|EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return {
      title: `${where} didn't answer`,
      hint: "The machine may be off, asleep, or behind a firewall.",
      suggestEdit: false,
    };
  }
  // Unknown: show the library's text, minus Electron's "Error invoking remote method …: Error:" wrapper.
  return { title: raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ""), suggestEdit: false };
}
