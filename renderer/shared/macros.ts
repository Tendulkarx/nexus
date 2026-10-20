/**
 * Terminal macros: keystrokes recorded in a terminal and replayed later, with
 * the pauses between them, so a macro can wait for a prompt the way you did
 * (a sudo password, a confirmation). Stored on a CommandSnippet's `macro`
 * field; shared by main (validation) and renderer (recording, playback).
 */

export interface MacroStep {
  /** Exactly what was typed: control characters and escape sequences included. */
  data: string;
  /** Pause before sending `data`. */
  delayMs: number;
}

export const MACRO_LIMITS = { steps: 2000, stepChars: 4096, delayMs: 5000 } as const;

/** Keystrokes closer together than this are merged into one step (typing, not waiting). */
const MERGE_GAP_MS = 150;

/** Collects one terminal's input while recording. */
export class MacroRecorder {
  private readonly recorded: MacroStep[] = [];
  private last: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  add(data: string): void {
    const t = this.now();
    const gap = this.last === null ? 0 : t - this.last;
    this.last = t;
    const prev = this.recorded[this.recorded.length - 1];
    if (prev && gap < MERGE_GAP_MS && prev.data.length + data.length <= MACRO_LIMITS.stepChars) {
      prev.data += data;
      return;
    }
    if (this.recorded.length >= MACRO_LIMITS.steps) return;
    this.recorded.push({ data, delayMs: Math.min(gap, MACRO_LIMITS.delayMs) });
  }

  get steps(): MacroStep[] {
    return this.recorded.map((s) => ({ ...s }));
  }
}

/** Readable text for a macro: what was typed, with Enter as ⏎ and other control keys as ^X. */
export function describeMacro(steps: MacroStep[]): string {
  /* eslint-disable no-control-regex -- matching control characters is the point here */
  return steps
    .map((s) => s.data)
    .join("")
    .replace(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]/g, "")
    .replace(/\r/g, "⏎ ")
    .replace(/\x7f/g, "⌫")
    .replace(/[\x00-\x1f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`)
    .trim();
  /* eslint-enable no-control-regex */
}

/** Validates steps from disk or IPC: drops malformed ones and clamps sizes. */
export function normalizeMacro(value: unknown): MacroStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps = value
    .filter(
      (s): s is { data: string; delayMs: unknown } =>
        typeof s === "object" && s !== null && typeof (s as { data?: unknown }).data === "string",
    )
    .map((s) => ({
      data: s.data.slice(0, MACRO_LIMITS.stepChars),
      delayMs:
        typeof s.delayMs === "number" && Number.isFinite(s.delayMs)
          ? Math.min(MACRO_LIMITS.delayMs, Math.max(0, Math.round(s.delayMs)))
          : 0,
    }))
    .filter((s) => s.data.length > 0)
    .slice(0, MACRO_LIMITS.steps);
  return steps.length > 0 ? steps : null;
}

/** Sends each step after its pause. Resolves when done; `signal` stops it part-way. */
export async function playMacro(
  steps: MacroStep[],
  send: (data: string) => void,
  signal?: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (const step of steps) {
    if (step.delayMs > 0) await sleep(step.delayMs);
    if (signal?.aborted) return;
    send(step.data);
  }
}
