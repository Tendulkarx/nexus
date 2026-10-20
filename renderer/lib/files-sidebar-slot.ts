/**
 * The DOM element AppShell reserves for the Files sidebar view. Each file
 * session's WorkspaceView portals its compact remote browser into it (see
 * workspace/files/remote-files-panel.tsx), so the browser keeps the
 * workspace's own transfer queue and state while appearing in the shell's
 * sidebar. Module-level store (same pattern as open-sessions-store.ts).
 */
import * as React from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ref callback for the shell's slot element; null when it unmounts. */
export function setFilesSidebarSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const l of listeners) l();
}

export function useFilesSidebarSlot(): HTMLElement | null {
  return React.useSyncExternalStore(subscribe, () => slot);
}
