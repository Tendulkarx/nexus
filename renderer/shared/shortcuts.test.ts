import { describe, it, expect } from "vitest";

import {
  acceleratorFromEvent,
  canonicalAccelerator,
  conflictingActions,
  DEFAULT_SHORTCUTS,
  eventMatches,
  formatAccelerator,
  isValidAccelerator,
  normalizeShortcuts,
} from "./shortcuts.js";

const key = (
  k: string,
  code: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("accelerators", () => {
  it("accepts shortcuts with a real modifier, function keys, and empty", () => {
    expect(isValidAccelerator("CommandOrControl+K")).toBe(true);
    expect(isValidAccelerator("Control+Alt+Left")).toBe(true);
    expect(isValidAccelerator("F5")).toBe(true);
    expect(isValidAccelerator("")).toBe(true);
    expect(isValidAccelerator("K")).toBe(false);
    expect(isValidAccelerator("Shift+K")).toBe(false);
    expect(isValidAccelerator("Hyper+K")).toBe(false);
    expect(isValidAccelerator("CommandOrControl+CommandOrControl+K")).toBe(false);
  });

  it("orders modifiers the macOS way and shows them as symbols", () => {
    expect(canonicalAccelerator("CommandOrControl+Shift+D")).toBe("Shift+CommandOrControl+D");
    expect(formatAccelerator("CommandOrControl+Shift+D")).toBe("⇧⌘D");
    expect(formatAccelerator("Control+Alt+Left")).toBe("⌃⌥←");
    expect(formatAccelerator("CommandOrControl+,")).toBe("⌘,");
  });

  it("reads a key press, using the physical key so Option and Shift don't change the letter", () => {
    expect(acceleratorFromEvent(key("k", "KeyK", { metaKey: true }))).toBe("CommandOrControl+K");
    expect(acceleratorFromEvent(key("D", "KeyD", { metaKey: true, shiftKey: true }))).toBe("Shift+CommandOrControl+D");
    expect(acceleratorFromEvent(key("∂", "KeyD", { altKey: true, metaKey: true }))).toBe("Alt+CommandOrControl+D");
    expect(acceleratorFromEvent(key("Meta", "MetaLeft", { metaKey: true }))).toBeNull();
  });

  it("matches events against stored shortcuts in any modifier order", () => {
    expect(eventMatches(key("d", "KeyD", { metaKey: true, shiftKey: true }), "CommandOrControl+Shift+D")).toBe(true);
    expect(eventMatches(key("d", "KeyD", { metaKey: true }), "CommandOrControl+Shift+D")).toBe(false);
    expect(eventMatches(key("k", "KeyK", { metaKey: true }), "")).toBe(false);
  });
});

describe("normalizeShortcuts", () => {
  it("keeps valid entries, canonicalises them, and falls back per action", () => {
    const s = normalizeShortcuts({ palette: "Shift+CommandOrControl+P", splitRight: "D", closeTab: "", extra: "F1" });
    expect(s.palette).toBe("Shift+CommandOrControl+P");
    expect(s.splitRight).toBe(DEFAULT_SHORTCUTS.splitRight);
    expect(s.closeTab).toBe("");
    expect(s).not.toHaveProperty("extra");
  });

  it("flags actions sharing a shortcut", () => {
    const s = normalizeShortcuts({ newSession: "CommandOrControl+K" });
    expect([...conflictingActions(s)].sort()).toEqual(["newSession", "palette"]);
    expect(conflictingActions(DEFAULT_SHORTCUTS).size).toBe(0);
  });
});
