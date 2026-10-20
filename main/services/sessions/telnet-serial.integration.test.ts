/**
 * Telnet over a real localhost socket, and serial over a real pseudo-terminal
 * (node-pty's slave device stands in for a USB adapter: what the session
 * writes to it comes out of the pty, and what the pty writes arrives as port
 * input).
 */
import * as net from "net";

import { describe, it, expect, vi, afterEach } from "vitest";

import type { ConnectionProfile } from "@shared/ipc-contract";
import type { TerminalChannel } from "./terminal-channel.js";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

const { TelnetSession } = await import("./telnet-session.js");
const { SerialSession } = await import("./serial-session.js");

const IAC = 255;
const WILL = 251;
const DO = 253;
const ECHO = 1;
const NAWS = 31;

function profile(overrides: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: "p1",
    name: "test",
    protocol: "telnet",
    host: "127.0.0.1",
    port: 23,
    username: "",
    authType: "password",
    tags: [],
    ...overrides,
  };
}

/** Collects a channel's output until `match` shows up. */
function waitForOutput(channel: TerminalChannel, match: RegExp, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${match}; got ${JSON.stringify(text)}`)), timeoutMs);
    channel.on("data", (chunk) => {
      text += chunk.toString();
      if (match.test(text)) {
        clearTimeout(timer);
        resolve(text);
      }
    });
  });
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("TelnetSession", () => {
  it("negotiates, auto-logs in, and carries typed input", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (d) => {
        received.push(d);
        const text = Buffer.concat(received).toString("latin1");
        if (text.endsWith("admin\r\n") && !text.includes("s3cret")) socket.write("Password: ");
        else if (text.endsWith("s3cret\r\n")) socket.write("\r\nWelcome\r\nrouter# ");
      });
      socket.write(Buffer.from([IAC, WILL, ECHO, IAC, DO, NAWS]));
      socket.write("Username: ");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => void server.close());
    const port = (server.address() as net.AddressInfo).port;

    const session = await TelnetSession.connect("s1", profile({ port, username: "admin" }), "s3cret");
    cleanups.push(() => session.close());
    const channel = await session.openShell(100, 30);

    const output = await waitForOutput(channel, /router# $/);
    expect(output).toContain("Welcome");
    expect(output).not.toContain("\xff");

    const all = Buffer.concat(received);
    // We agreed to NAWS and sent 100×30.
    expect(all.includes(Buffer.from([IAC, 250, NAWS, 0, 100, 0, 30, IAC, 240]))).toBe(true);
    expect(all.toString("latin1")).toContain("admin\r\n");

    channel.write("show ver\r");
    await vi.waitFor(() => expect(Buffer.concat(received).toString("latin1")).toContain("show ver\r\n"));
  });

  it("fails connect() when nothing is listening", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));

    await expect(TelnetSession.connect("s1", profile({ port }), null)).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("SerialSession", () => {
  it("opens a tty device, sets it raw, and carries data both ways", async () => {
    const pty = await import("node-pty");
    // A process that never reads, so the pty's slave side is ours alone.
    const proc = pty.spawn("/bin/sleep", ["30"], { cols: 80, rows: 24 });
    cleanups.push(() => proc.kill());
    const device = (proc as unknown as { _pty: string })._pty;
    let fromPort = "";
    proc.onData((d) => (fromPort += d));

    const session = await SerialSession.connect("s1", profile({ protocol: "serial", host: device, port: 9600 }));
    cleanups.push(() => session.close());
    const channel = await session.openShell();

    await expect(session.openShell()).rejects.toThrow(/already open/);

    const output = waitForOutput(channel, /hello from the board/);
    proc.write("hello from the board\n");
    expect(await output).toContain("hello from the board");

    channel.write("AT\r");
    await vi.waitFor(() => expect(fromPort).toContain("AT"));
  });

  it("explains a missing device", async () => {
    await expect(
      SerialSession.connect("s1", profile({ protocol: "serial", host: "/dev/cu.nexus-missing", port: 9600 })),
    ).rejects.toThrow(/isn't there/);
  });
});
