/**
 * Pure last-write-wins merge for cross-device connection-profile/folder sync.
 * No filesystem/network access, which makes it easy to unit test with
 * fabricated records — see connection-sync-merge.test.ts (mirrors how
 * sync-manager.ts separates its pure computeSyncPlan from the I/O-heavy
 * SyncManager class).
 *
 * The generic parameter T is whatever payload a live (non-deleted) record
 * carries — connection-sync-service.ts uses this for both connection
 * profiles and folders, since both need the exact same three-way
 * (baseline/local/remote) reconciliation.
 */

export interface SyncRecord<T> {
  id: string;
  /** Kept even on a tombstone (deleted: true) so conflicts can be reported by name. */
  name: string;
  updatedAt: number;
  deleted: boolean;
  /** null when deleted, or when this record is baseline-only bookkeeping (the baseline only needs to compare updatedAt/deleted, never actual content). */
  data: T | null;
}

export interface SyncConflict {
  id: string;
  name: string;
}

export interface MergeResult<T> {
  resolved: Map<string, SyncRecord<T>>;
  conflicts: SyncConflict[];
}

/**
 * Whether two records represent meaningfully different states. Two
 * tombstones always agree regardless of exact deletion timestamp — "deleted
 * on device A at t1" and "deleted on device B at t2" are the same outcome,
 * not a conflict — so only a deleted/alive disagreement or two differing
 * live `updatedAt`s count as a real difference.
 */
function differs<T>(a: SyncRecord<T>, b: SyncRecord<T>): boolean {
  if (a.deleted && b.deleted) return false;
  return a.updatedAt !== b.updatedAt || a.deleted !== b.deleted;
}

/**
 * Merges the state of every known record id across three views: `baseline`
 * (the state as of the last successful sync cycle), and the current `local`
 * and `remote` states. Resolution is last-write-wins by `updatedAt`.
 *
 * A conflict is reported — never silently dropped — whenever BOTH sides
 * moved away from the baseline in a way that doesn't agree (edited
 * differently on both devices, or edited on one and deleted on the other,
 * before either had synced the other's change). The losing side's exact
 * field values are not preserved as a separate record; see
 * connection-sync-service.ts's doc comment for why plain LWW-with-reporting
 * was chosen over duplicating the loser as a "conflicted copy".
 */
export function mergeConnectionSyncRecords<T>(
  baseline: Map<string, SyncRecord<T>>,
  local: Map<string, SyncRecord<T>>,
  remote: Map<string, SyncRecord<T>>,
): MergeResult<T> {
  const ids = new Set<string>([...baseline.keys(), ...local.keys(), ...remote.keys()]);
  const resolved = new Map<string, SyncRecord<T>>();
  const conflicts: SyncConflict[] = [];

  for (const id of ids) {
    const base = baseline.get(id);
    // A side missing this id (never seen it, or purged its own tombstone) is
    // treated as "unchanged from baseline" when a baseline exists — real
    // absence-as-deletion is represented explicitly by a `deleted: true`
    // record in `local`/`remote`, not by omission.
    const loc = local.get(id) ?? base;
    const rem = remote.get(id) ?? base;

    if (!loc && !rem) continue; // unreachable given `ids` is the union of all three maps' keys
    if (!loc) {
      resolved.set(id, rem!);
      continue;
    }
    if (!rem) {
      resolved.set(id, loc);
      continue;
    }

    const localChanged = !base || differs(base, loc);
    const remoteChanged = !base || differs(base, rem);

    if (localChanged && remoteChanged && differs(loc, rem)) {
      conflicts.push({ id, name: loc.name || rem.name });
      resolved.set(id, loc.updatedAt >= rem.updatedAt ? loc : rem);
    } else if (localChanged) {
      resolved.set(id, loc);
    } else if (remoteChanged) {
      resolved.set(id, rem);
    } else {
      resolved.set(id, loc);
    }
  }

  return { resolved, conflicts };
}
