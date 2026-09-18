import * as net from "net";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const emitToRenderer = vi.fn();
vi.mock("./ipc-emitter.js", () => ({ emitToRenderer }));

const sessionManager = { getSsh: vi.fn() };
vi.mock("./session-manager.js", () => ({ sessionManager }));

const { portForwardManager } = await import("./port-forward-manager.js");

/** A minimal net server that echoes back whatever it receives — stands in for a "destination". */
function startEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.pipe(socket));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

function once(emitter: net.Socket, event: string): Promise<unknown> {
  return new Promise((resolve) => emitter.once(event, resolve));
}

describe("PortForwardManager", () => {
  let echo: { server: net.Server; port: number };

  beforeEach(async () => {
    vi.clearAllMocks();
    echo = await startEchoServer();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => echo.server.close(() => resolve()));
    // Forwards left running across tests would keep ports/listeners alive.
    for (const rule of portForwardManager.list("s1")) {
      await portForwardManager.stop(rule.id);
    }
  });

  it("rejects dynamic (SOCKS) forwarding as not implemented, without touching the session", async () => {
    sessionManager.getSsh.mockReturnValue({});

    await expect(
      portForwardManager.start({ sessionId: "s1", type: "dynamic", srcPort: 0 }),
    ).rejects.toThrow(/not implemented/);
    expect(portForwardManager.list("s1")).toHaveLength(0);
  });

  it("local forward requires a destination host and port", async () => {
    sessionManager.getSsh.mockReturnValue({ forwardOut: vi.fn() });

    await expect(
      portForwardManager.start({ sessionId: "s1", type: "local", srcPort: 0 }),
    ).rejects.toThrow(/destination/);
  });

  it("local forward: listens locally and tunnels each connection through session.forwardOut to the destination", async () => {
    const fakeSession = {
      forwardOut: vi.fn(async (_srcHost: string, _srcPort: number, dstHost: string, dstPort: number) =>
        net.connect(dstPort, dstHost),
      ),
    };
    sessionManager.getSsh.mockReturnValue(fakeSession);

    const rule = await portForwardManager.start({
      sessionId: "s1",
      type: "local",
      srcPort: 0,
      dstHost: "127.0.0.1",
      dstPort: echo.port,
    });

    expect(rule.state).toBe("listening");
    expect(rule.srcPort).toBeGreaterThan(0);

    const client = net.connect(rule.srcPort, rule.srcHost);
    await once(client, "connect");
    client.write("hello");
    const reply = (await once(client, "data")) as Buffer;
    expect(reply.toString()).toBe("hello");

    expect(fakeSession.forwardOut).toHaveBeenCalledWith(rule.srcHost, rule.srcPort, "127.0.0.1", echo.port);
    expect(rule.connectionCount).toBe(1);
    expect(rule.bytesOut).toBeGreaterThan(0);
    expect(rule.bytesIn).toBeGreaterThan(0);
    expect(emitToRenderer).toHaveBeenCalledWith(
      "portForward:update",
      expect.objectContaining({ rule: expect.objectContaining({ id: rule.id }) }),
    );

    client.destroy();
    await portForwardManager.stop(rule.id);
    expect(portForwardManager.list("s1")).toHaveLength(0);

    // The listener should be torn down — a new connection attempt must fail.
    const rejected = net.connect(rule.srcPort, rule.srcHost);
    await expect(once(rejected, "error")).resolves.toBeTruthy();
  });

  it("remote forward: asks the session to listen, then pipes accepted tcp connections to the destination", async () => {
    let tcpConnectionHandler:
      | ((details: unknown, accept: () => net.Socket, reject: () => void) => void)
      | null = null;

    const tunnelServer = net.createServer();
    await new Promise<void>((resolve) => tunnelServer.listen(0, "127.0.0.1", resolve));
    const tunnelServerSidePromise = new Promise<net.Socket>((resolve) =>
      tunnelServer.once("connection", resolve),
    );
    const tunnelAddress = tunnelServer.address();
    const tunnelPort = typeof tunnelAddress === "object" && tunnelAddress ? tunnelAddress.port : 0;
    const tunnelClientSide = net.connect(tunnelPort, "127.0.0.1");
    const tunnelServerSide = await tunnelServerSidePromise;

    const fakeSession = {
      forwardIn: vi.fn(async (_bindHost: string, bindPort: number) => bindPort || 9999),
      unforwardIn: vi.fn(async () => undefined),
      onTcpConnection: vi.fn((handler: typeof tcpConnectionHandler) => {
        tcpConnectionHandler = handler;
        return () => undefined;
      }),
    };
    sessionManager.getSsh.mockReturnValue(fakeSession);

    const rule = await portForwardManager.start({
      sessionId: "s1",
      type: "remote",
      srcHost: "0.0.0.0",
      srcPort: 9999,
      dstHost: "127.0.0.1",
      dstPort: echo.port,
    });

    expect(fakeSession.forwardIn).toHaveBeenCalledWith("0.0.0.0", 9999);
    expect(rule.state).toBe("listening");
    expect(tcpConnectionHandler).not.toBeNull();

    // Simulate the server notifying us of an inbound forwarded connection.
    tcpConnectionHandler!({ destPort: 9999 }, () => tunnelServerSide, () => undefined);

    tunnelClientSide.write("ping");
    const reply = (await once(tunnelClientSide, "data")) as Buffer;
    expect(reply.toString()).toBe("ping");
    expect(rule.connectionCount).toBe(1);

    await portForwardManager.stop(rule.id);
    expect(fakeSession.unforwardIn).toHaveBeenCalledWith("0.0.0.0", 9999);

    tunnelClientSide.destroy();
  });

  it("closeForSession stops every forward for that session but leaves other sessions' forwards running", async () => {
    const fakeSession = {
      forwardOut: vi.fn(async (_s: string, _p: number, dstHost: string, dstPort: number) =>
        net.connect(dstPort, dstHost),
      ),
    };
    sessionManager.getSsh.mockReturnValue(fakeSession);

    const ruleA = await portForwardManager.start({
      sessionId: "s1",
      type: "local",
      srcPort: 0,
      dstHost: "127.0.0.1",
      dstPort: echo.port,
    });
    const ruleB = await portForwardManager.start({
      sessionId: "s2",
      type: "local",
      srcPort: 0,
      dstHost: "127.0.0.1",
      dstPort: echo.port,
    });

    await portForwardManager.closeForSession("s1");

    expect(portForwardManager.list("s1")).toHaveLength(0);
    expect(portForwardManager.list("s2").map((r) => r.id)).toEqual([ruleB.id]);

    await portForwardManager.stop(ruleA.id);
    await portForwardManager.stop(ruleB.id);
  });
});
