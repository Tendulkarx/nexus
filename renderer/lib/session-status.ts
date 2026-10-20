/**
 * Live connection state per open session, for the tab and sidebar dots and
 * the workspace header. File and terminal sessions are connected when their
 * tab opens (session:connect has succeeded), so "no entry" means connected;
 * they only change on session:disconnected from main. Display sessions report
 * their own progress: RDP through display:status (subscribed here), VNC from
 * its viewer (vnc-pane.tsx calls setSessionStatus).
 */
import * as React from "react";
import type { DisplaySessionState } from "@shared/ipc-contract";

export type SessionState = "connecting" | "connected" | "disconnected";

export interface SessionStatus {
  state: SessionState;
  /** Why it disconnected, when known. */
  detail?: string;
}

const CONNECTED: SessionStatus = { state: "connected" };

/** Display-session (RDP) states mapped onto the three the UI shows. */
export function fromDisplayState(state: DisplaySessionState, message?: string): SessionStatus {
  if (state === "connecting") return { state: "connecting" };
  if (state === "connected") return { state: "connected" };
  return { state: "disconnected", detail: message };
}

/** Dot colour class and the words that go with it (colour alone isn't enough). */
export function statusAppearance(status: SessionStatus): { dotClass: string; label: string } {
  switch (status.state) {
    case "connecting":
      return { dotClass: "bg-support-yellow", label: "Connecting" };
    case "disconnected":
      return {
        dotClass: "bg-support-red",
        label: status.detail ? `Disconnected: ${status.detail}` : "Disconnected",
      };
    default:
      return { dotClass: "bg-support-green", label: "Connected" };
  }
}

let statuses = new Map<string, SessionStatus>();
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

export function setSessionStatus(sessionId: string, status: SessionStatus): void {
  const current = statuses.get(sessionId);
  if (current?.state === status.state && current.detail === status.detail) return;
  statuses = new Map(statuses).set(sessionId, status);
  emit();
}

export function clearSessionStatus(sessionId: string): void {
  if (!statuses.has(sessionId)) return;
  statuses = new Map(statuses);
  statuses.delete(sessionId);
  emit();
}

function start() {
  if (started) return;
  started = true;
  // Imported lazily so the pure helpers above stay testable without window.nexusAPI.
  void import("./ipc").then(({ ipc }) => {
    ipc.session.onDisconnected(({ sessionId, reason }) =>
      setSessionStatus(sessionId, { state: "disconnected", detail: reason }),
    );
    ipc.display.onStatus(({ sessionId, state, message }) =>
      setSessionStatus(sessionId, fromDisplayState(state, message)),
    );
  });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionStatus(sessionId: string): SessionStatus {
  return React.useSyncExternalStore(subscribe, () => statuses.get(sessionId) ?? CONNECTED);
}
