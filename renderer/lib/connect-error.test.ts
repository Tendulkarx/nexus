import { describe, it, expect } from "vitest";

import { describeConnectFailure } from "./connect-error.js";

const profile = { name: "prdsrv2 ", host: "prdsrv2", port: 22, authType: "password" as const };

describe("describeConnectFailure", () => {
  it("explains a refused password and points at key sign-in", () => {
    const msg = describeConnectFailure(
      "Error invoking remote method 'session:connect': Error: connect: getConnection: All configured authentication methods failed",
      profile,
    );
    expect(msg.title).toBe("prdsrv2 refused the sign-in");
    expect(msg.hint).toMatch(/Private key/);
    expect(msg.suggestEdit).toBe(true);
  });

  it("gives key users a key-specific hint", () => {
    expect(
      describeConnectFailure("All configured authentication methods failed", { ...profile, authType: "key" }).hint,
    ).toMatch(/authorized_keys/);
  });

  it("names refused ports and unknown hosts", () => {
    expect(describeConnectFailure("connect ECONNREFUSED 10.0.0.5:22", profile).title).toBe(
      "Nothing is accepting connections on prdsrv2:22",
    );
    expect(describeConnectFailure("getaddrinfo ENOTFOUND prdsrv2", profile).title).toBe("Couldn't find prdsrv2");
  });

  it("falls back to the library text without Electron's wrapper", () => {
    expect(
      describeConnectFailure("Error invoking remote method 'session:connect': Error: Something odd", profile).title,
    ).toBe("Something odd");
  });
});
