import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ActivityLogEntry } from "@shared/ipc-contract";

import { appendCapped } from "./activity-log.js";

function entry(id: string): ActivityLogEntry {
  return { id, timestamp: 0, type: "connect", message: id };
}

describe("appendCapped", () => {
  it("appends a new entry to an empty log", () => {
    expect(appendCapped([], entry("a"))).toEqual([entry("a")]);
  });

  it("keeps insertion order while under the cap", () => {
    const existing = [entry("a"), entry("b")];
    expect(appendCapped(existing, entry("c"), 5)).toEqual([entry("a"), entry("b"), entry("c")]);
  });

  it("drops the oldest entries once the cap is exceeded", () => {
    const existing = [entry("a"), entry("b"), entry("c")];
    expect(appendCapped(existing, entry("d"), 3)).toEqual([entry("b"), entry("c"), entry("d")]);
  });

  it("never exceeds the cap even by more than one entry over time", () => {
    let log: ActivityLogEntry[] = [];
    for (let i = 0; i < 10; i++) {
      log = appendCapped(log, entry(String(i)), 4);
    }
    expect(log.map((e) => e.id)).toEqual(["6", "7", "8", "9"]);
  });

  it("defaults to a 500-entry cap", () => {
    const existing = Array.from({ length: 500 }, (_, i) => entry(String(i)));
    const result = appendCapped(existing, entry("new"));
    expect(result).toHaveLength(500);
    expect(result[0]).toEqual(entry("1"));
    expect(result[499]).toEqual(entry("new"));
  });
});

describe("ActivityLogService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("record() appends to the persisted log and list() returns most-recent-first", async () => {
    const saved: ActivityLogEntry[][] = [];
    let loaded: ActivityLogEntry[] = [];

    vi.doMock("./data-store.js", () => ({
      DataStore: class {
        async load() {
          return loaded;
        }
        async save(data: ActivityLogEntry[]) {
          loaded = data;
          saved.push(data);
        }
      },
    }));

    const { ActivityLogService } = await import("./activity-log.js");
    const service = new ActivityLogService();

    await service.record("connect", "Connected to example.com");
    await service.record("transfer-done", "Uploaded file.txt");

    const listed = await service.list();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.message).toBe("Uploaded file.txt");
    expect(listed[1]?.message).toBe("Connected to example.com");
    expect(saved).toHaveLength(2);
  });
});
