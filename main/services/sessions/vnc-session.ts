/**
 * A VNC session. Unlike DisplaySession (RDP via the native addon), the VNC
 * client is noVNC in the renderer; this class only supplies byte streams to
 * the server (see services/vnc-bridge.ts), directly or through the profile's
 * SSH jump host, which is the usual way to reach VNC without exposing it.
 * Nothing connects until the renderer's VNC pane asks for a channel.
 */
import * as net from "net";

import { connectViaJumpHost } from "./ssh-connect.js";

import type { ConnectionProfile, SessionInfo, VncCredentials } from "@shared/ipc-contract";
import type { Duplex } from "stream";
import type { Client } from "ssh2";

const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Plain-language reason a VNC connection failed. Node tries every address a
 * name resolves to (IPv4 and IPv6 for "mac.local") and, when all fail, throws
 * an AggregateError with an empty message, so look inside it for the cause.
 */
export function describeConnectError(err: unknown, host: string, port: number): string {
  // With several addresses, report the most telling failure: a refusal proves the host is up
  // (IPv6 link-local attempts often fail as "unreachable" while IPv4 reaches the machine).
  const RANK = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"];
  const rank = (e: unknown) => {
    const i = RANK.indexOf((e as NodeJS.ErrnoException)?.code ?? "");
    return i < 0 ? RANK.length : i;
  };
  const inner =
    err instanceof AggregateError && err.errors.length > 0 ? [...err.errors].sort((x, y) => rank(x) - rank(y))[0] : err;
  const code = (inner as NodeJS.ErrnoException)?.code;
  const where = `${host}:${port}`;
  switch (code) {
    case "ECONNREFUSED":
      return `${where} refused the connection. Is Screen Sharing (or the VNC server) turned on there?`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Couldn't find ${host}. Check the name, or use its IP address.`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${host} isn't reachable from this Mac's network.`;
    case "ETIMEDOUT":
      return `Timed out connecting to ${where}. A firewall may be blocking port ${port}.`;
  }
  const message = inner instanceof Error ? inner.message : String(inner);
  return message || `Couldn't connect to ${where}`;
}

export class VncSession {
  readonly info: SessionInfo;
  private readonly jumpClients = new Set<Client>();
  private readonly sockets = new Set<Duplex>();

  constructor(
    sessionId: string,
    private readonly profile: ConnectionProfile,
    private readonly secret: string | null,
    private readonly jumpSecret: string | null,
  ) {
    if (profile.protocol !== "vnc") throw new Error(`VncSession created for ${profile.protocol}`);
    this.info = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: "vnc",
      host: profile.host,
      username: profile.username,
      homeDir: "",
      supportsTerminal: false,
      kind: "display",
    };
  }

  credentials(): VncCredentials {
    return { username: this.profile.username, password: this.secret };
  }

  /** Opens a connected stream to the VNC server. Each viewer (reconnect) gets its own. */
  async openStream(): Promise<Duplex> {
    const host = this.profile.host;
    const port = this.profile.port || 5900;
    let stream: Duplex;
    if (this.profile.jumpHost) {
      const jump = await connectViaJumpHost(this.profile.jumpHost, this.jumpSecret, host, port);
      this.jumpClients.add(jump.client);
      jump.sock.on("close", () => {
        jump.client.end();
        this.jumpClients.delete(jump.client);
      });
      stream = jump.sock;
    } else {
      stream = await new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
          socket.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })),
        );
        socket.once("connect", () => {
          socket.setTimeout(0);
          socket.setNoDelay(true);
          resolve(socket);
        });
        socket.once("error", (err) => reject(new Error(describeConnectError(err, host, port))));
      });
    }
    this.sockets.add(stream);
    stream.once("close", () => this.sockets.delete(stream));
    return stream;
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    for (const c of this.jumpClients) c.end();
    this.sockets.clear();
    this.jumpClients.clear();
  }
}
