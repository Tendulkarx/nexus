import { describe, it, expect } from "vitest";

import { fromDisplayState, statusAppearance } from "./session-status.js";

describe("fromDisplayState", () => {
  it("maps RDP states onto connecting / connected / disconnected", () => {
    expect(fromDisplayState("connecting")).toEqual({ state: "connecting" });
    expect(fromDisplayState("connected")).toEqual({ state: "connected" });
    expect(fromDisplayState("error", "NLA failed")).toEqual({ state: "disconnected", detail: "NLA failed" });
    expect(fromDisplayState("closed")).toEqual({ state: "disconnected", detail: undefined });
  });
});

describe("statusAppearance", () => {
  it("pairs each colour with words, including the reason when known", () => {
    expect(statusAppearance({ state: "connected" })).toEqual({ dotClass: "bg-support-green", label: "Connected" });
    expect(statusAppearance({ state: "connecting" }).label).toBe("Connecting");
    expect(statusAppearance({ state: "disconnected", detail: "Connection reset" })).toEqual({
      dotClass: "bg-support-red",
      label: "Disconnected: Connection reset",
    });
  });
});
