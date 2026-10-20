/**
 * Cron tool: reads and replaces a user crontab, on this Mac or over an open
 * SSH session, with `crontab -l` and `crontab -`. Parsing and editing happen
 * in the renderer (shared/crontab.ts); this side only moves text, plus the
 * machine's own clock so next-run times are in its time zone.
 *
 * Saving is guarded against lost updates: the renderer sends the text it
 * loaded, and write() refuses if the crontab has changed since (someone ran
 * crontab -e meanwhile). crontab itself rejects a file with syntax errors, and
 * that message is passed back as the error.
 */
import { spawn } from "child_process";

import { sessionManager } from "../session-manager.js";

import type { CronTarget, CronTabResult } from "@shared/ipc-contract";

/** Runs a command on the crontab's machine. Swappable so tests never touch a real crontab. */
export interface CronRunner {
  run(
    command: "list" | "install" | "clock",
    input?: string,
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
  /** Shown in messages: "this Mac" or the session's host. */
  where: string;
  user: string;
}

const REMOTE_COMMAND = { list: "crontab -l", clock: "date '+%Y-%m-%d %H:%M %Z'" } as const;

/**
 * Installs over SSH only if the whole file arrived. `crontab -` installs
 * whatever it has read when its input ends, so a connection that drops (or
 * times out) mid-save would leave a cut-off crontab; this writes to a temp
 * file first and installs it only when its size matches.
 */
export function remoteInstallCommand(text: string): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  return [
    "t=$(mktemp) || exit 1",
    'cat > "$t"',
    `if [ "$(wc -c < "$t" | tr -d ' ')" != "${bytes}" ]; then rm -f "$t"; echo "Nexus: the crontab didn't arrive in full, so nothing was changed." >&2; exit 1; fi`,
    'crontab "$t"; rc=$?; rm -f "$t"; exit $rc',
  ].join("; ");
}

function localRunner(): CronRunner {
  const args = { list: ["-l"], install: ["-"], clock: ["+%Y-%m-%d %H:%M %Z"] } as const;
  return {
    where: "this Mac",
    user: process.env.USER ?? "",
    run: (command, input) =>
      new Promise((resolve, reject) => {
        const child = spawn(command === "clock" ? "/bin/date" : "/usr/bin/crontab", [...args[command]], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
        child.on("error", reject);
        child.on("close", (code) => resolve({ stdout, stderr, code }));
        child.stdin.end(input ?? "");
      }),
  };
}

function sessionRunner(sessionId: string): CronRunner {
  const session = sessionManager.getSsh(sessionId);
  return {
    where: session.info.host,
    user: session.info.username,
    run: (command, input) =>
      session.exec(command === "install" ? remoteInstallCommand(input ?? "") : REMOTE_COMMAND[command], 20_000, input),
  };
}

export function runnerFor(target: CronTarget): CronRunner {
  return target.kind === "local" ? localRunner() : sessionRunner(target.sessionId);
}

/** "no crontab for user" is an empty crontab, not an error. */
const NO_CRONTAB = /no crontab for/i;

export async function readCrontab(runner: CronRunner): Promise<CronTabResult> {
  const [list, clock] = await Promise.all([runner.run("list"), runner.run("clock").catch(() => null)]);
  let text = list.stdout;
  if (list.code !== 0) {
    if (!NO_CRONTAB.test(list.stderr + list.stdout)) {
      const reason = (list.stderr || list.stdout).trim();
      throw new Error(
        /not found/.test(reason)
          ? `${runner.where} has no crontab command (is cron installed?)`
          : `Couldn't read the crontab on ${runner.where}: ${reason || `exit ${list.code}`}`,
      );
    }
    text = "";
  }
  return { text, clock: clock?.code === 0 ? clock.stdout.trim() : null, user: runner.user, where: runner.where };
}

/** Replaces the crontab with `text`, unless it no longer matches `expected` (what the editor loaded). */
export async function writeCrontab(runner: CronRunner, text: string, expected: string): Promise<CronTabResult> {
  const current = await readCrontab(runner);
  if (current.text !== expected) {
    throw new Error(
      `The crontab on ${runner.where} changed since you opened it. Reload to see the new version; your edits weren't saved.`,
    );
  }
  const result = await runner.run("install", text);
  if (result.code !== 0) {
    throw new Error(
      `${runner.where} rejected the crontab: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`,
    );
  }
  return readCrontab(runner);
}
