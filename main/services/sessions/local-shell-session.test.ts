import { EventEmitter } from "events";

import { describe, it, expect, vi } from "vitest";

import { PtyChannel, resolveLoginShell } from "./local-shell-session.js";

import type { IPty } from "node-pty";

/** Just the IPty surface PtyChannel touches, driven by hand. */
function fakePty() {
  const events = new EventEmitter();
  const pty = {
    onData: (cb: (data: string) => void) => events.on("data", cb),
    onExit: (cb: (e: { exitCode: number }) => void) => events.on("exit", cb),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  return { pty: pty as unknown as IPty & typeof pty, events };
}

describe("PtyChannel", () => {
  it("forwards pty output as data events and exit codes as exit events", () => {
    const { pty, events } = fakePty();
    const channel = new PtyChannel(pty);
    const data: string[] = [];
    const exits: (number | null)[] = [];
    channel.on("data", (d: string) => data.push(d));
    channel.on("exit", (code: number | null) => exits.push(code));

    events.emit("data", "hello");
    events.emit("exit", { exitCode: 3 });

    expect(data).toEqual(["hello"]);
    expect(exits).toEqual([3]);
  });

  it("maps setWindow(rows, cols) to resize(cols, rows) and ignores empty sizes", () => {
    const { pty } = fakePty();
    const channel = new PtyChannel(pty);

    channel.setWindow(24, 80);
    channel.setWindow(0, 0);

    expect(pty.resize).toHaveBeenCalledTimes(1);
    expect(pty.resize).toHaveBeenCalledWith(80, 24);
  });

  it("stops writing, resizing and killing once the process has exited", () => {
    const { pty, events } = fakePty();
    const channel = new PtyChannel(pty);
    events.emit("exit", { exitCode: 0 });

    channel.write("ls\n");
    channel.setWindow(24, 80);
    channel.close();

    expect(pty.write).not.toHaveBeenCalled();
    expect(pty.resize).not.toHaveBeenCalled();
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it("kills a running process on close()", () => {
    const { pty } = fakePty();
    new PtyChannel(pty).close();
    expect(pty.kill).toHaveBeenCalledTimes(1);
  });
});

describe("resolveLoginShell", () => {
  it("uses an absolute $SHELL", () => {
    expect(resolveLoginShell({ SHELL: "/opt/homebrew/bin/fish" })).toBe("/opt/homebrew/bin/fish");
  });

  it("falls back to zsh when $SHELL is missing or not absolute", () => {
    expect(resolveLoginShell({})).toBe("/bin/zsh");
    expect(resolveLoginShell({ SHELL: "bash" })).toBe("/bin/zsh");
  });
});

// Exercises the real native module, so it also catches a spawn-helper that
// lost its execute bit (see build/fix-node-pty-permissions.cjs).
describe.skipIf(process.platform === "win32")("PtyChannel with a real pty", () => {
  it("runs a command in a real terminal", async () => {
    const pty = await import("node-pty");
    const channel = new PtyChannel(pty.spawn("/bin/sh", ["-c", "test -t 0 && printf tty-ok"], { cols: 80, rows: 24 }));
    let output = "";
    channel.on("data", (d: string) => (output += d));
    const code = await new Promise<number | null>((resolve) => channel.on("exit", resolve));

    expect(code).toBe(0);
    expect(output).toContain("tty-ok");
  });
});
