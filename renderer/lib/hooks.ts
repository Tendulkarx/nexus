import { useEffect } from "react";

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
