/**
 * A serial-console session (USB serial adapters, console cables): terminal
 * only. The profile's `host` is the device path (/dev/cu.usbserial-…) and its
 * `port` is the speed in baud; framing is 8N1 with no flow control, which is
 * what network gear and dev boards use.
 *
 * No native serial module: the device is opened with O_NOCTTY | O_NONBLOCK
 * (a cu.* device never waits for carrier), configured by running stty with
 * that open file as its stdin (macOS resets a port's settings when its last
 * file closes, so `stty -f` alone wouldn't stick), read through a tty
 * ReadStream, and written through a second, blocking descriptor so writes
 * never fail with EAGAIN. Only one terminal at a time owns the port.
 */
import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as tty from "tty";
import { promisify } from "util";

import { logger } from "../../logger.js";

import type { ConnectionProfile, SessionInfo } from "@shared/ipc-contract";
import type { TerminalCapableSession, TerminalChannel } from "./terminal-channel.js";

const openAsync = promisify(fs.open);
const closeAsync = promisify(fs.close);
const writeAsync = promisify(fs.write);

export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const;
export const DEFAULT_BAUD = 115200;

/** stty arguments for raw 8N1 at `baud`, no flow control, ignoring modem lines. */
export function sttyArgs(baud: number): string[] {
  return [String(baud), "cs8", "-parenb", "-cstopb", "raw", "-echo", "clocal", "-crtscts", "-ixon", "-ixoff"];
}

/** /dev/cu.* devices, USB adapters first. tty.* twins are left out: they block until carrier. */
export async function listSerialPorts(): Promise<string[]> {
  const names = await fs.promises.readdir("/dev").catch(() => [] as string[]);
  const usbFirst = (name: string) => (/usb|serial|uart|SLAB|wch/i.test(name) ? 0 : 1);
  return names
    .filter((n) => n.startsWith("cu."))
    .sort((a, b) => usbFirst(a) - usbFirst(b) || a.localeCompare(b))
    .map((n) => `/dev/${n}`);
}

function runStty(fd: number, baud: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/stty", sttyArgs(baud), { stdio: [fd, "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `stty exited with ${code}`)),
    );
  });
}

function describeOpenError(device: string, err: NodeJS.ErrnoException): Error {
  if (err.code === "ENOENT") return new Error(`${device} isn't there. Is the adapter plugged in?`);
  if (err.code === "EBUSY") return new Error(`${device} is in use by another app`);
  if (err.code === "EACCES") return new Error(`No permission to open ${device}`);
  return err;
}

/** An open serial port as a TerminalChannel. */
export class SerialChannel extends EventEmitter implements TerminalChannel {
  private writes: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly reader: tty.ReadStream,
    private readonly writeFd: number,
  ) {
    super();
    reader.on("data", (chunk: Buffer) => this.emit("data", chunk));
    reader.on("error", (err) => {
      // Unplugging the adapter surfaces as ENXIO/EIO on the next read.
      logger.warn("serial", "Read failed", { message: err.message });
      this.emit("data", `\r\n[Port closed: ${err.message}]\r\n`);
      this.close();
    });
    reader.on("close", () => this.close());
  }

  static async open(device: string, baud: number): Promise<SerialChannel> {
    const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY;
    const readFd = await openAsync(device, flags | fs.constants.O_NONBLOCK).catch((err) => {
      throw describeOpenError(device, err as NodeJS.ErrnoException);
    });
    let writeFd: number | null = null;
    try {
      await runStty(readFd, baud);
      writeFd = await openAsync(device, flags);
    } catch (err) {
      await closeAsync(readFd).catch(() => {});
      throw err;
    }
    return new SerialChannel(new tty.ReadStream(readFd), writeFd);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  write(data: string): void {
    if (this.closed) return;
    const bytes = Buffer.from(data, "utf-8");
    // Queued so keystrokes reach the port in order (fs.write calls can otherwise overtake each other).
    this.writes = this.writes.then(() => writeAsync(this.writeFd, bytes)).catch(() => {});
  }

  // A serial line has no window size to report.
  setWindow(): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.destroy();
    void this.writes.finally(() => closeAsync(this.writeFd).catch(() => {}));
    this.emit("close");
  }
}

export class SerialSession implements TerminalCapableSession {
  readonly info: SessionInfo;
  readonly onConnectCommand = null;
  readonly injectShellIntegration = false;
  /** The open port; `inUse` once a terminal has it. connect() opens it before any terminal exists. */
  private channel: SerialChannel | null;
  private inUse = false;

  private constructor(
    sessionId: string,
    private readonly profile: ConnectionProfile,
    channel: SerialChannel,
  ) {
    this.channel = channel;
    this.info = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: "",
      homeDir: "",
      supportsTerminal: true,
      kind: "terminal",
    };
  }

  /** Opens the port straight away, so a missing or busy device fails in the connect toast. */
  static async connect(sessionId: string, profile: ConnectionProfile): Promise<SerialSession> {
    if (profile.protocol !== "serial") throw new Error(`SerialSession created for ${profile.protocol}`);
    const baud = profile.port || DEFAULT_BAUD;
    const channel = await SerialChannel.open(profile.host, baud);
    logger.info("serial", "Opened port", { sessionId, device: profile.host, baud });
    return new SerialSession(sessionId, profile, channel);
  }

  async openShell(): Promise<TerminalChannel> {
    if (this.inUse) throw new Error(`${this.profile.host} is already open in another pane`);
    const channel = this.channel?.isOpen
      ? this.channel
      : await SerialChannel.open(this.profile.host, this.profile.port || DEFAULT_BAUD);
    this.channel = channel;
    this.inUse = true;
    channel.on("close", () => {
      if (this.channel !== channel) return;
      this.channel = null;
      this.inUse = false;
    });
    return channel;
  }

  async close(): Promise<void> {
    this.channel?.close();
    this.channel = null;
  }
}
