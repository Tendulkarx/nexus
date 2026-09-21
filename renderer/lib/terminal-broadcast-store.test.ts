import { describe, it, expect } from "vitest";

import { joinGroup, leaveGroup, toggleGroup, broadcastTargets } from "./terminal-broadcast-store.js";

describe("joinGroup", () => {
  it("adds a terminalId to an empty group", () => {
    expect(joinGroup(new Set(), "a")).toEqual(new Set(["a"]));
  });

  it("is idempotent for a terminalId already in the group", () => {
    expect(joinGroup(new Set(["a"]), "a")).toEqual(new Set(["a"]));
  });

  it("does not mutate the group passed in", () => {
    const group = new Set(["a"]);
    joinGroup(group, "b");
    expect(group).toEqual(new Set(["a"]));
  });
});

describe("leaveGroup", () => {
  it("removes a terminalId from the group", () => {
    expect(leaveGroup(new Set(["a", "b"]), "a")).toEqual(new Set(["b"]));
  });

  it("is a no-op for a terminalId not in the group", () => {
    expect(leaveGroup(new Set(["a"]), "z")).toEqual(new Set(["a"]));
  });

  it("does not mutate the group passed in", () => {
    const group = new Set(["a", "b"]);
    leaveGroup(group, "a");
    expect(group).toEqual(new Set(["a", "b"]));
  });
});

describe("toggleGroup", () => {
  it("joins a terminalId that isn't a member", () => {
    expect(toggleGroup(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("leaves a terminalId that is a member", () => {
    expect(toggleGroup(new Set(["a", "b"]), "b")).toEqual(new Set(["a"]));
  });
});

describe("broadcastTargets", () => {
  it("targets only itself when not a member of the group", () => {
    expect(broadcastTargets(new Set(["a", "b"]), "c")).toEqual(["c"]);
  });

  it("targets every member of the group when it is a member, including itself", () => {
    expect(broadcastTargets(new Set(["a", "b", "c"]), "a")).toEqual(["a", "b", "c"]);
  });

  it("targets only itself when the group has just one member", () => {
    expect(broadcastTargets(new Set(["a"]), "a")).toEqual(["a"]);
  });
});
