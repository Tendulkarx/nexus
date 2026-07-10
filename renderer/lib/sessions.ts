/**
 * Session store — module-level Map keyed by sessionId.
 * Populated on connect, read by workspace routes.
 */

import type { SessionInfo } from "@shared/ipc-contract";

const sessionMap = new Map<string, SessionInfo>();

export function setSession(info: SessionInfo): void {
  sessionMap.set(info.sessionId, info);
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return sessionMap.get(sessionId);
}

export function removeSession(sessionId: string): void {
  sessionMap.delete(sessionId);
}

export function getAllSessions(): SessionInfo[] {
  return Array.from(sessionMap.values());
}
