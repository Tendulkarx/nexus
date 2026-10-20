/**
 * A Telnet session: terminal-only (SessionInfo.kind "terminal"), for routers,
 * switches, BMCs and old Unix boxes. macOS no longer ships a telnet binary, so
 * this is a client of its own on a plain TCP socket, with the protocol in
 * telnet-protocol.ts.
 *
 * connect() opens the first socket so a refused or unreachable host fails in
 * the connect toast; that socket serves the first terminal, and each later
 * terminal (a split, or Reconnect) opens its own. Nothing is encrypted, which
 * the New Session picker says. With a username saved, the first login and
 * password prompts are answered automatically.
 */
import { EventEmitter } from "events";
import * as net from "net";
import { StringDecoder } from "string_decoder";

import { logger } from "../../logger.js";
import { TelnetAutoLogin, TelnetNegotiator } from "./telnet-protocol.js";

import type { ConnectionProfile, SessionInfo } from "@shared/ipc-contract";
import type { TerminalCapableSession, TerminalChannel } from "./terminal-channel.js";

const CONNECT_TIMEOUT_MS = 15_000;
/** Auto-login only looks for prompts this long; later "login:" text is just output. */
const AUTO_LOGIN_WINDOW_MS = 30_000;

function openSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Adapts a Telnet socket to the TerminalChannel shape TerminalService expects. */
export class TelnetChannel extends EventEmitter implements TerminalChannel {
  private readonly telnet: TelnetNegotiator;
  private readonly decoder = new StringDecoder("utf-8");
  private autoLogin: TelnetAutoLogin | null;
  private closed = false;

  constructor(
    private readonly socket: net.Socket,
    cols: number,
    rows: number,
    login: { username: string; password: string | null },
  ) {
    super();
    this.telnet = new TelnetNegotiator((bytes) => this.socket.write(bytes));
    this.telnet.setSize(cols, rows);
    this.autoLogin = login.username || login.password ? new TelnetAutoLogin(login.username, login.password) : null;
    if (this.autoLogin) setTimeout(() => (this.autoLogin = null), AUTO_LOGIN_WINDOW_MS).unref();

    socket.on("data", (chunk: Buffer) => {
      const text = this.decoder.write(this.telnet.receive(chunk));
      if (!text) return;
      this.emit("data", text);
      const reply = this.autoLogin?.observe(text);
      if (reply) this.socket.write(this.telnet.encodeInput(reply));
      if (this.autoLogin?.done) this.autoLogin = null;
    });
    socket.on("error", (err) => {
      logger.warn("telnet", "Socket error", { message: err.message });
      this.emit("data", `\r\n[${err.message}]\r\n`);
    });
    socket.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
  }

  write(data: string): void {
    if (this.closed) return;
    this.socket.write(this.telnet.encodeInput(data));
    // A line-mode server doesn't echo, so show what was typed (Enter as a new line, Backspace erasing).
    if (this.telnet.localEcho) this.emit("data", data.replace(/\r/g, "\r\n").replace(/\x7f/g, "\b \b"));
  }

  setWindow(rows: number, cols: number): void {
    if (this.closed || rows < 1 || cols < 1) return;
    this.telnet.setSize(cols, rows);
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

export class TelnetSession implements TerminalCapableSession {
  readonly info: SessionInfo;
  readonly onConnectCommand = null;
  /** Routers and switches can't run the OSC 7 hook, and typing it into one is worse than useless. */
  readonly injectShellIntegration = false;
  private firstSocket: net.Socket | null;
  private readonly channels = new Set<TelnetChannel>();

  private constructor(
    sessionId: string,
    private readonly profile: ConnectionProfile,
    private readonly secret: string | null,
    socket: net.Socket,
  ) {
    this.firstSocket = socket;
    this.info = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: profile.username,
      homeDir: "",
      supportsTerminal: true,
      kind: "terminal",
    };
  }

  static async connect(sessionId: string, profile: ConnectionProfile, secret: string | null): Promise<TelnetSession> {
    if (profile.protocol !== "telnet") throw new Error(`TelnetSession created for ${profile.protocol}`);
    const socket = await openSocket(profile.host, profile.port || 23);
    logger.info("telnet", "Connected", { sessionId, host: profile.host, port: profile.port || 23 });
    return new TelnetSession(sessionId, profile, secret, socket);
  }

  async openShell(cols: number, rows: number): Promise<TerminalChannel> {
    const socket =
      this.firstSocket && !this.firstSocket.destroyed
        ? this.firstSocket
        : await openSocket(this.profile.host, this.profile.port || 23);
    this.firstSocket = null;
    const channel = new TelnetChannel(socket, cols, rows, {
      username: this.profile.username,
      password: this.secret,
    });
    this.channels.add(channel);
    channel.on("close", () => this.channels.delete(channel));
    return channel;
  }

  async close(): Promise<void> {
    this.firstSocket?.destroy();
    this.firstSocket = null;
    for (const channel of this.channels) channel.close();
    this.channels.clear();
  }
}
