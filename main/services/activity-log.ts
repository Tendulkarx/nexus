/**
 * Append-only log of notable cross-session events (connect, disconnect,
 * transfer completed/failed, sync run) across all sessions and all time.
 * Persisted via DataStore and capped at MAX_ENTRIES so it never grows
 * unbounded — oldest entries are dropped first.
 */
import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";

import type { ActivityLogEntry, ActivityLogEventType } from "@shared/ipc-contract";

const MAX_ENTRIES = 500;

/**
 * Pure append+cap step, kept separate from the store so it's trivial to unit
 * test without touching disk — see activity-log.test.ts.
 */
export function appendCapped(
  entries: ActivityLogEntry[],
  entry: ActivityLogEntry,
  max: number = MAX_ENTRIES,
): ActivityLogEntry[] {
  const next = [...entries, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

export class ActivityLogService {
  private store = new DataStore<ActivityLogEntry[]>("activity-log.json", []);

  async record(type: ActivityLogEventType, message: string, detail?: string): Promise<void> {
    const entries = await this.store.load();
    const entry: ActivityLogEntry = { id: randomUUID(), timestamp: Date.now(), type, message, detail };
    await this.store.save(appendCapped(entries, entry));
  }

  /** Most recent first. */
  async list(): Promise<ActivityLogEntry[]> {
    const entries = await this.store.load();
    return [...entries].reverse();
  }
}

export const activityLog = new ActivityLogService();
