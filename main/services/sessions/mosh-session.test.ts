import { describe, it, expect, vi } from "vitest";

// mosh-session.ts pulls in ssh-connect.ts (shared with SshSession), which
// imports `dialog` from "electron" at module load time — mocked here purely
// so importing parseMoshServerOutput doesn't require a real Electron binary,
// same as ssh-session.test.ts.
vi.mock("electron", () => ({ dialog: { showMessageBox: vi.fn() } }));

const { parseMoshServerOutput } = await import("./mosh-session.js");

describe("parseMoshServerOutput", () => {
  it("parses the port and key out of real mosh-server output", () => {
    // Captured verbatim from `mosh-server new -s` (mosh 1.4.0) run over SSH
    // against a local throwaway sshd during manual end-to-end testing.
    const output = [
      "MOSH CONNECT 60001 lRYAl2ZtG3ZApIpEvT0q4g",
      "",
      "mosh-server (mosh 1.4.0) [build mosh 1.4.0]",
      "Copyright 2012 Keith Winstein <mosh-devel@mit.edu>",
      "License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>.",
      "This is free software: you are free to change and redistribute it.",
      "There is NO WARRANTY, to the extent permitted by law.",
      "",
      "[mosh-server detached, pid = 95599]",
    ].join("\n");

    expect(parseMoshServerOutput(output)).toEqual({ port: 60001, key: "lRYAl2ZtG3ZApIpEvT0q4g" });
  });

  it("parses the bootstrap line even when it isn't the first line of output", () => {
    const output = "Warning: something printed by the remote shell's profile first\nMOSH CONNECT 443 abc123==\nmore output after";

    expect(parseMoshServerOutput(output)).toEqual({ port: 443, key: "abc123==" });
  });

  it("throws a descriptive error when the bootstrap line is missing", () => {
    const output = "bash: mosh-server: command not found";

    expect(() => parseMoshServerOutput(output)).toThrow(/mosh-server installed on the remote host/);
  });

  it("throws on empty output", () => {
    expect(() => parseMoshServerOutput("")).toThrow();
  });
});
