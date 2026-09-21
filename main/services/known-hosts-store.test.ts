import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let userDataDir: string;

vi.mock("electron", () => ({
  app: { getPath: (name: string) => (name === "userData" ? userDataDir : os.tmpdir()) },
}));

describe("KnownHostsStore", () => {
  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-known-hosts-"));
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it("returns null for a host it has never seen", async () => {
    const { knownHostsStore } = await import("./known-hosts-store.js");
    expect(await knownHostsStore.get("ssh", "example.com", 22)).toBeNull();
  });

  it("returns the fingerprint recorded by trust()", async () => {
    const { knownHostsStore } = await import("./known-hosts-store.js");
    await knownHostsStore.trust("ssh", "example.com", 22, "fp-1");
    expect(await knownHostsStore.get("ssh", "example.com", 22)).toBe("fp-1");
  });

  it("keeps ssh and rdp fingerprints for the same host:port separate", async () => {
    const { knownHostsStore } = await import("./known-hosts-store.js");
    await knownHostsStore.trust("ssh", "example.com", 3389, "ssh-fp");
    await knownHostsStore.trust("rdp", "example.com", 3389, "rdp-fp");
    expect(await knownHostsStore.get("ssh", "example.com", 3389)).toBe("ssh-fp");
    expect(await knownHostsStore.get("rdp", "example.com", 3389)).toBe("rdp-fp");
  });

  it("trust() overwrites a previously trusted fingerprint", async () => {
    const { knownHostsStore } = await import("./known-hosts-store.js");
    await knownHostsStore.trust("rdp", "example.com", 3389, "old-fp");
    await knownHostsStore.trust("rdp", "example.com", 3389, "new-fp");
    expect(await knownHostsStore.get("rdp", "example.com", 3389)).toBe("new-fp");
  });

  it("forget() removes a stored fingerprint", async () => {
    const { knownHostsStore } = await import("./known-hosts-store.js");
    await knownHostsStore.trust("rdp", "example.com", 3389, "fp-1");
    await knownHostsStore.forget("rdp", "example.com", 3389);
    expect(await knownHostsStore.get("rdp", "example.com", 3389)).toBeNull();
  });

  it("persists across store instances (backed by disk, not just memory)", async () => {
    const mod1 = await import("./known-hosts-store.js");
    await mod1.knownHostsStore.trust("rdp", "example.com", 3389, "persisted-fp");

    vi.resetModules();
    const mod2 = await import("./known-hosts-store.js");
    expect(await mod2.knownHostsStore.get("rdp", "example.com", 3389)).toBe("persisted-fp");
  });
});
