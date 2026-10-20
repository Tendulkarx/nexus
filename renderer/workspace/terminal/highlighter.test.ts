import { describe, it, expect } from "vitest";

import { DEFAULT_HIGHLIGHT_RULES } from "@shared/preferences";

import { compileRules, findHighlights } from "./highlighter.js";

const rules = compileRules(DEFAULT_HIGHLIGHT_RULES);
const colored = (text: string) =>
  findHighlights(text, rules).map((m) => [text.slice(m.start, m.end), m.color] as const);

describe("findHighlights", () => {
  it("colours errors, warnings, successes and addresses with the default rules", () => {
    expect(colored("nginx: [warn] conflicting server name; 10.0.10.11:443 FAILED, then OK")).toEqual([
      ["FAILED", "#ff5555"],
      ["warn", "#f1fa8c"],
      ["OK", "#50fa7b"],
      ["10.0.10.11:443", "#8be9fd"],
    ]);
  });

  it("only matches whole words", () => {
    expect(colored("terrors okay tokens")).toEqual([]);
  });

  it("finds every occurrence and survives repeated calls (global regex state)", () => {
    expect(colored("error error")).toHaveLength(2);
    expect(colored("error error")).toHaveLength(2);
  });

  it("skips a rule that fails to compile", () => {
    expect(compileRules([{ pattern: "(", color: "#ffffff" }])).toEqual([]);
  });
});
