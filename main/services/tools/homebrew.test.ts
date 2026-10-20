import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi } from "vitest";

const emitted: { channel: string; payload: unknown }[] = [];
vi.mock("../ipc-emitter.js", () => ({
  emitToRenderer: (channel: string, payload: unknown) => emitted.push({ channel, payload }),
}));

const { BREW_NAME, HomebrewService, parseBrewInfo, parseSearchOutput } = await import("./homebrew.js");

describe("parseBrewInfo", () => {
  it("maps formulae and casks from brew info --json=v2", () => {
    const rows = parseBrewInfo({
      formulae: [
        {
          name: "wget",
          desc: "Internet file retriever",
          versions: { stable: "1.25.0" },
          installed: [{ version: "1.24.5", installed_on_request: true }],
          outdated: true,
          pinned: false,
        },
        {
          name: "libidn2",
          desc: "IDN library",
          versions: { stable: "2.3.8" },
          installed: [{ version: "2.3.8", installed_on_request: false }],
        },
      ],
      casks: [{ token: "iterm2", name: ["iTerm2"], desc: null, version: "3.6.2", installed: "3.6.1", outdated: true }],
    });
    expect(rows).toEqual([
      {
        name: "iterm2",
        kind: "cask",
        description: "iTerm2",
        installedVersion: "3.6.1",
        latestVersion: "3.6.2",
        outdated: true,
        dependency: false,
        pinned: false,
      },
      {
        name: "libidn2",
        kind: "formula",
        description: "IDN library",
        installedVersion: "2.3.8",
        latestVersion: "2.3.8",
        outdated: false,
        dependency: true,
        pinned: false,
      },
      {
        name: "wget",
        kind: "formula",
        description: "Internet file retriever",
        installedVersion: "1.24.5",
        latestVersion: "1.25.0",
        outdated: true,
        dependency: false,
        pinned: false,
      },
    ]);
  });
});

describe("parseSearchOutput and names", () => {
  it("keeps package names and drops headers, blanks and anything option-like", () => {
    expect(parseSearchOutput("==> Formulae\nhtop\n\nhomebrew/core/btop\n-rf\npython@3.13\n")).toEqual([
      "htop",
      "homebrew/core/btop",
      "python@3.13",
    ]);
    expect(BREW_NAME.test("--force")).toBe(false);
    expect(BREW_NAME.test("a b")).toBe(false);
  });
});

describe("HomebrewService jobs", () => {
  it("runs brew with the right arguments and streams its output, then one done event", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-brew-"));
    const fake = path.join(dir, "brew");
    await fs.writeFile(fake, '#!/bin/sh\necho "args: $*"\necho "warn" >&2\nexit 3\n', { mode: 0o755 });
    const service = new HomebrewService(async () => fake);

    const jobId = await service.start("install", "cask", ["iterm2"]);
    await vi.waitFor(() => expect(emitted.some((e) => e.channel === "tools:brew:done")).toBe(true));
    const output = emitted
      .filter((e) => e.channel === "tools:brew:output")
      .map((e) => (e.payload as { chunk: string }).chunk)
      .join("");
    expect(output).toContain("args: install --cask iterm2");
    expect(output).toContain("warn");
    expect(emitted.filter((e) => e.channel === "tools:brew:done")).toEqual([
      { channel: "tools:brew:done", payload: { jobId, code: 3, error: undefined } },
    ]);
    await fs.rm(dir, { recursive: true });
  });

  it("refuses option-like names and installs without a name", async () => {
    const service = new HomebrewService(async () => "/usr/bin/false");
    await expect(service.start("install", "formula", ["--HEAD"])).rejects.toThrow(/Invalid package name/);
    await expect(service.start("uninstall", "formula", [])).rejects.toThrow(/Choose a package/);
  });

  it("explains when Homebrew is missing", async () => {
    const service = new HomebrewService(async () => null);
    expect(await service.status()).toEqual({ installed: false, path: null, version: null });
    await expect(service.listInstalled()).rejects.toThrow(/brew\.sh/);
  });
});
