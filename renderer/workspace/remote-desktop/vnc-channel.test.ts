import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VncClosedEvent, VncDataEvent } from "@shared/ipc-contract";

// A controllable stand-in for the IPC wrapper: open() resolves when the test says so.
const handlers = { data: [] as ((e: VncDataEvent) => void)[], closed: [] as ((e: VncClosedEvent) => void)[] };
let resolveOpen: (r: { channelId: string }) => void = () => {};
let rejectOpen: (e: Error) => void = () => {};
const ipcMock = {
  vnc: {
    open: vi.fn(
      () =>
        new Promise<{ channelId: string }>((resolve, reject) => {
          resolveOpen = resolve;
          rejectOpen = reject;
        }),
    ),
    send: vi.fn(),
    close: vi.fn(() => Promise.resolve({ ok: true })),
    onData: (h: (e: VncDataEvent) => void) => (handlers.data.push(h), () => {}),
    onClosed: (h: (e: VncClosedEvent) => void) => (handlers.closed.push(h), () => {}),
  },
};
vi.mock("@renderer/lib/ipc", () => ({ ipc: ipcMock }));

const { VncChannel } = await import("./vnc-channel.js");

const emitData = (channelId: string, bytes: number[]) =>
  handlers.data.forEach((h) => h({ channelId, data: new Uint8Array(bytes) }));
const emitClosed = (e: VncClosedEvent) => handlers.closed.forEach((h) => h(e));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  handlers.data = [];
  handlers.closed = [];
  vi.clearAllMocks();
});

describe("VncChannel", () => {
  it("keeps the server greeting that arrives before vnc:open resolves", async () => {
    const channel = new VncChannel("s1");
    const received: number[][] = [];
    channel.onmessage = (e) => received.push(Array.from(new Uint8Array(e.data)));
    const opened = vi.fn();
    channel.onopen = opened;

    emitData("c1", [82, 70, 66]); // "RFB" before we know our id
    emitData("other", [9]); // another viewer's bytes
    resolveOpen({ channelId: "c1" });
    await flush();

    expect(opened).toHaveBeenCalledOnce();
    expect(channel.readyState).toBe("open");
    expect(received).toEqual([[82, 70, 66]]);

    emitData("c1", [1, 2]);
    expect(received).toEqual([
      [82, 70, 66],
      [1, 2],
    ]);
  });

  it("sends only once open, and reports a server-side close", async () => {
    const channel = new VncChannel("s1");
    channel.send(new Uint8Array([1]));
    expect(ipcMock.vnc.send).not.toHaveBeenCalled();

    resolveOpen({ channelId: "c1" });
    await flush();
    channel.send(new Uint8Array([7, 8]));
    expect(ipcMock.vnc.send).toHaveBeenCalledWith({ channelId: "c1", data: new Uint8Array([7, 8]) });

    const closed = vi.fn();
    channel.onclose = closed;
    emitClosed({ channelId: "c1" });
    expect(closed).toHaveBeenCalledWith({ code: 1000, reason: "", wasClean: true });
    expect(channel.readyState).toBe("closed");
  });

  it("surfaces a failed connect as error then close", async () => {
    const channel = new VncChannel("s1");
    const order: string[] = [];
    channel.onerror = () => order.push("error");
    channel.onclose = (e) => order.push(`close:${e.code}`);

    rejectOpen(new Error("Error invoking remote method 'vnc:open': Error: connect ECONNREFUSED 10.0.0.9:5900"));
    await flush();

    expect(order).toEqual(["error", "close:1006"]);
    expect(channel.error).toBe("connect ECONNREFUSED 10.0.0.9:5900");
  });

  it("closes the backend channel if the pane closed while connecting", async () => {
    const channel = new VncChannel("s1");
    channel.close();
    resolveOpen({ channelId: "late" });
    await flush();
    expect(ipcMock.vnc.close).toHaveBeenCalledWith({ channelId: "late" });
  });
});
