import { describe, it, expect } from "vitest";

import { describeConnectError } from "./vnc-session.js";

const errno = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

describe("describeConnectError", () => {
  it("unwraps the AggregateError Node throws when every resolved address fails", () => {
    const err = new AggregateError([errno("ECONNREFUSED"), errno("ECONNREFUSED")], "");
    expect(describeConnectError(err, "osbmac2.local", 5900)).toBe(
      "osbmac2.local:5900 refused the connection. Is Screen Sharing (or the VNC server) turned on there?",
    );
  });

  it("prefers a refusal over an unreachable IPv6 address when both were tried", () => {
    const err = new AggregateError([errno("EHOSTUNREACH"), errno("ECONNREFUSED")], "");
    expect(describeConnectError(err, "osbmac2.local", 5900)).toMatch(/refused the connection/);
  });

  it("explains unknown names, unreachable hosts and timeouts", () => {
    expect(describeConnectError(errno("ENOTFOUND"), "nope.lan", 5900)).toMatch(/Couldn't find nope.lan/);
    expect(describeConnectError(errno("EHOSTUNREACH"), "10.9.9.9", 5900)).toMatch(/isn't reachable/);
    expect(describeConnectError(errno("ETIMEDOUT"), "h", 5901)).toMatch(/firewall may be blocking port 5901/);
  });

  it("falls back to the original message, then a generic one", () => {
    expect(describeConnectError(new Error("socket hang up"), "h", 1)).toBe("socket hang up");
    expect(describeConnectError(new AggregateError([], ""), "h", 1)).toBe("Couldn't connect to h:1");
  });
});
