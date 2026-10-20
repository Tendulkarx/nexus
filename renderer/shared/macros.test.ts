import { describe, it, expect } from "vitest";

import { describeMacro, MacroRecorder, normalizeMacro, playMacro } from "./macros.js";

describe("MacroRecorder", () => {
  it("merges fast typing into one step and keeps pauses as delays", () => {
    let t = 1000;
    const rec = new MacroRecorder(() => t);
    for (const ch of "sudo ls\r") {
      rec.add(ch);
      t += 40;
    }
    t += 1500;
    rec.add("hunter2\r");
    t += 9000;
    rec.add("q");
    expect(rec.steps).toEqual([
      { data: "sudo ls\r", delayMs: 0 },
      { data: "hunter2\r", delayMs: 1540 },
      { data: "q", delayMs: 5000 },
    ]);
  });
});

describe("describeMacro", () => {
  it("shows Enter, Backspace and control keys, and hides arrow-key sequences", () => {
    expect(describeMacro([{ data: "ls -l\x7f\r\x1b[A\x03", delayMs: 0 }])).toBe("ls -l⌫⏎ ^C");
  });
});

describe("normalizeMacro", () => {
  it("drops bad steps, clamps delays and returns null when nothing is left", () => {
    expect(
      normalizeMacro([{ data: "a", delayMs: -5 }, { data: "b", delayMs: 99_999 }, { data: "" }, { delayMs: 3 }, "x"]),
    ).toEqual([
      { data: "a", delayMs: 0 },
      { data: "b", delayMs: 5000 },
    ]);
    expect(normalizeMacro([])).toBeNull();
    expect(normalizeMacro("nope")).toBeNull();
  });
});

describe("playMacro", () => {
  it("sends steps in order after their pauses, and stops when aborted", async () => {
    const sent: string[] = [];
    const slept: number[] = [];
    const controller = new AbortController();
    await playMacro(
      [
        { data: "a", delayMs: 0 },
        { data: "b", delayMs: 200 },
        { data: "c", delayMs: 300 },
      ],
      (d) => {
        sent.push(d);
        if (d === "b") controller.abort();
      },
      controller.signal,
      async (ms) => void slept.push(ms),
    );
    expect(sent).toEqual(["a", "b"]);
    expect(slept).toEqual([200, 300]);
  });
});
