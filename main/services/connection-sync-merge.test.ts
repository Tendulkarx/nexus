import { describe, it, expect } from "vitest";

import { mergeConnectionSyncRecords, type SyncRecord } from "./connection-sync-merge.js";

function rec(id: string, updatedAt: number, opts: { name?: string; deleted?: boolean; data?: string } = {}): SyncRecord<string> {
  return {
    id,
    name: opts.name ?? id,
    updatedAt,
    deleted: opts.deleted ?? false,
    data: opts.deleted ? null : (opts.data ?? `${id}@${updatedAt}`),
  };
}

function map(...records: SyncRecord<string>[]): Map<string, SyncRecord<string>> {
  return new Map(records.map((r) => [r.id, r]));
}

describe("mergeConnectionSyncRecords", () => {
  it("keeps a record unchanged when neither side has moved from the baseline", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 100));
    const remote = map(rec("a", 100));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("a")).toEqual(rec("a", 100));
    expect(conflicts).toEqual([]);
  });

  it("takes the local edit when only local changed since the baseline", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 200, { data: "edited-locally" }));
    const remote = map(rec("a", 100));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("a")?.data).toBe("edited-locally");
    expect(resolved.get("a")?.updatedAt).toBe(200);
    expect(conflicts).toEqual([]);
  });

  it("takes the remote edit when only remote changed since the baseline (never rolls a fresh local record back)", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 100));
    const remote = map(rec("a", 300, { data: "edited-remotely" }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("a")?.data).toBe("edited-remotely");
    expect(conflicts).toEqual([]);
  });

  it("flags a genuine conflict when both sides edited differently since the baseline, and resolves it by the newer updatedAt (local newer)", () => {
    const baseline = map(rec("a", 100, { name: "prod-server" }));
    const local = map(rec("a", 500, { name: "prod-server", data: "local-edit" }));
    const remote = map(rec("a", 250, { name: "prod-server", data: "remote-edit" }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toEqual([{ id: "a", name: "prod-server" }]);
    expect(resolved.get("a")?.data).toBe("local-edit");
    expect(resolved.get("a")?.updatedAt).toBe(500);
  });

  it("flags a genuine conflict and resolves it in favor of the remote side when remote is newer", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 250, { data: "local-edit" }));
    const remote = map(rec("a", 500, { data: "remote-edit" }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toHaveLength(1);
    expect(resolved.get("a")?.data).toBe("remote-edit");
  });

  it("does not flag a conflict when both sides independently made the identical edit", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 300, { data: "same-edit" }));
    const remote = map(rec("a", 300, { data: "same-edit" }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toEqual([]);
    expect(resolved.get("a")?.data).toBe("same-edit");
  });

  it("propagates a local deletion to the merged result when remote is unchanged", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 400, { deleted: true }));
    const remote = map(rec("a", 100));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("a")?.deleted).toBe(true);
    expect(conflicts).toEqual([]);
  });

  it("propagates a remote deletion to the merged result when local is unchanged", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 100));
    const remote = map(rec("a", 400, { deleted: true }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("a")?.deleted).toBe(true);
    expect(conflicts).toEqual([]);
  });

  it("flags a conflict between a local edit and a remote deletion, keeping the edit when it's newer than the deletion", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 600, { data: "edited-after-remote-delete" }));
    const remote = map(rec("a", 300, { deleted: true }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toHaveLength(1);
    expect(resolved.get("a")?.deleted).toBe(false);
    expect(resolved.get("a")?.data).toBe("edited-after-remote-delete");
  });

  it("flags a conflict between a local edit and a remote deletion, applying the deletion when it's newer than the edit", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 300, { data: "stale-local-edit" }));
    const remote = map(rec("a", 600, { deleted: true }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toHaveLength(1);
    expect(resolved.get("a")?.deleted).toBe(true);
  });

  it("does not flag a conflict when both sides deleted the same record", () => {
    const baseline = map(rec("a", 100));
    const local = map(rec("a", 300, { deleted: true }));
    const remote = map(rec("a", 350, { deleted: true }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(conflicts).toEqual([]);
    expect(resolved.get("a")?.deleted).toBe(true);
  });

  it("carries a brand-new local-only record (no baseline) into the merge without a false conflict", () => {
    const baseline = map();
    const local = map(rec("new-local", 100, { data: "created-on-this-device" }));
    const remote = map();

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("new-local")?.data).toBe("created-on-this-device");
    expect(conflicts).toEqual([]);
  });

  it("carries a brand-new remote-only record (no baseline) into the merge without a false conflict", () => {
    const baseline = map();
    const local = map();
    const remote = map(rec("new-remote", 100, { data: "created-on-other-device" }));

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("new-remote")?.data).toBe("created-on-other-device");
    expect(conflicts).toEqual([]);
  });

  it("handles a mixed batch of independent ids correctly in one call", () => {
    const baseline = map(rec("unchanged", 100), rec("local-only-edit", 100), rec("conflict", 100));
    const local = map(
      rec("unchanged", 100),
      rec("local-only-edit", 200, { data: "local-change" }),
      rec("conflict", 900, { data: "local-wins" }),
      rec("brand-new-local", 50, { data: "fresh" }),
    );
    const remote = map(
      rec("unchanged", 100),
      rec("local-only-edit", 100),
      rec("conflict", 300, { data: "remote-loses" }),
    );

    const { resolved, conflicts } = mergeConnectionSyncRecords(baseline, local, remote);

    expect(resolved.get("unchanged")?.data).toBe("unchanged@100");
    expect(resolved.get("local-only-edit")?.data).toBe("local-change");
    expect(resolved.get("conflict")?.data).toBe("local-wins");
    expect(resolved.get("brand-new-local")?.data).toBe("fresh");
    expect(conflicts).toEqual([{ id: "conflict", name: "conflict" }]);
  });
});
