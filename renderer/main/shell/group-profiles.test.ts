import { describe, it, expect } from "vitest";

import { groupProfiles } from "./group-profiles.js";
import type { ConnectionProfileDTO, Folder } from "@shared/ipc-contract";

function profile(overrides: Partial<ConnectionProfileDTO>): ConnectionProfileDTO {
  return {
    id: overrides.name ?? "p",
    name: "p",
    protocol: "ssh",
    host: "host",
    port: 22,
    username: "user",
    authType: "key",
    tags: [],
    hasSecret: false,
    ...overrides,
  };
}

const folders: Folder[] = [
  { id: "f-lab", name: "Homelab" },
  { id: "f-net", name: "Network" },
];

describe("groupProfiles", () => {
  it("groups by folder in folder order, sorted by name, with an Ungrouped bucket last", () => {
    const groups = groupProfiles(
      [
        profile({ name: "pve-02", folderId: "f-lab" }),
        profile({ name: "router", folderId: "f-net" }),
        profile({ name: "pve-01", folderId: "f-lab" }),
        profile({ name: "laptop" }),
      ],
      folders,
      "",
    );
    expect(groups.map((g) => [g.name, g.profiles.map((p) => p.name)])).toEqual([
      ["Homelab", ["pve-01", "pve-02"]],
      ["Network", ["router"]],
      ["Ungrouped", ["laptop"]],
    ]);
  });

  it("drops empty groups", () => {
    const groups = groupProfiles([profile({ name: "pve-01", folderId: "f-lab" })], folders, "");
    expect(groups.map((g) => g.name)).toEqual(["Homelab"]);
  });

  it("puts profiles whose folder no longer exists in Ungrouped", () => {
    const groups = groupProfiles([profile({ name: "orphan", folderId: "gone" })], folders, "");
    expect(groups.map((g) => g.name)).toEqual(["Ungrouped"]);
  });

  it("names the single bucket Connections when there are no folders", () => {
    const groups = groupProfiles([profile({ name: "a" })], [], "");
    expect(groups.map((g) => g.name)).toEqual(["Connections"]);
  });

  it("filters case-insensitively on name, host, username and tags", () => {
    const profiles = [
      profile({ name: "pve-01", host: "10.0.10.11" }),
      profile({ name: "nas", username: "Admin" }),
      profile({ name: "router", tags: ["Core"] }),
    ];
    const names = (filter: string) => groupProfiles(profiles, [], filter).flatMap((g) => g.profiles.map((p) => p.name));
    expect(names("10.0.10")).toEqual(["pve-01"]);
    expect(names("admin")).toEqual(["nas"]);
    expect(names("core")).toEqual(["router"]);
    expect(names("  ")).toEqual(["nas", "pve-01", "router"]);
  });
});
