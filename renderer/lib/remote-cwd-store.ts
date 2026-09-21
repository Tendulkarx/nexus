/**
 * Last remote working directory reported by a session's terminal via OSC 7
 * shell integration (see workspace/terminal/osc7.ts + terminal-pane.tsx).
 * dual-pane-view.tsx subscribes to this to make the remote file pane follow
 * `cd`s typed in the terminal — one-directional for now, module-level store
 * (same pattern as open-sessions-store.ts) so the terminal and file panes,
 * which are siblings under WorkspaceView, don't need prop-drilling through it.
 */
import * as React from "react";

interface RemoteCwdUpdate {
  path: string;
  seq: number;
}

const cwdBySession = new Map<string, RemoteCwdUpdate>();
let nextSeq = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportRemoteCwd(sessionId: string, path: string): void {
  cwdBySession.set(sessionId, { path, seq: nextSeq++ });
  emit();
}

export function useRemoteCwd(sessionId: string): RemoteCwdUpdate | undefined {
  return React.useSyncExternalStore(subscribe, () => cwdBySession.get(sessionId));
}
