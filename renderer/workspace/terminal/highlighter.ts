/**
 * Highlight rules (Settings › Highlighting): colours words like "error" or
 * IP addresses in terminal output.
 *
 * Nothing in the byte stream changes. Once a line is finished (the cursor has
 * moved below it), its text is matched against the rules and each match gets
 * an xterm decoration with a foreground colour. Lines are matched as logical
 * lines, so a word wrapped across two rows still matches. The alternate
 * screen (vim, htop, less) is left alone: full-screen apps colour themselves.
 */
import type { IBufferLine, IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

import type { HighlightRule } from "@shared/preferences";

export interface CompiledRule {
  regex: RegExp;
  color: string;
}

export interface HighlightMatch {
  start: number;
  end: number;
  color: string;
}

export function compileRules(rules: HighlightRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    try {
      compiled.push({ regex: new RegExp(rule.pattern, "gi"), color: rule.color });
    } catch {
      // normalizePreferences already drops bad patterns; this only guards hand-edited files.
    }
  }
  return compiled;
}

/** Matches in `text`, as string offsets. Every rule runs; a later rule's colour wins where matches overlap. */
export function findHighlights(text: string, rules: CompiledRule[]): HighlightMatch[] {
  const matches: HighlightMatch[] = [];
  for (const { regex, color } of rules) {
    regex.lastIndex = 0;
    for (let m = regex.exec(text); m; m = regex.exec(text)) {
      if (m[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      matches.push({ start: m.index, end: m.index + m[0].length, color });
    }
  }
  return matches;
}

/** Most rows matched in one pass; a burst bigger than this (cat of a huge file) only gets its last rows coloured. */
const MAX_ROWS_PER_PASS = 2000;

interface Cell {
  row: number;
  col: number;
}

/** The text of a logical line (one row plus its wrapped continuations) and the cell each UTF-16 unit came from. */
function readLogicalLine(lines: IBufferLine[], firstRow: number): { text: string; cells: Cell[] } {
  let text = "";
  const cells: Cell[] = [];
  lines.forEach((line, i) => {
    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue; // second half of a wide character
      const chars = cell.getChars() || " ";
      text += chars;
      for (let u = 0; u < chars.length; u++) cells.push({ row: firstRow + i, col });
    }
  });
  return { text, cells };
}

export function attachHighlighter(
  term: Terminal,
  getConfig: () => { enabled: boolean; rules: CompiledRule[] },
): IDisposable & { refresh(): void } {
  /** Marks the first row not matched yet; a marker so it follows the buffer as old lines are trimmed. */
  let next: IMarker | null = null;
  const decorations = new Set<IDecoration>();
  /** One marker per decorated row, shared by that row's decorations. */
  const rowMarkers = new Set<IMarker>();
  let frame = 0;

  const cursorRow = () => term.buffer.active.baseY + term.buffer.active.cursorY;

  function decorate(row: number, col: number, width: number, color: string, markers: Map<number, IMarker>) {
    let marker = markers.get(row);
    if (!marker) {
      marker = term.registerMarker(row - cursorRow());
      markers.set(row, marker);
      rowMarkers.add(marker);
      const added = marker;
      marker.onDispose(() => rowMarkers.delete(added));
    }
    const decoration = term.registerDecoration({ marker, x: col, width, foregroundColor: color, layer: "top" });
    if (!decoration) return;
    decorations.add(decoration);
    decoration.onDispose(() => decorations.delete(decoration));
  }

  function scan() {
    frame = 0;
    const buffer = term.buffer.active;
    const { enabled, rules } = getConfig();
    if (buffer.type === "alternate" || !enabled || rules.length === 0) return;
    const end = cursorRow();
    let row = next && !next.isDisposed ? next.line : 0;
    row = Math.max(row, end - MAX_ROWS_PER_PASS, 0);
    // Start on a logical line's first row.
    while (row > 0 && buffer.getLine(row)?.isWrapped) row--;

    const markers = new Map<number, IMarker>();
    while (row < end) {
      const lines: IBufferLine[] = [];
      let r = row;
      for (let line = buffer.getLine(r); line && (r === row || line.isWrapped); line = buffer.getLine(++r))
        lines.push(line);
      // The line continues onto the cursor's row: not finished yet.
      if (r > end) break;
      const { text, cells } = readLogicalLine(lines, row);
      for (const match of findHighlights(text, rules)) {
        // Split the match into one run per row.
        let runStart = cells[match.start];
        let prev = runStart;
        for (let k = match.start + 1; k <= match.end; k++) {
          const cell = k < match.end ? cells[k] : undefined;
          if (cell && cell.row === runStart.row) {
            prev = cell;
            continue;
          }
          decorate(runStart.row, runStart.col, prev.col - runStart.col + 1, match.color, markers);
          if (cell) runStart = prev = cell;
        }
      }
      row = r;
    }
    next?.dispose();
    next = term.registerMarker(row - cursorRow());
  }

  function clear() {
    for (const d of [...decorations]) d.dispose();
    for (const m of [...rowMarkers]) m.dispose();
    next?.dispose();
    next = null;
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(scan);
  };
  const onParsed = term.onWriteParsed(schedule);

  return {
    /** Rules changed: clear every highlight and match the scrollback again. */
    refresh() {
      clear();
      schedule();
    },
    dispose() {
      onParsed.dispose();
      if (frame) cancelAnimationFrame(frame);
      clear();
    },
  };
}
