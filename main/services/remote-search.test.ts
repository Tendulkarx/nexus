import { describe, it, expect, vi } from "vitest";

import { buildGrepCommand, parseGrepOutput, searchRemote } from "./remote-search.js";
import type { SshSession } from "./sessions/ssh-session.js";

describe("buildGrepCommand", () => {
  it("builds a recursive, fixed-string, binary-skipping grep piped through head", () => {
    const cmd = buildGrepCommand("/var/www", "TODO", 50);
    expect(cmd).toBe("grep -rIn -F -e 'TODO' -- '/var/www' | head -n 51");
  });

  it("single-quote-escapes a query containing single quotes", () => {
    const cmd = buildGrepCommand("/tmp", "it's broken", 10);
    expect(cmd).toContain("'it'\\''s broken'");
  });

  it("single-quote-escapes a path containing single quotes", () => {
    const cmd = buildGrepCommand("/tmp/o'brien", "x", 10);
    expect(cmd).toContain("'/tmp/o'\\''brien'");
  });

  it("a query that looks like a flag doesn't get interpreted as one (via -e)", () => {
    const cmd = buildGrepCommand("/tmp", "--recursive", 10);
    expect(cmd).toBe("grep -rIn -F -e '--recursive' -- '/tmp' | head -n 11");
  });
});

describe("parseGrepOutput", () => {
  it("parses path:line:content lines", () => {
    const stdout = "src/index.ts:12:  const x = TODO;\nsrc/other.ts:3:// TODO later\n";
    expect(parseGrepOutput(stdout)).toEqual([
      { path: "src/index.ts", line: 12, snippet: "const x = TODO;" },
      { path: "src/other.ts", line: 3, snippet: "// TODO later" },
    ]);
  });

  it("ignores blank lines and lines that don't match the format", () => {
    const stdout = "src/index.ts:12:match\n\nBinary file src/data.bin matches\n";
    expect(parseGrepOutput(stdout)).toEqual([{ path: "src/index.ts", line: 12, snippet: "match" }]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseGrepOutput("")).toEqual([]);
  });

  it("truncates an overlong snippet", () => {
    const longLine = "a".repeat(500);
    const stdout = `f.txt:1:${longLine}\n`;
    expect(parseGrepOutput(stdout)[0].snippet).toHaveLength(300);
  });

  it("handles content that itself contains colons", () => {
    const stdout = "config.yml:5:key: value: with colons\n";
    expect(parseGrepOutput(stdout)).toEqual([
      { path: "config.yml", line: 5, snippet: "key: value: with colons" },
    ]);
  });
});

function fakeSession(exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>) {
  return { exec: vi.fn(exec) } as unknown as SshSession;
}

describe("searchRemote", () => {
  it("returns no matches without running a command for a blank query", async () => {
    const exec = vi.fn();
    const session = { exec } as unknown as SshSession;
    const result = await searchRemote(session, "/tmp", "   ");
    expect(result).toEqual({ matches: [], truncated: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it("parses matches from a successful grep run and reports no truncation under the cap", async () => {
    const session = fakeSession(async () => ({
      stdout: "a.txt:1:hello world\n",
      stderr: "",
      code: 0,
    }));

    const result = await searchRemote(session, "/tmp", "hello", 10);
    expect(result).toEqual({
      matches: [{ path: "a.txt", line: 1, snippet: "hello world" }],
      truncated: false,
    });
  });

  it("treats exit code 1 (grep's 'no matches') as an empty result, not an error", async () => {
    const session = fakeSession(async () => ({ stdout: "", stderr: "", code: 1 }));
    const result = await searchRemote(session, "/tmp", "nope", 10);
    expect(result).toEqual({ matches: [], truncated: false });
  });

  it("throws on a real grep failure (exit code > 1 with no output)", async () => {
    const session = fakeSession(async () => ({
      stdout: "",
      stderr: "grep: /nope: No such file or directory",
      code: 2,
    }));
    await expect(searchRemote(session, "/nope", "x", 10)).rejects.toThrow(/No such file or directory/);
  });

  it("caps results at maxResults and reports truncated when more were found", async () => {
    const stdout = Array.from({ length: 3 }, (_, i) => `f.txt:${i + 1}:line ${i}`).join("\n") + "\n";
    const session = fakeSession(async () => ({ stdout, stderr: "", code: 0 }));

    const result = await searchRemote(session, "/tmp", "line", 2);
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
