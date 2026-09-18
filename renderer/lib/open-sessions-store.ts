/**
 * Tracks which sessions are currently "open" as tabs in the app shell, and
 * which one is active. Module-level store (same pattern as lib/sessions.ts)
 * so any component can read/mutate it without prop-drilling, subscribed to
 * via useSyncExternalStore for React re-renders.
 */
import * as React from "react";

export type ActiveView = "connections" | string; // "connections" or a sessionId

interface State {
  order: string[]; // open sessionIds, in tab order
  active: ActiveView;
}

let state: State = { order: [], active: "connections" };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): State {
  return state;
}

export function addOpenSession(sessionId: string): void {
  if (!state.order.includes(sessionId)) {
    state = { ...state, order: [...state.order, sessionId] };
  }
  state = { ...state, active: sessionId };
  emit();
}

export function closeOpenSession(sessionId: string): void {
  const wasActive = state.active === sessionId;
  const idx = state.order.indexOf(sessionId);
  const order = state.order.filter((id) => id !== sessionId);
  let active = state.active;
  if (wasActive) {
    // Fall back to the neighbouring tab, or the connections view.
    const next = order[idx] ?? order[idx - 1];
    active = next ?? "connections";
  }
  state = { order, active };
  emit();
}

export function setActiveView(view: ActiveView): void {
  state = { ...state, active: view };
  emit();
}

export function useOpenSessions(): State {
  return React.useSyncExternalStore(subscribe, getSnapshot);
}
