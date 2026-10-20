/**
 * Editable keyboard shortcuts: the actions, their defaults, and conversions
 * between the three forms a shortcut takes. Stored and sent to main as
 * Electron accelerators ("CommandOrControl+Shift+D"), which main puts on the
 * application menu; shown as macOS symbols ("⇧⌘D"); recorded in Settings and
 * matched in the renderer from KeyboardEvents. Shared by main and renderer.
 */

export type ShortcutAction =
  "palette" | "newSession" | "newLocalShell" | "splitRight" | "splitDown" | "closeTab" | "settings";

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string }[] = [
  { id: "palette", label: "Search connections and commands" },
  { id: "newSession", label: "New session" },
  { id: "newLocalShell", label: "New local shell" },
  { id: "splitRight", label: "Split terminal right" },
  { id: "splitDown", label: "Split terminal down" },
  { id: "closeTab", label: "Close tab" },
  { id: "settings", label: "Settings" },
];

export type Shortcuts = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  palette: "CommandOrControl+K",
  newSession: "CommandOrControl+N",
  newLocalShell: "CommandOrControl+T",
  splitRight: "CommandOrControl+D",
  splitDown: "CommandOrControl+Shift+D",
  closeTab: "CommandOrControl+W",
  settings: "CommandOrControl+,",
};

/** Modifiers in the order macOS menus show them. */
const MODIFIERS = ["Control", "Alt", "Shift", "CommandOrControl"] as const;
type Modifier = (typeof MODIFIERS)[number];
const MODIFIER_SYMBOL: Record<Modifier, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", CommandOrControl: "⌘" };

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Tab: "Tab",
  " ": "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Escape",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Home: "Home",
  End: "End",
};
const KEY_SYMBOL: Record<string, string> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Tab: "⇥",
  Space: "Space",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "⎋",
  PageUp: "⇞",
  PageDown: "⇟",
  Home: "↖",
  End: "↘",
};

const KEY_PATTERN =
  /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|[,./;'[\]\\`=-]|Up|Down|Left|Right|Enter|Tab|Space|Backspace|Delete|Escape|PageUp|PageDown|Home|End)$/;

function split(accelerator: string): { modifiers: Modifier[]; key: string } | null {
  const parts = accelerator.split("+");
  // "CommandOrControl+Shift++" can't happen: "+" isn't an allowed key, so a plain split is safe.
  const key = parts.pop() ?? "";
  if (!KEY_PATTERN.test(key)) return null;
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    if (!MODIFIERS.includes(part as Modifier) || modifiers.includes(part as Modifier)) return null;
    modifiers.push(part as Modifier);
  }
  return { modifiers, key };
}

/**
 * A usable app shortcut: a known key with at least one modifier other than
 * Shift (a bare letter would stop you typing it), or a function key. "" means
 * no shortcut and is valid too.
 */
export function isValidAccelerator(accelerator: string): boolean {
  if (accelerator === "") return true;
  const parsed = split(accelerator);
  if (!parsed) return false;
  if (/^F\d+$/.test(parsed.key)) return true;
  return parsed.modifiers.some((m) => m !== "Shift");
}

/** Puts modifiers in canonical order, so equal shortcuts compare equal. */
export function canonicalAccelerator(accelerator: string): string {
  const parsed = split(accelerator);
  if (!parsed) return accelerator;
  return [...MODIFIERS.filter((m) => parsed.modifiers.includes(m)), parsed.key].join("+");
}

/** "CommandOrControl+Shift+D" → "⇧⌘D"; "" → "". */
export function formatAccelerator(accelerator: string): string {
  const parsed = split(accelerator);
  if (!parsed) return accelerator;
  const mods = MODIFIERS.filter((m) => parsed.modifiers.includes(m))
    .map((m) => MODIFIER_SYMBOL[m])
    .join("");
  return mods + (KEY_SYMBOL[parsed.key] ?? parsed.key);
}

/** The key part of a KeyboardEvent as an accelerator key, or null for a lone modifier or an unsupported key. */
function keyFromEvent(e: Pick<KeyboardEvent, "key" | "code">): string | null {
  if (NAMED_KEYS[e.key]) return NAMED_KEYS[e.key];
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  // e.code is layout-independent for letters and digits, and unaffected by Option/Shift changing e.key.
  const code = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code);
  if (code) return code[1];
  return KEY_PATTERN.test(e.key) ? e.key : null;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The accelerator a key press makes, or null while only modifiers are held. ⌘ is CommandOrControl, ⌃ is Control. */
export function acceleratorFromEvent(e: KeyEventLike): string | null {
  const key = keyFromEvent(e);
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (e.ctrlKey) modifiers.push("Control");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("CommandOrControl");
  return [...modifiers, key].join("+");
}

/** True when the key press is this shortcut. */
export function eventMatches(e: KeyEventLike, accelerator: string): boolean {
  if (!accelerator) return false;
  const pressed = acceleratorFromEvent(e);
  return pressed !== null && pressed === canonicalAccelerator(accelerator);
}

/** Keeps valid shortcuts from `input`, falling back to `base` per action. */
export function normalizeShortcuts(input: unknown, base: Shortcuts = DEFAULT_SHORTCUTS): Shortcuts {
  const i =
    typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out = { ...base };
  for (const { id } of SHORTCUT_ACTIONS) {
    const v = i[id];
    if (typeof v === "string" && isValidAccelerator(v)) out[id] = v === "" ? "" : canonicalAccelerator(v);
  }
  return out;
}

/** Actions that share a shortcut with another, for a warning in Settings. */
export function conflictingActions(shortcuts: Shortcuts): Set<ShortcutAction> {
  const byKey = new Map<string, ShortcutAction[]>();
  for (const { id } of SHORTCUT_ACTIONS) {
    const acc = shortcuts[id];
    if (!acc) continue;
    byKey.set(acc, [...(byKey.get(acc) ?? []), id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}
