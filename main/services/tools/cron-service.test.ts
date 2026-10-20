import { describe, it, expect, vi } from "vitest";

vi.mock("../session-manager.js", () => ({ sessionManager: {} }));

const { readCrontab, remoteInstallCommand, writeCrontab } = await import("./cron-service.js");
type Runner = Parameters<typeof readCrontab>[0];

/** A crontab held in memory, behaving like the real command. */
function fakeRunner(initial: string | null, opts: { rejectInstall?: string } = {}) {
  let tab = initial;
  const installs: string[] = [];
  const runner: Runner = {
    where: "test-host",
    user: "me",
    run: async (command, input) => {
      if (command === "clock") return { stdout: "2026-10-20 17:30 BST\n", stderr: "", code: 0 };
      if (command === "list") {
        return tab === null
          ? { stdout: "", stderr: "crontab: no crontab for me\n", code: 1 }
          : { stdout: tab, stderr: "", code: 0 };
      }
      if (opts.rejectInstall) return { stdout: "", stderr: opts.rejectInstall, code: 1 };
      installs.push(input ?? "");
      tab = input ?? "";
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, installs, set: (t: string) => (tab = t) };
}

describe("cron service", () => {
  it("reads a missing crontab as empty, with the machine's clock", async () => {
    expect(await readCrontab(fakeRunner(null).runner)).toEqual({
      text: "",
      clock: "2026-10-20 17:30 BST",
      user: "me",
      where: "test-host",
    });
  });

  it("explains a machine without cron", async () => {
    const runner: Runner = {
      where: "box",
      user: "me",
      run: async () => ({ stdout: "", stderr: "sh: crontab: not found\n", code: 127 }),
    };
    await expect(readCrontab(runner)).rejects.toThrow(/box has no crontab command/);
  });

  it("installs the new text when nothing changed meanwhile", async () => {
    const { runner, installs } = fakeRunner("0 5 * * * a.sh\n");
    const result = await writeCrontab(runner, "0 6 * * * a.sh\n", "0 5 * * * a.sh\n");
    expect(installs).toEqual(["0 6 * * * a.sh\n"]);
    expect(result.text).toBe("0 6 * * * a.sh\n");
  });

  it("refuses to overwrite a crontab someone else changed", async () => {
    const fake = fakeRunner("0 5 * * * a.sh\n");
    fake.set("0 5 * * * a.sh\n@hourly b.sh\n");
    await expect(writeCrontab(fake.runner, "", "0 5 * * * a.sh\n")).rejects.toThrow(/changed since you opened it/);
    expect(fake.installs).toEqual([]);
  });

  it("passes on crontab's own syntax error", async () => {
    const { runner } = fakeRunner("", {
      rejectInstall: '"-":1: bad minute\nerrors in crontab file, can\'t install.\n',
    });
    await expect(writeCrontab(runner, "99 * * * * x\n", "")).rejects.toThrow(/rejected the crontab: "-":1: bad minute/);
  });

  it("installs over SSH only when every byte arrived", async () => {
    const { execFileSync } = await import("child_process");
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cron-"));
    // A stand-in crontab that records what it was asked to install.
    fs.writeFileSync(path.join(dir, "crontab"), `#!/bin/sh\ncp "$1" "${dir}/installed"\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    const text = "0 5 * * * caf\u00e9.sh\n";
    const command = remoteInstallCommand(text);

    execFileSync("/bin/sh", ["-c", command], { input: text, env });
    expect(fs.readFileSync(path.join(dir, "installed"), "utf-8")).toBe(text);

    fs.rmSync(path.join(dir, "installed"));
    // The connection dropped part-way: only half the bytes arrived.
    expect(() => execFileSync("/bin/sh", ["-c", command], { input: text.slice(0, 6), env, stdio: "pipe" })).toThrow(
      /didn't arrive in full/,
    );
    expect(fs.existsSync(path.join(dir, "installed"))).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});
