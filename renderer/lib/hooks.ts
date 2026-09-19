import { useEffect, useState } from "react";

/**
 * Keeps the `.dark` class on <html> in sync with the OS/theme-source
 * preference. Electron mirrors `nativeTheme.themeSource` overrides (set from
 * the Settings window) into each window's `prefers-color-scheme` media query
 * automatically, so listening to that query alone covers both "System" and
 * explicit Light/Dark overrides.
 */
export function useTheme(): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
}

/** Flips between light and dark, ignoring "system" (treated as whatever it currently resolves to). */
export async function toggleTheme(): Promise<void> {
  const info = await window.nexusAPI.nativeTheme.getInfo();
  await window.nexusAPI.nativeTheme.setThemeSource(info.shouldUseDarkColors ? "light" : "dark");
}

/**
 * A useState that persists to localStorage under `key`, read once on mount.
 * Storage failures (disabled/private-mode) fall back to in-memory state only.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });

  function setPersisted(next: T): void {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage unavailable — value still holds for this session.
    }
  }

  return [value, setPersisted];
}
