import { describe, it, expect } from "vitest";

import {
  applyPreferencesPatch,
  DEFAULT_PREFERENCES,
  expandHome,
  isUsablePattern,
  normalizePreferences,
  terminalFontStack,
} from "./preferences.js";

describe("normalizePreferences", () => {
  it("fills everything from defaults when given nothing or garbage", () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences({ terminal: [1, 2] })).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid values and replaces invalid ones with the default", () => {
    const prefs = normalizePreferences({
      terminal: { fontSize: 16, cursorStyle: "bar", cursorBlink: "yes", fontFamily: "  JetBrains Mono  " },
      sessions: { sshOpensOn: "files", keepaliveSeconds: "15" },
      remoteDesktop: { vncViewOnly: true },
      unknownSection: { x: 1 },
    });
    expect(prefs.terminal).toMatchObject({
      fontSize: 16,
      cursorStyle: "bar",
      cursorBlink: true,
      fontFamily: "JetBrains Mono",
    });
    expect(prefs.sessions).toMatchObject({ sshOpensOn: "files", keepaliveSeconds: 15 });
    expect(prefs.remoteDesktop.vncViewOnly).toBe(true);
    expect(prefs).not.toHaveProperty("unknownSection");
  });

  it("clamps numbers into range and rounds them", () => {
    const prefs = normalizePreferences({
      terminal: { fontSize: 200, lineHeight: 1.234, scrollback: 10 },
      sessions: { keepaliveSeconds: -5 },
    });
    expect(prefs.terminal.fontSize).toBe(32);
    expect(prefs.terminal.lineHeight).toBe(1.23);
    expect(prefs.terminal.scrollback).toBe(500);
    expect(prefs.sessions.keepaliveSeconds).toBe(0);
    expect(normalizePreferences({ terminal: { fontSize: Number.NaN } }).terminal.fontSize).toBe(13);
  });

  it("accepts only absolute or home-relative paths, or empty for the default", () => {
    expect(normalizePreferences({ localShell: { shell: "/opt/homebrew/bin/fish" } }).localShell.shell).toBe(
      "/opt/homebrew/bin/fish",
    );
    expect(normalizePreferences({ files: { downloadDir: "~/Desktop" } }).files.downloadDir).toBe("~/Desktop");
    expect(normalizePreferences({ localShell: { shell: "fish" } }).localShell.shell).toBe("");
    expect(normalizePreferences({ terminal: { fontFamily: "   " } }).terminal.fontFamily).toBe(
      DEFAULT_PREFERENCES.terminal.fontFamily,
    );
  });
});

describe("highlight rules", () => {
  it("keeps rules with a working pattern and a #rrggbb colour, dropping the rest", () => {
    const { rules } = normalizePreferences({
      highlight: {
        rules: [
          { pattern: "\\bdown\\b", color: "#FF0000" },
          { pattern: "(unclosed", color: "#ff0000" },
          { pattern: ".*", color: "#ff0000" },
          { pattern: "up", color: "red" },
          "nope",
        ],
      },
    }).highlight;
    expect(rules).toEqual([{ pattern: "\\bdown\\b", color: "#ff0000" }]);
  });

  it("rejects patterns that match nothing visible", () => {
    expect(isUsablePattern("")).toBe(false);
    expect(isUsablePattern("a*")).toBe(false);
    expect(isUsablePattern("error")).toBe(true);
  });

  it("a patch replaces the rule list and leaves the switch alone", () => {
    const next = applyPreferencesPatch(DEFAULT_PREFERENCES, { highlight: { rules: [] } });
    expect(next.highlight).toEqual({ enabled: true, rules: [] });
  });
});

describe("applyPreferencesPatch", () => {
  it("changes only the patched fields", () => {
    const current = normalizePreferences({ terminal: { fontSize: 15 }, sessions: { sshOpensOn: "files" } });
    const next = applyPreferencesPatch(current, { terminal: { cursorBlink: false } });
    expect(next.terminal).toMatchObject({ fontSize: 15, cursorBlink: false });
    expect(next.sessions.sshOpensOn).toBe("files");
  });

  it("ignores invalid patch values instead of resetting the current ones", () => {
    const current = normalizePreferences({ terminal: { fontSize: 18 } });
    expect(applyPreferencesPatch(current, { terminal: { fontSize: "big" } }).terminal.fontSize).toBe(18);
  });
});

describe("helpers", () => {
  it("builds a font stack and strips quotes from the name", () => {
    expect(terminalFontStack("SF Mono")).toBe("'SF Mono', Menlo, Monaco, 'Courier New', monospace");
    expect(terminalFontStack("Bad'Name")).toMatch(/^'BadName'/);
  });

  it("expands ~/ only", () => {
    expect(expandHome("~/Downloads", "/Users/me")).toBe("/Users/me/Downloads");
    expect(expandHome("/tmp", "/Users/me")).toBe("/tmp");
    expect(expandHome("", "/Users/me")).toBe("");
  });
});
