import { describe, it, expect } from "vitest";

import { IAC, OPT, TelnetAutoLogin, TelnetNegotiator } from "./telnet-protocol.js";

const DO = 253;
const DONT = 254;
const WILL = 251;
const WONT = 252;
const SB = 250;
const SE = 240;

function negotiator() {
  const sent: number[][] = [];
  const telnet = new TelnetNegotiator((bytes) => sent.push([...bytes]));
  return { telnet, sent };
}

describe("TelnetNegotiator", () => {
  it("passes text through and strips negotiation out of it", () => {
    const { telnet } = negotiator();
    const out = telnet.receive(Buffer.from([...Buffer.from("he"), IAC, WILL, OPT.ECHO, ...Buffer.from("llo")]));
    expect(out.toString()).toBe("hello");
  });

  it("accepts server echo and stops local echo", () => {
    const { telnet, sent } = negotiator();
    expect(telnet.localEcho).toBe(true);
    telnet.receive(Buffer.from([IAC, WILL, OPT.ECHO]));
    expect(sent).toEqual([[IAC, DO, OPT.ECHO]]);
    expect(telnet.localEcho).toBe(false);
    // A repeat doesn't start a negotiation loop.
    telnet.receive(Buffer.from([IAC, WILL, OPT.ECHO]));
    expect(sent).toHaveLength(1);
  });

  it("refuses options it doesn't support, both ways", () => {
    const { telnet, sent } = negotiator();
    telnet.receive(Buffer.from([IAC, WILL, 39, IAC, DO, 34]));
    expect(sent).toEqual([
      [IAC, DONT, 39],
      [IAC, WONT, 34],
    ]);
  });

  it("reports the window size when asked for NAWS, and again on resize", () => {
    const { telnet, sent } = negotiator();
    telnet.setSize(120, 40);
    telnet.receive(Buffer.from([IAC, DO, OPT.NAWS]));
    expect(sent).toEqual([
      [IAC, WILL, OPT.NAWS],
      [IAC, SB, OPT.NAWS, 0, 120, 0, 40, IAC, SE],
    ]);
    telnet.setSize(255, 50);
    // 255 is IAC, so it's doubled inside the subnegotiation.
    expect(sent[2]).toEqual([IAC, SB, OPT.NAWS, 0, IAC, IAC, 0, 50, IAC, SE]);
  });

  it("answers a terminal-type request with xterm-256color", () => {
    const { telnet, sent } = negotiator();
    telnet.receive(Buffer.from([IAC, DO, OPT.TTYPE, IAC, SB, OPT.TTYPE, 1, IAC, SE]));
    expect(sent[0]).toEqual([IAC, WILL, OPT.TTYPE]);
    expect(Buffer.from(sent[1]).subarray(4, -2).toString()).toBe("XTERM-256COLOR");
  });

  it("handles commands split across chunks", () => {
    const { telnet, sent } = negotiator();
    expect(telnet.receive(Buffer.from([...Buffer.from("a"), IAC])).toString()).toBe("a");
    expect(telnet.receive(Buffer.from([WILL])).toString()).toBe("");
    expect(telnet.receive(Buffer.from([OPT.SGA, ...Buffer.from("b")])).toString()).toBe("b");
    expect(sent).toEqual([[IAC, DO, OPT.SGA]]);
  });

  it("keeps an escaped 255 and drops the NUL after CR", () => {
    const { telnet } = negotiator();
    expect([...telnet.receive(Buffer.from([IAC, IAC, 13, 0, 65]))]).toEqual([255, 13, 65]);
  });

  it("sends Enter as CR LF, and as bare CR once binary mode is on", () => {
    const { telnet } = negotiator();
    expect(telnet.encodeInput("ls\r").toString()).toBe("ls\r\n");
    telnet.receive(Buffer.from([IAC, DO, OPT.BINARY]));
    expect(telnet.encodeInput("ls\r").toString()).toBe("ls\r");
  });
});

describe("TelnetAutoLogin", () => {
  it("answers the login then the password prompt, once each", () => {
    const login = new TelnetAutoLogin("admin", "s3cret");
    expect(login.observe("Welcome\r\nUser Name: ")).toBe("admin\r");
    expect(login.observe("Pass")).toBeNull();
    expect(login.observe("word:")).toBe("s3cret\r");
    expect(login.done).toBe(true);
    expect(login.observe("login: ")).toBeNull();
  });

  it("only types a username when no password is saved", () => {
    const login = new TelnetAutoLogin("pi", null);
    expect(login.observe("raspberrypi login: ")).toBe("pi\r");
    expect(login.done).toBe(true);
  });

  it("ignores prompts that aren't at the end of the output", () => {
    const login = new TelnetAutoLogin("pi", null);
    expect(login.observe("Last login: Mon Oct 20 on ttys001\r\n$ ")).toBeNull();
  });
});
