/**
 * The Telnet protocol (RFC 854) without any I/O: splits what the server sends
 * into terminal text and option negotiation, answers that negotiation, and
 * encodes typed input. TelnetSession feeds it socket bytes; tests feed it
 * buffers directly.
 *
 * Nexus agrees to the options a terminal needs and refuses the rest:
 * - server side: ECHO (the server echoes, so we don't), SGA (character at a
 *   time instead of half-duplex lines) and BINARY (8-bit clean, for UTF-8).
 * - our side: TTYPE (we're xterm-256color), NAWS (window size, resent on
 *   every resize), SGA and BINARY.
 * Until the server says WILL ECHO, `localEcho` is true and the session echoes
 * typed text itself, as every Telnet client does for line-mode servers.
 */

export const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

export const OPT = { BINARY: 0, ECHO: 1, SGA: 3, TTYPE: 24, NAWS: 31 } as const;
const TTYPE_IS = 0;
const TTYPE_SEND = 1;

/** Options we let the server turn on for its side (it sends WILL, we answer DO). */
const ACCEPT_REMOTE = new Set<number>([OPT.ECHO, OPT.SGA, OPT.BINARY]);
/** Options we turn on for our side when asked (it sends DO, we answer WILL). */
const ACCEPT_LOCAL = new Set<number>([OPT.TTYPE, OPT.NAWS, OPT.SGA, OPT.BINARY]);

type State = "data" | "iac" | "option" | "sb" | "sb-iac";

export class TelnetNegotiator {
  private state: State = "data";
  private command = 0;
  private sbBuffer: number[] = [];
  /** The last byte of text was CR: a following NUL is padding (RFC 854) and dropped. */
  private afterCr = false;
  private readonly remote = new Set<number>();
  private readonly local = new Set<number>();
  private cols = 80;
  private rows = 24;

  constructor(
    /** Sends negotiation bytes to the server. */
    private readonly send: (bytes: Buffer) => void,
    private readonly terminalType = "XTERM-256COLOR",
  ) {}

  /** True until the server takes over echoing (WILL ECHO). */
  get localEcho(): boolean {
    return !this.remote.has(OPT.ECHO);
  }

  /** Feeds bytes from the server; returns the text part for the terminal. */
  receive(chunk: Buffer): Buffer {
    const out: number[] = [];
    for (const byte of chunk) {
      switch (this.state) {
        case "data":
          if (byte === IAC) this.state = "iac";
          else if (byte === 0 && this.afterCr) this.afterCr = false;
          else {
            out.push(byte);
            this.afterCr = byte === 13;
          }
          break;
        case "iac":
          if (byte === IAC) {
            out.push(IAC);
            this.state = "data";
          } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
            this.command = byte;
            this.state = "option";
          } else if (byte === SB) {
            this.sbBuffer = [];
            this.state = "sb";
          } else {
            // NOP, GA, AYT and friends carry nothing a terminal shows.
            this.state = "data";
          }
          break;
        case "option":
          this.negotiate(this.command, byte);
          this.state = "data";
          break;
        case "sb":
          if (byte === IAC) this.state = "sb-iac";
          else this.sbBuffer.push(byte);
          break;
        case "sb-iac":
          if (byte === SE) {
            this.subnegotiation(this.sbBuffer);
            this.state = "data";
          } else {
            // IAC IAC inside a subnegotiation is a literal 255.
            this.sbBuffer.push(byte);
            this.state = "sb";
          }
          break;
      }
    }
    return Buffer.from(out);
  }

  /** Encodes typed input: UTF-8 (which never contains a 255 byte, so no IAC escaping), Enter as Telnet's CR LF (bare CR in binary mode). */
  encodeInput(text: string): Buffer {
    const newline = this.local.has(OPT.BINARY) ? "\r" : "\r\n";
    return Buffer.from(text.replace(/\r\n?|\n/g, newline), "utf-8");
  }

  /** Records the window size and tells the server, if it asked for NAWS. */
  setSize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    if (this.local.has(OPT.NAWS)) this.sendNaws();
  }

  private negotiate(command: number, option: number): void {
    switch (command) {
      case WILL:
        if (ACCEPT_REMOTE.has(option)) {
          if (!this.remote.has(option)) {
            this.remote.add(option);
            this.reply(DO, option);
          }
        } else this.reply(DONT, option);
        break;
      case WONT:
        if (this.remote.delete(option)) this.reply(DONT, option);
        break;
      case DO:
        if (ACCEPT_LOCAL.has(option)) {
          if (!this.local.has(option)) {
            this.local.add(option);
            this.reply(WILL, option);
          }
          if (option === OPT.NAWS) this.sendNaws();
        } else this.reply(WONT, option);
        break;
      case DONT:
        if (this.local.delete(option)) this.reply(WONT, option);
        break;
    }
  }

  private subnegotiation(data: number[]): void {
    if (data[0] === OPT.TTYPE && data[1] === TTYPE_SEND) {
      this.send(
        Buffer.from([IAC, SB, OPT.TTYPE, TTYPE_IS, ...Buffer.from(this.terminalType, "ascii"), IAC, SE]),
      );
    }
  }

  private sendNaws(): void {
    const size = [this.cols >> 8, this.cols & 0xff, this.rows >> 8, this.rows & 0xff].flatMap((b) =>
      b === IAC ? [IAC, IAC] : [b],
    );
    this.send(Buffer.from([IAC, SB, OPT.NAWS, ...size, IAC, SE]));
  }

  private reply(command: number, option: number): void {
    this.send(Buffer.from([IAC, command, option]));
  }
}

/** Telnet auto-login: answers the first login and password prompts with the profile's username and password. */
export class TelnetAutoLogin {
  private tail = "";
  private sentUser: boolean;
  private sentPassword: boolean;

  constructor(
    private readonly username: string,
    private readonly password: string | null,
  ) {
    this.sentUser = !username;
    this.sentPassword = !password;
  }

  get done(): boolean {
    return this.sentUser && this.sentPassword;
  }

  /** Looks at server text; returns what to type in reply, if anything. */
  observe(text: string): string | null {
    if (this.done) return null;
    // Keep only the end of the output: prompts are the last thing on the screen.
    this.tail = (this.tail + text).slice(-200);
    if (!this.sentUser && /(?:login|username|user name)\s*:\s*$/i.test(this.tail)) {
      this.sentUser = true;
      this.tail = "";
      return `${this.username}\r`;
    }
    if (!this.sentPassword && /password\s*:\s*$/i.test(this.tail)) {
      this.sentPassword = true;
      this.sentUser = true;
      this.tail = "";
      return `${this.password}\r`;
    }
    return null;
  }
}
