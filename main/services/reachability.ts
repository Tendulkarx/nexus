/**
 * Lightweight reachability check for the connection-manager's health dot: a
 * plain TCP connect to host:port with a short timeout. Never sends
 * credentials or performs a protocol handshake — just proves a socket opens.
 */
import { Socket } from "net";

const DEFAULT_TIMEOUT_MS = 2500;

export function checkReachable(host: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}
