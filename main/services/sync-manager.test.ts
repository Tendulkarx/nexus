import { describe, it, expect, vi } from "vitest";

// computeSyncPlan itself is pure, but sync-manager.ts also pulls in
// session-manager.ts (ssh2/basic-ftp/electron) and ipc-emitter.ts
// (electron) for its execute()/plan() methods — mock those import
// boundaries so this file can load without a real Electron runtime.
vi.mock("./ipc-emitter.js", () => ({ emitToRenderer: vi.fn() }));
vi.mock("./session-manager.js", () => ({ sessionManager: { get: vi.fn() } }));
vi.mock("./transfer-manager.js", () => ({ transferManager: { startTracked: vi.fn() } }));
vi.mock("./activity-log.js", () => ({ activityLog: { record: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("./notification-service.js", () => ({ notify: vi.fn() }));

import { computeSyncPlan, type SyncFileEntry } from "./sync-manager.js";

function file(relPath: string, size: number, mtime: number): SyncFileEntry {
  return { relPath, size, mtime };
}

describe("computeSyncPlan", () => {
  it("uploads a file that only exists locally, in upload mode", () => {
    const plan = computeSyncPlan([file("a.txt", 10, 1000)], [], { mode: "upload", deleteOrphans: false });
    expect(plan).toEqual([{ relPath: "a.txt", action: "upload", size: 10, detail: "only on local" }]);
  });

  it("downloads a file that only exists remotely, in download mode", () => {
    const plan = computeSyncPlan([], [file("a.txt", 10, 1000)], { mode: "download", deleteOrphans: false });
    expect(plan).toEqual([{ relPath: "a.txt", action: "download", size: 10, detail: "only on remote" }]);
  });

  it("produces no action for a file present and identical on both sides", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 10, 1000)],
      [file("a.txt", 10, 1000)],
      { mode: "two-way", deleteOrphans: false },
    );
    expect(plan).toEqual([]);
  });

  it("tolerates small mtime skew (e.g. 1s FTP resolution) as 'same'", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 10, 1000)],
      [file("a.txt", 10, 1500)],
      { mode: "upload", deleteOrphans: false },
    );
    expect(plan).toEqual([]);
  });

  it("uploads an update when local is newer, in upload mode", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 20, 5000)],
      [file("a.txt", 10, 1000)],
      { mode: "upload", deleteOrphans: false },
    );
    expect(plan).toEqual([{ relPath: "a.txt", action: "upload", size: 20, detail: "local is newer" }]);
  });

  it("does not touch remote when remote is newer, in upload mode (never rolls remote back)", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 10, 1000)],
      [file("a.txt", 20, 5000)],
      { mode: "upload", deleteOrphans: false },
    );
    expect(plan).toEqual([]);
  });

  it("downloads an update when remote is newer, in download mode", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 10, 1000)],
      [file("a.txt", 20, 5000)],
      { mode: "download", deleteOrphans: false },
    );
    expect(plan).toEqual([{ relPath: "a.txt", action: "download", size: 20, detail: "remote is newer" }]);
  });

  it("does not touch local when local is newer, in download mode (never rolls local back)", () => {
    const plan = computeSyncPlan(
      [file("a.txt", 20, 5000)],
      [file("a.txt", 10, 1000)],
      { mode: "download", deleteOrphans: false },
    );
    expect(plan).toEqual([]);
  });

  it("leaves only-local/only-remote files alone in upload/download mode unless deleteOrphans is set", () => {
    const uploadPlan = computeSyncPlan([], [file("remote-only.txt", 10, 1000)], {
      mode: "upload",
      deleteOrphans: false,
    });
    expect(uploadPlan).toEqual([]);

    const downloadPlan = computeSyncPlan([file("local-only.txt", 10, 1000)], [], {
      mode: "download",
      deleteOrphans: false,
    });
    expect(downloadPlan).toEqual([]);
  });

  it("deletes the remote-only file in upload mode when deleteOrphans is enabled", () => {
    const plan = computeSyncPlan([], [file("remote-only.txt", 10, 1000)], {
      mode: "upload",
      deleteOrphans: true,
    });
    expect(plan).toEqual([
      { relPath: "remote-only.txt", action: "delete-remote", size: 10, detail: "only on remote" },
    ]);
  });

  it("deletes the local-only file in download mode when deleteOrphans is enabled", () => {
    const plan = computeSyncPlan([file("local-only.txt", 10, 1000)], [], {
      mode: "download",
      deleteOrphans: true,
    });
    expect(plan).toEqual([
      { relPath: "local-only.txt", action: "delete-local", size: 10, detail: "only on local" },
    ]);
  });

  it("propagates unambiguous only-local/only-remote files in both directions for two-way", () => {
    const plan = computeSyncPlan(
      [file("local-only.txt", 10, 1000)],
      [file("remote-only.txt", 20, 2000)],
      { mode: "two-way", deleteOrphans: false },
    );
    expect(plan).toEqual([
      { relPath: "local-only.txt", action: "upload", size: 10, detail: "only on local" },
      { relPath: "remote-only.txt", action: "download", size: 20, detail: "only on remote" },
    ]);
  });

  it("flags a both-sides-differ file as a conflict in two-way mode, regardless of which mtime is newer", () => {
    const localNewer = computeSyncPlan(
      [file("a.txt", 20, 5000)],
      [file("a.txt", 10, 1000)],
      { mode: "two-way", deleteOrphans: false },
    );
    expect(localNewer).toEqual([
      { relPath: "a.txt", action: "conflict", size: 20, detail: "changed on both sides" },
    ]);

    const remoteNewer = computeSyncPlan(
      [file("a.txt", 10, 1000)],
      [file("a.txt", 20, 5000)],
      { mode: "two-way", deleteOrphans: false },
    );
    expect(remoteNewer).toEqual([
      { relPath: "a.txt", action: "conflict", size: 10, detail: "changed on both sides" },
    ]);
  });

  it("ignores deleteOrphans entirely in two-way mode — two-way never deletes", () => {
    const plan = computeSyncPlan(
      [file("local-only.txt", 10, 1000)],
      [file("remote-only.txt", 20, 2000)],
      { mode: "two-way", deleteOrphans: true },
    );
    expect(plan.every((entry) => entry.action !== "delete-local" && entry.action !== "delete-remote")).toBe(true);
  });

  it("sorts the plan by relPath for a stable, predictable preview order", () => {
    const plan = computeSyncPlan(
      [file("z.txt", 1, 1000), file("a.txt", 1, 1000)],
      [],
      { mode: "upload", deleteOrphans: false },
    );
    expect(plan.map((e) => e.relPath)).toEqual(["a.txt", "z.txt"]);
  });
});
