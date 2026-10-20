import { describe, it, expect } from "vitest";

import { parseToolTab, toolTabId, TOOL_IDS } from "./tool-tabs.js";

describe("tool tab ids", () => {
  it("round-trips every tool", () => {
    for (const id of TOOL_IDS) expect(parseToolTab(toolTabId(id))).toBe(id);
  });

  it("ignores session ids, the connections view and unknown tools", () => {
    expect(parseToolTab("connections")).toBeNull();
    expect(parseToolTab("3f2b9c1e-0000-4000-8000-000000000000")).toBeNull();
    expect(parseToolTab("tool:unknown")).toBeNull();
  });
});
