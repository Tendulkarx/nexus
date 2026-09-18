import { describe, it, expect } from "vitest";

import { collectTags, matchesTagFilter } from "./tag-filter.js";

import type { ConnectionProfileDTO } from "@shared/ipc-contract";

function profile(tags: string[]): ConnectionProfileDTO {
  return {
    id: `p-${tags.join("-") || "none"}`,
    name: "Test",
    protocol: "sftp",
    host: "example.com",
    port: 22,
    username: "root",
    authType: "password",
    tags,
    hasSecret: false,
  } as ConnectionProfileDTO;
}

describe("collectTags", () => {
  it("collects distinct tags across profiles, sorted", () => {
    expect(collectTags([profile(["prod", "web"]), profile(["staging"]), profile(["prod"])])).toEqual([
      "prod",
      "staging",
      "web",
    ]);
  });

  it("returns an empty list when no profile has tags", () => {
    expect(collectTags([profile([]), profile([])])).toEqual([]);
  });
});

describe("matchesTagFilter", () => {
  it("matches everything when no tags are selected", () => {
    expect(matchesTagFilter([], [])).toBe(true);
    expect(matchesTagFilter(["prod"], [])).toBe(true);
  });

  it("matches a profile carrying any one of the selected tags (OR semantics)", () => {
    expect(matchesTagFilter(["prod", "web"], ["staging", "web"])).toBe(true);
  });

  it("excludes a profile carrying none of the selected tags", () => {
    expect(matchesTagFilter(["prod"], ["staging", "web"])).toBe(false);
  });

  it("excludes a tagless profile once any tag filter is active", () => {
    expect(matchesTagFilter([], ["prod"])).toBe(false);
  });
});
