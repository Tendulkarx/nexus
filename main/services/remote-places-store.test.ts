import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let userDataDir: string;

vi.mock("electron", () => ({
  app: { getPath: (name: string) => (name === "userData" ? userDataDir : os.tmpdir()) },
}));

describe("RemotePlacesStore", () => {
  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-remote-places-"));
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it("starts with no bookmarks or recents for an unknown profile", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    expect(await remotePlacesStore.listBookmarks("p1")).toEqual([]);
    expect(await remotePlacesStore.listRecents("p1")).toEqual([]);
  });

  it("adds a bookmark and doesn't duplicate it on a repeat add", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    await remotePlacesStore.addBookmark("p1", "/var/www");
    const bookmarks = await remotePlacesStore.addBookmark("p1", "/var/www");
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({ path: "/var/www" });
  });

  it("removes a bookmark", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    await remotePlacesStore.addBookmark("p1", "/var/www");
    const bookmarks = await remotePlacesStore.removeBookmark("p1", "/var/www");
    expect(bookmarks).toEqual([]);
  });

  it("keeps bookmarks/recents scoped per profile id", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    await remotePlacesStore.addBookmark("p1", "/a");
    await remotePlacesStore.addBookmark("p2", "/b");
    expect(await remotePlacesStore.listBookmarks("p1")).toEqual([expect.objectContaining({ path: "/a" })]);
    expect(await remotePlacesStore.listBookmarks("p2")).toEqual([expect.objectContaining({ path: "/b" })]);
  });

  it("records recent visits most-recent-first, moving a repeat visit to the front without duplicating it", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    await remotePlacesStore.recordVisit("p1", "/a");
    await remotePlacesStore.recordVisit("p1", "/b");
    await remotePlacesStore.recordVisit("p1", "/a");
    expect(await remotePlacesStore.listRecents("p1")).toEqual(["/a", "/b"]);
  });

  it("caps recents at 15 entries", async () => {
    const { remotePlacesStore } = await import("./remote-places-store.js");
    for (let i = 0; i < 20; i++) {
      await remotePlacesStore.recordVisit("p1", `/dir${i}`);
    }
    const recents = await remotePlacesStore.listRecents("p1");
    expect(recents).toHaveLength(15);
    expect(recents[0]).toBe("/dir19");
  });

  it("persists across store instances (backed by disk, not just memory)", async () => {
    const mod1 = await import("./remote-places-store.js");
    await mod1.remotePlacesStore.addBookmark("p1", "/persisted");

    vi.resetModules();
    const mod2 = await import("./remote-places-store.js");
    expect(await mod2.remotePlacesStore.listBookmarks("p1")).toEqual([
      expect.objectContaining({ path: "/persisted" }),
    ]);
  });
});
