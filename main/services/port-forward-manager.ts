/**
 * Manages per-session SSH port-forwarding rules: local (-L) and remote (-R)
 * TCP forwards over an already-open SshSession. Dynamic (-D / SOCKS) forwarding
 * is not implemented yet — start() rejects it and the renderer doesn't offer it.
 */
import * as net from "net";
import { randomUUID } from "crypto";

import { logger } from "../logger.js";

import { emitToRenderer } from "./ipc-emitter.js";
import { sessionManager } from "./session-manager.js";
import type { SshSession } from "./sessions/ssh-session.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { PortForwardRule, PortForwardStartRequest, PortForwardUpdateEvent } from "@shared/ipc-contract";
import type { AcceptConnection, ClientChannel, RejectConnection, TcpConnectionDetails } from "ssh2";

interface ManagedForward {
  rule: PortForwardRule;
  /** Tears down the listener/forward; safe to call once. */
  cleanup: () => Promise<void>;
}

export class PortForwardManager {
  private forwards = new Map<string, ManagedForward>();

  async start(request: PortForwardStartRequest): Promise<PortForwardRule> {
    const session = sessionManager.getSsh(request.sessionId);
    const rule: PortForwardRule = {
      id: randomUUID(),
      sessionId: request.sessionId,
      type: request.type,
      srcHost: request.srcHost || "127.0.0.1",
      srcPort: request.srcPort,
      dstHost: request.type === "dynamic" ? null : (request.dstHost ?? null),
      dstPort: request.type === "dynamic" ? null : (request.dstPort ?? null),
      state: "starting",
      error: null,
      connectionCount: 0,
      bytesIn: 0,
      bytesOut: 0,
    };

    let cleanup: () => Promise<void>;
    if (request.type === "local") {
      cleanup = await this.startLocal(session, rule);
    } else if (request.type === "remote") {
      cleanup = await this.startRemote(session, rule);
    } else {
      throw new Error("Dynamic (SOCKS) port forwarding is not implemented yet");
    }

    rule.state = "listening";
    this.forwards.set(rule.id, { rule, cleanup });
    logger.info("port-forward", "Started forward", { id: rule.id, type: rule.type, sessionId: rule.sessionId });
    return rule;
  }

  async stop(id: string): Promise<void> {
    const managed = this.forwards.get(id);
    if (!managed) return;
    this.forwards.delete(id);
    managed.rule.state = "stopped";
    try {
      await managed.cleanup();
    } catch (err) {
      logger.error("port-forward", "Error stopping forward", err);
    }
    this.emitUpdate(managed.rule);
    logger.info("port-forward", "Stopped forward", { id });
  }

  list(sessionId: string): PortForwardRule[] {
    return Array.from(this.forwards.values())
      .map((m) => m.rule)
      .filter((rule) => rule.sessionId === sessionId);
  }

  /** Called on session disconnect so its forwards don't outlive the connection. */
  async closeForSession(sessionId: string): Promise<void> {
    const ids = Array.from(this.forwards.values())
      .filter((m) => m.rule.sessionId === sessionId)
      .map((m) => m.rule.id);
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.forwards.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private async startLocal(session: SshSession, rule: PortForwardRule): Promise<() => Promise<void>> {
    if (!rule.dstHost || !rule.dstPort) {
      throw new Error("Local forward requires a destination host and port");
    }
    const dstHost = rule.dstHost;
    const dstPort = rule.dstPort;

    const server = net.createServer((socket) => {
      session
        .forwardOut(rule.srcHost, rule.srcPort, dstHost, dstPort)
        .then((channel) => this.pipe(rule, channel, socket))
        .catch((err) => {
          logger.error("port-forward", "Failed to open forwarded channel", err);
          socket.destroy();
        });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(rule.srcPort, rule.srcHost, () => {
        server.removeListener("error", reject);
        // srcPort may have been 0 (pick any free port) — reflect what actually bound.
        const address = server.address();
        if (address && typeof address === "object") rule.srcPort = address.port;
        resolve();
      });
    });

    return () => new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async startRemote(session: SshSession, rule: PortForwardRule): Promise<() => Promise<void>> {
    if (!rule.dstHost || !rule.dstPort) {
      throw new Error("Remote forward requires a destination host and port");
    }
    const dstHost = rule.dstHost;
    const dstPort = rule.dstPort;

    const boundPort = await session.forwardIn(rule.srcHost, rule.srcPort);
    rule.srcPort = boundPort || rule.srcPort;

    const handler = (
      details: TcpConnectionDetails,
      accept: AcceptConnection<ClientChannel>,
      reject: RejectConnection,
    ) => {
      if (details.destPort !== rule.srcPort) {
        reject();
        return;
      }
      const channel = accept();
      const socket = net.connect(dstPort, dstHost);
      socket.once("error", () => channel.close());
      channel.once("error", () => socket.destroy());
      this.pipe(rule, channel, socket);
    };
    const unsubscribe = session.onTcpConnection(handler);

    return async () => {
      unsubscribe();
      await session.unforwardIn(rule.srcHost, rule.srcPort).catch(() => undefined);
    };
  }

  /** Cross-pipes a forwarded SSH channel and a local TCP socket, tracking bytes/connection count. */
  private pipe(rule: PortForwardRule, channel: ClientChannel, socket: net.Socket): void {
    rule.connectionCount += 1;
    this.emitUpdate(rule);

    channel.pipe(socket);
    socket.pipe(channel);
    channel.on("data", (chunk: Buffer) => {
      rule.bytesIn += chunk.length;
    });
    socket.on("data", (chunk: Buffer) => {
      rule.bytesOut += chunk.length;
    });

    let closed = false;
    const onClose = () => {
      if (closed) return;
      closed = true;
      channel.destroy();
      socket.destroy();
      this.emitUpdate(rule);
    };
    channel.once("close", onClose);
    socket.once("close", onClose);
    channel.once("error", onClose);
    socket.once("error", onClose);
  }

  private emitUpdate(rule: PortForwardRule): void {
    emitToRenderer(IPC.portForward.update, { rule } satisfies PortForwardUpdateEvent);
  }
}

export const portForwardManager = new PortForwardManager();
