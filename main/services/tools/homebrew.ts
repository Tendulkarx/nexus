/**
 * Homebrew tool tab: lists installed and outdated packages, searches, and
 * runs install / upgrade / uninstall with live output. Everything goes through
 * the user's own `brew` (never a shell): package names are checked against
 * BREW_NAME so a name can't become an option, and each job streams its output
 * as tools:brew:output events, ending with exactly one tools:brew:done.
 *
 * Apps opened from Finder don't have Homebrew on PATH, so the binary is looked
 * for in its two standard prefixes.
 */
import { execFile, spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

import { logger } from "../../logger.js";
import { emitToRenderer } from "../ipc-emitter.js";

import { IPC } from "../../../renderer/shared/ipc-contract.js";
import type {
  BrewAction,
  BrewDoneEvent,
  BrewKind,
  BrewOutputEvent,
  BrewPackage,
  BrewStatus,
} from "@shared/ipc-contract";

const execFileAsync = promisify(execFile);

const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
/** Formula, cask or tap-qualified name ("user/tap/name", "python@3.13"); never starts with "-". */
export const BREW_NAME = /^[A-Za-z0-9][A-Za-z0-9@+._-]*(?:\/[A-Za-z0-9@+._-]+){0,2}$/;
const SEARCH_QUERY = /^[A-Za-z0-9][A-Za-z0-9@+._ -]{0,59}$/;
/** Search results looked up with `brew info` for a description and version. */
const SEARCH_DETAIL_LIMIT = 30;

export async function findBrew(): Promise<string | null> {
  for (const candidate of BREW_CANDIDATES) {
    if (
      await fs.access(candidate, fs.constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return null;
}

/** brew's environment: no auto-update on every call, no hints, no prompts, and its own bin on PATH. */
function brewEnv(brew: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${path.dirname(brew)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOMEBREW_NO_AUTO_UPDATE: "1",
    HOMEBREW_NO_ENV_HINTS: "1",
    HOMEBREW_NO_INSTALL_CLEANUP: "1",
    NONINTERACTIVE: "1",
    HOMEBREW_NO_COLOR: "1",
  };
}

async function runBrew(brew: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(brew, args, { env: brewEnv(brew), maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

interface BrewInfoJson {
  formulae?: {
    name: string;
    full_name?: string;
    desc?: string | null;
    versions?: { stable?: string | null };
    installed?: { version: string; installed_on_request?: boolean }[];
    outdated?: boolean;
    pinned?: boolean;
  }[];
  casks?: {
    token: string;
    full_token?: string;
    name?: string[];
    desc?: string | null;
    version?: string;
    installed?: string | null;
    outdated?: boolean;
  }[];
}

/** Maps `brew info --json=v2` output to the tab's rows. Pure, for tests. */
export function parseBrewInfo(json: BrewInfoJson): BrewPackage[] {
  const formulae: BrewPackage[] = (json.formulae ?? []).map((f) => {
    const installed = f.installed?.[f.installed.length - 1];
    return {
      name: f.full_name ?? f.name,
      kind: "formula",
      description: f.desc ?? "",
      installedVersion: installed?.version ?? null,
      latestVersion: f.versions?.stable ?? null,
      outdated: Boolean(f.outdated),
      // A formula installed only because something needs it.
      dependency: installed ? installed.installed_on_request === false : false,
      pinned: Boolean(f.pinned),
    };
  });
  const casks: BrewPackage[] = (json.casks ?? []).map((c) => ({
    name: c.full_token ?? c.token,
    kind: "cask",
    description: c.desc ?? c.name?.[0] ?? "",
    installedVersion: c.installed ?? null,
    latestVersion: c.version ?? null,
    outdated: Boolean(c.outdated),
    dependency: false,
    pinned: false,
  }));
  return [...formulae, ...casks].sort((a, b) => a.name.localeCompare(b.name));
}

/** Names from `brew search` output (one per line when piped; "==>" headers and blank lines skipped). */
export function parseSearchOutput(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("==>") && BREW_NAME.test(l));
}

export class HomebrewService {
  private jobs = new Map<string, ChildProcess>();

  /** `locate` is swappable so tests can run jobs against a stand-in brew script. */
  constructor(private readonly locate: () => Promise<string | null> = findBrew) {}

  async status(): Promise<BrewStatus> {
    const brew = await this.locate();
    if (!brew) return { installed: false, path: null, version: null };
    const version = (await runBrew(brew, ["--version"]).catch(() => "")).split("\n")[0].replace(/^Homebrew /, "");
    return { installed: true, path: brew, version: version || null };
  }

  private async requireBrew(): Promise<string> {
    const brew = await this.locate();
    if (!brew) throw new Error("Homebrew isn't installed. Get it from brew.sh.");
    return brew;
  }

  async listInstalled(): Promise<BrewPackage[]> {
    const brew = await this.requireBrew();
    return parseBrewInfo(JSON.parse(await runBrew(brew, ["info", "--json=v2", "--installed"])) as BrewInfoJson);
  }

  async search(query: string): Promise<BrewPackage[]> {
    const q = query.trim();
    if (!SEARCH_QUERY.test(q)) throw new Error("Search for a package name: letters, numbers, and . _ - @ +");
    const brew = await this.requireBrew();
    // brew search exits 1 when nothing matches; that's an empty list, not an error.
    const names = async (kind: "--formula" | "--cask") =>
      parseSearchOutput(await runBrew(brew, ["search", kind, q]).catch(() => ""));
    const [formulae, casks] = await Promise.all([names("--formula"), names("--cask")]);

    const info = async (kind: "--formula" | "--cask", list: string[]): Promise<BrewPackage[]> => {
      if (list.length === 0) return [];
      try {
        return parseBrewInfo(JSON.parse(await runBrew(brew, ["info", "--json=v2", kind, ...list])) as BrewInfoJson);
      } catch (err) {
        // One unreadable result (a tap that's gone) fails the whole call: fall back to bare names.
        logger.warn("homebrew", "brew info failed for search results", { message: (err as Error).message });
        const k: BrewKind = kind === "--cask" ? "cask" : "formula";
        return list.map((name) => ({
          name,
          kind: k,
          description: "",
          installedVersion: null,
          latestVersion: null,
          outdated: false,
          dependency: false,
          pinned: false,
        }));
      }
    };
    // Exact match first, then brew's own order.
    const rank = (n: string) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
    const top = [
      ...formulae.map((n) => ({ n, k: "--formula" as const })),
      ...casks.map((n) => ({ n, k: "--cask" as const })),
    ]
      .sort((a, b) => rank(a.n) - rank(b.n))
      .slice(0, SEARCH_DETAIL_LIMIT);
    const [f, c] = await Promise.all([
      info(
        "--formula",
        top.filter((t) => t.k === "--formula").map((t) => t.n),
      ),
      info(
        "--cask",
        top.filter((t) => t.k === "--cask").map((t) => t.n),
      ),
    ]);
    return [...f, ...c].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }

  /**
   * Starts `brew <action> [--cask] <names…>`; `upgrade` with no names upgrades
   * everything outdated. Returns at once with the job id; output follows as events.
   */
  async start(action: BrewAction, kind: BrewKind, names: string[]): Promise<string> {
    if (names.some((n) => !BREW_NAME.test(n))) throw new Error("Invalid package name");
    if (names.length === 0 && action !== "upgrade") throw new Error(`Choose a package to ${action}`);
    const brew = await this.requireBrew();
    const args = [action, ...(kind === "cask" && names.length > 0 ? ["--cask"] : []), ...names];
    const jobId = randomUUID();
    const child = spawn(brew, args, { env: brewEnv(brew), stdio: ["ignore", "pipe", "pipe"] });
    this.jobs.set(jobId, child);
    logger.info("homebrew", "Started", { jobId, args });

    const output = (chunk: Buffer) =>
      emitToRenderer(IPC.tools.brewOutput, { jobId, chunk: chunk.toString("utf-8") } satisfies BrewOutputEvent);
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    let finished = false;
    const done = (code: number | null, error?: string) => {
      if (finished) return;
      finished = true;
      this.jobs.delete(jobId);
      emitToRenderer(IPC.tools.brewDone, { jobId, code, error } satisfies BrewDoneEvent);
    };
    child.on("error", (err) => done(null, err.message));
    child.on("close", (code) => done(code));
    return jobId;
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.kill("SIGINT");
  }

  cancelAll(): void {
    for (const child of this.jobs.values()) child.kill("SIGINT");
    this.jobs.clear();
  }
}

export const homebrewService = new HomebrewService();
