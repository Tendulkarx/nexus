import { describe, it, expect } from "vitest";

import { canSplit, closePane, MAX_PANES, singlePane, splitPane } from "./terminal-layout.js";

describe("splitPane", () => {
  it("adds the new pane after the active one, focuses it, and takes the first split's direction", () => {
    let layout = splitPane(singlePane("a"), "vertical", "b");
    expect(layout).toEqual({ panes: ["a", "b"], direction: "vertical", active: "b" });

    layout = splitPane({ ...layout, active: "a" }, "vertical", "c");
    expect(layout.panes).toEqual(["a", "c", "b"]);
    expect(layout.active).toBe("c");
  });

  it("refuses the other direction once split, and stops at the pane limit", () => {
    const split = splitPane(singlePane("a"), "horizontal", "b");
    expect(canSplit(split, "vertical")).toBe(false);
    expect(splitPane(split, "vertical", "x")).toBe(split);

    let full = singlePane("p0");
    for (let i = 1; i < MAX_PANES; i++) full = splitPane(full, "horizontal", `p${i}`);
    expect(full.panes).toHaveLength(MAX_PANES);
    expect(canSplit(full, "horizontal")).toBe(false);
  });
});

describe("closePane", () => {
  const layout = { panes: ["a", "b", "c"], direction: "horizontal" as const, active: "b" };

  it("focuses the next pane (or the previous one at the end) when the active pane closes", () => {
    expect(closePane(layout, "b")).toEqual({ ...layout, panes: ["a", "c"], active: "c" });
    expect(closePane({ ...layout, active: "c" }, "c")?.active).toBe("b");
  });

  it("keeps focus when another pane closes, and returns null for the last pane", () => {
    expect(closePane(layout, "a")?.active).toBe("b");
    expect(closePane(singlePane("only"), "only")).toBeNull();
    expect(closePane(layout, "missing")).toBe(layout);
  });
});
