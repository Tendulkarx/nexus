import { describe, it, expect } from "vitest";

import { parseOsc7Cwd } from "./osc7.js";

describe("parseOsc7Cwd", () => {
  it("extracts the path from a file:// URI with a hostname", () => {
    expect(parseOsc7Cwd("file://myhost/home/user/project")).toBe("/home/user/project");
  });

  it("extracts the path when no hostname is present", () => {
    expect(parseOsc7Cwd("file:///var/www")).toBe("/var/www");
  });

  it("decodes percent-encoded characters", () => {
    expect(parseOsc7Cwd("file://myhost/home/user/my%20project")).toBe("/home/user/my project");
  });

  it("returns the root path unchanged", () => {
    expect(parseOsc7Cwd("file://myhost/")).toBe("/");
  });

  it("returns null for a non-file URI", () => {
    expect(parseOsc7Cwd("http://example.com/path")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseOsc7Cwd("not a uri")).toBeNull();
  });
});
