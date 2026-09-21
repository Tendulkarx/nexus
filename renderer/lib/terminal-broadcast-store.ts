/**
 * Cross-session broadcast group for terminal tabs: when active, keystrokes
 * typed into any member terminal fan out to every other member — which may
 * be a tab on a totally different SSH session/server, so membership can't
 * live in TerminalTabs' local state. Module-level store (same pattern as
 * open-sessions-store.ts), keyed by terminalId (the id ipc.terminal.open()
 * returns), subscribed to via useSyncExternalStore for React re-renders.
 */
import * as React from "react";

/**
 * Pure membership transitions, kept separate from the store so they're
 * trivial to unit test without touching React — see
 * terminal-broadcast-store.test.ts.
 */
export function joinGroup(group: ReadonlySet<string>, terminalId: string): Set<string> {
  return new Set(group).add(terminalId);
}

export function leaveGroup(group: ReadonlySet<string>, terminalId: string): Set<string> {
  const next = new Set(group);
  next.delete(terminalId);
  return next;
}

export function toggleGroup(group: ReadonlySet<string>, terminalId: string): Set<string> {
  return group.has(terminalId) ? leaveGroup(group, terminalId) : joinGroup(group, terminalId);
}

/** Fan-out targets for a keystroke from `terminalId`: the whole group if it's a member, otherwise just itself. */
export function broadcastTargets(group: ReadonlySet<string>, terminalId: string): string[] {
  return group.has(terminalId) ? Array.from(group) : [terminalId];
}

let group = new Set<string>();
const listeners = new Set<() => void>();

// Warn once per app run the first time broadcast is enabled, not on every join.
let hasWarnedThisSession = false;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Set<string> {
  return group;
}

export function joinBroadcastGroup(terminalId: string): void {
  group = joinGroup(group, terminalId);
  emit();
}

export function leaveBroadcastGroup(terminalId: string): void {
  group = leaveGroup(group, terminalId);
  emit();
}

export function getBroadcastTargets(terminalId: string): string[] {
  return broadcastTargets(group, terminalId);
}

export function shouldWarnBeforeBroadcast(): boolean {
  return !hasWarnedThisSession;
}

export function acknowledgeBroadcastWarning(): void {
  hasWarnedThisSession = true;
}

export function useBroadcastGroup(): Set<string> {
  return React.useSyncExternalStore(subscribe, getSnapshot);
}

export function useIsBroadcastActive(): boolean {
  return useBroadcastGroup().size > 0;
}
