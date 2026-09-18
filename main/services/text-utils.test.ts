import { describe, it, expect } from "vitest";

import { isBinaryContent, looksLikeTextByName } from "./text-utils.js";

describe("isBinaryContent", () => {
  it("treats a buffer with a NUL byte as binary", () => {
    expect(isBinaryContent(Buffer.from([0x68, 0x69, 0x00, 0x21]))).toBe(true);
  });

  it("treats plain UTF-8 text as not binary", () => {
    expect(isBinaryContent(Buffer.from("hello, world\nsecond line\n", "utf-8"))).toBe(false);
  });

  it("treats an empty buffer as not binary", () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
  });

  it("treats a compiled binary's opening bytes (which include a NUL) as binary", () => {
    expect(isBinaryContent(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x00, 0x01, 0x00]))).toBe(true);
  });
});

describe("looksLikeTextByName", () => {
  it.each(["notes.txt", "README.md", "config.YML", "src/index.ts", "app.tsx", "styles.CSS"])(
    "accepts %s",
    (name) => {
      expect(looksLikeTextByName(name)).toBe(true);
    },
  );

  it.each(["Dockerfile", "Makefile", ".gitignore", ".editorconfig"])(
    "accepts extensionless config file %s",
    (name) => {
      expect(looksLikeTextByName(name)).toBe(true);
    },
  );

  it.each(["photo.png", "archive.zip", "binary.exe", "video.mp4"])("rejects %s", (name) => {
    expect(looksLikeTextByName(name)).toBe(false);
  });

  it("rejects a name with no extension that isn't a known config file", () => {
    expect(looksLikeTextByName("some-random-file")).toBe(false);
  });
});
