import { describe, it, expect } from "vitest";

import { OSC7_SHELL_INTEGRATION_SNIPPET, READY_MARKER, stripInjectedEcho } from "./shell-integration.js";

const echo = OSC7_SHELL_INTEGRATION_SNIPPET;

describe("OSC7_SHELL_INTEGRATION_SNIPPET", () => {
  it("is one line starting with a space, so it's typed once and kept out of history", () => {
    expect(echo).not.toContain("\n");
    expect(echo.startsWith(" if [")).toBe(true);
  });
});

describe("stripInjectedEcho", () => {
  it("waits for the marker", () => {
    expect(stripInjectedEcho(`Welcome to Ubuntu\r\n${echo}\r\n`)).toBeNull();
  });

  it("keeps the banner and the new prompt, drops the tty echo, the first prompt and the editor's echo", () => {
    const held =
      "Welcome to Ubuntu\r\n" +
      `${echo}\r\n` +
      "╭╴ turbx on prdsrv2\r\n╰─❯ \x1b[32mif\x1b[0m [ -n ...\r\n" +
      READY_MARKER +
      "\x1b]7;file://prdsrv2/home/turbx\x1b\\╭╴ turbx on prdsrv2\r\n╰─❯ ";
    expect(stripInjectedEcho(held)).toBe(
      "Welcome to Ubuntu\r\n\x1b]7;file://prdsrv2/home/turbx\x1b\\╭╴ turbx on prdsrv2\r\n╰─❯ ",
    );
  });

  it("only removes the marker when no echo is found", () => {
    expect(stripInjectedEcho(`$ ${READY_MARKER}$ `)).toBe("$ $ ");
  });
});
