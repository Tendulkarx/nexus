/**
 * App preferences for this window: loaded once, kept current by the
 * preferences:changed event (sent to every window after any update), and
 * readable synchronously via usePreferences(). Until the first load finishes
 * it returns the defaults, so components never wait on it.
 */
import * as React from "react";
import { DEFAULT_PREFERENCES, type AppPreferences, type PreferencesPatch } from "@shared/preferences";
import { ipc } from "./ipc";

let current: AppPreferences = DEFAULT_PREFERENCES;
let started = false;
const listeners = new Set<() => void>();

function set(next: AppPreferences) {
  current = next;
  for (const l of listeners) l();
}

function start() {
  if (started) return;
  started = true;
  ipc.preferences.onChanged(set);
  ipc.preferences
    .get()
    .then(set)
    .catch(() => {
      // Keep the defaults; Settings shows its own error if it can't load.
    });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): AppPreferences {
  return React.useSyncExternalStore(subscribe, () => current);
}

/** Current value outside React (e.g. inside a callback). */
export function getPreferences(): AppPreferences {
  start();
  return current;
}

export async function updatePreferences(patch: PreferencesPatch): Promise<AppPreferences> {
  const next = await ipc.preferences.update({ patch });
  set(next);
  return next;
}
