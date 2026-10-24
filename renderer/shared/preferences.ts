/**
 * App preferences shown in the Settings window: what they are, their
 * defaults, and the one function (normalizePreferences) that turns anything
 * read from disk or sent over IPC into a complete, valid set. Shared by main
 * (persistence, local shell, SSH) and renderer (terminal, VNC, file views).
 */

import { DEFAULT_SHORTCUTS, normalizeShortcuts, type Shortcuts } from "./shortcuts";

export type CursorStyle = "block" | "bar" | "underline";

/** Terminal output matching `pattern` (a case-insensitive regular expression) is drawn in `color` (#rrggbb). */
export interface HighlightRule {
  pattern: string;
  color: string;
}
export type SshOpensOn = "terminal" | "files";

export interface AppPreferences {
  terminal: {
    /** Primary font; the terminal falls back to Menlo, then any monospace font. */
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    /** Lines kept above the visible screen. */
    scrollback: number;
    copyOnSelect: boolean;
  };
  localShell: {
    /** Absolute path to the shell; empty means the login shell ($SHELL). */
    shell: string;
    /** Folder new local shells start in; empty means the home folder. */
    startDir: string;
  };
  sessions: {
    /** What an SSH profile shows first: its terminal or the file browser. */
    sshOpensOn: SshOpensOn;
    /** Seconds between SSH keepalives; 0 turns them off. */
    keepaliveSeconds: number;
    /** Ask before a terminal joins multi-exec (typing to several sessions). */
    warnBeforeMultiExec: boolean;
  };
  files: {
    /** Where the Files sidebar saves downloads; empty means ~/Downloads. */
    downloadDir: string;
  };
  remoteDesktop: {
    vncFitToWindow: boolean;
    vncViewOnly: boolean;
    /** Copy text copied on the remote machine to this Mac, and allow "Send clipboard". */
    vncShareClipboard: boolean;
  };
  highlight: {
    /** Colour matching words in terminal output (syntax highlighting). */
    enabled: boolean;
    /** Later rules win where two match the same text. */
    rules: HighlightRule[];
  };
  /** Electron accelerators per action; "" means none. See shared/shortcuts.ts. */
  shortcuts: Shortcuts;
}

export const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  { pattern: "\\b(?:error|errors|failed|failure|fatal|denied|refused|critical|panic)\\b", color: "#ff5555" },
  { pattern: "\\b(?:warn|warning|warnings|deprecated|timeout)\\b", color: "#f1fa8c" },
  { pattern: "\\b(?:ok|success|successful|succeeded|passed|enabled|active)\\b", color: "#50fa7b" },
  { pattern: "\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d+)?\\b", color: "#8be9fd" },
];

/** Recursive Partial, for patches sent from the Settings window. */
export type PreferencesPatch = { [K in keyof AppPreferences]?: Partial<AppPreferences[K]> };

export const DEFAULT_PREFERENCES: AppPreferences = {
  terminal: {
    fontFamily: "RobotoMono Nerd Font Mono",
    fontSize: 13,
    lineHeight: 1.2,
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 5000,
    copyOnSelect: false,
  },
  localShell: { shell: "", startDir: "" },
  sessions: { sshOpensOn: "terminal", keepaliveSeconds: 15, warnBeforeMultiExec: true },
  files: { downloadDir: "" },
  remoteDesktop: { vncFitToWindow: true, vncViewOnly: false, vncShareClipboard: true },
  highlight: { enabled: true, rules: DEFAULT_HIGHLIGHT_RULES },
  shortcuts: DEFAULT_SHORTCUTS,
};

export const PREFERENCE_LIMITS = {
  fontSize: { min: 9, max: 32 },
  lineHeight: { min: 1, max: 2 },
  scrollback: { min: 500, max: 100_000 },
  keepaliveSeconds: { min: 0, max: 300 },
  highlightRules: 50,
  highlightPattern: 200,
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number, { min, max }: { min: number; max: number }, integer = true): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = integer ? Math.round(v) : Math.round(v * 100) / 100;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

/** Trimmed string up to `max` chars; non-strings fall back. */
function str(v: unknown, fallback: string, max = 1024): string {
  return typeof v === "string" ? v.trim().slice(0, max) : fallback;
}

/** An absolute path, or "" for "use the default"; anything else falls back. */
function pathOrEmpty(v: unknown, fallback: string): string {
  const s = str(v, fallback);
  return s === "" || s.startsWith("/") || s.startsWith("~/") ? s : fallback;
}

/** A pattern that compiles as a case-insensitive regex and can't match an empty string (which would colour nothing, forever). */
export function isUsablePattern(pattern: string): boolean {
  if (!pattern || pattern.length > PREFERENCE_LIMITS.highlightPattern) return false;
  try {
    return !new RegExp(pattern, "i").test("");
  } catch {
    return false;
  }
}

function highlightRules(v: unknown, fallback: HighlightRule[]): HighlightRule[] {
  if (!Array.isArray(v)) return fallback;
  return v
    .filter((r): r is Obj => isObj(r))
    .map((r) => ({ pattern: typeof r.pattern === "string" ? r.pattern : "", color: str(r.color, "", 7).toLowerCase() }))
    .filter((r) => isUsablePattern(r.pattern) && /^#[0-9a-f]{6}$/.test(r.color))
    .slice(0, PREFERENCE_LIMITS.highlightRules);
}

/**
 * Overlays `input` (stored file, or a patch already merged onto the current
 * set) on `base`, keeping only valid values. Unknown keys are dropped.
 */
export function normalizePreferences(input: unknown, base: AppPreferences = DEFAULT_PREFERENCES): AppPreferences {
  const i = isObj(input) ? input : {};
  const t = isObj(i.terminal) ? i.terminal : {};
  const l = isObj(i.localShell) ? i.localShell : {};
  const s = isObj(i.sessions) ? i.sessions : {};
  const f = isObj(i.files) ? i.files : {};
  const r = isObj(i.remoteDesktop) ? i.remoteDesktop : {};
  const h = isObj(i.highlight) ? i.highlight : {};
  const font = str(t.fontFamily, base.terminal.fontFamily, 200);
  return {
    terminal: {
      fontFamily: font || DEFAULT_PREFERENCES.terminal.fontFamily,
      fontSize: num(t.fontSize, base.terminal.fontSize, PREFERENCE_LIMITS.fontSize),
      lineHeight: num(t.lineHeight, base.terminal.lineHeight, PREFERENCE_LIMITS.lineHeight, false),
      cursorStyle: oneOf(t.cursorStyle, ["block", "bar", "underline"] as const, base.terminal.cursorStyle),
      cursorBlink: bool(t.cursorBlink, base.terminal.cursorBlink),
      scrollback: num(t.scrollback, base.terminal.scrollback, PREFERENCE_LIMITS.scrollback),
      copyOnSelect: bool(t.copyOnSelect, base.terminal.copyOnSelect),
    },
    localShell: {
      shell: pathOrEmpty(l.shell, base.localShell.shell),
      startDir: pathOrEmpty(l.startDir, base.localShell.startDir),
    },
    sessions: {
      sshOpensOn: oneOf(s.sshOpensOn, ["terminal", "files"] as const, base.sessions.sshOpensOn),
      keepaliveSeconds: num(s.keepaliveSeconds, base.sessions.keepaliveSeconds, PREFERENCE_LIMITS.keepaliveSeconds),
      warnBeforeMultiExec: bool(s.warnBeforeMultiExec, base.sessions.warnBeforeMultiExec),
    },
    files: { downloadDir: pathOrEmpty(f.downloadDir, base.files.downloadDir) },
    remoteDesktop: {
      vncFitToWindow: bool(r.vncFitToWindow, base.remoteDesktop.vncFitToWindow),
      vncViewOnly: bool(r.vncViewOnly, base.remoteDesktop.vncViewOnly),
      vncShareClipboard: bool(r.vncShareClipboard, base.remoteDesktop.vncShareClipboard),
    },
    highlight: {
      enabled: bool(h.enabled, base.highlight.enabled),
      rules: highlightRules(h.rules, base.highlight.rules),
    },
    shortcuts: normalizeShortcuts(i.shortcuts, base.shortcuts),
  };
}

/** Applies a patch from the Settings window to the current preferences. */
export function applyPreferencesPatch(current: AppPreferences, patch: unknown): AppPreferences {
  return normalizePreferences(patch, current);
}

/** CSS font stack for xterm: the chosen font, then Menlo, then any monospace. */
export function terminalFontStack(fontFamily: string): string {
  const quoted = `'${fontFamily.replace(/'/g, "")}'`;
  return `${quoted}, Menlo, Monaco, 'Courier New', monospace`;
}

/** "~/x" → "<home>/x"; leaves absolute paths and "" alone. */
export function expandHome(p: string, home: string): string {
  return p.startsWith("~/") ? `${home}/${p.slice(2)}` : p;
}
