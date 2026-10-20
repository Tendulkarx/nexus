/**
 * Runs the user's own iperf3 as a server (`iperf3 -s`). Nexus doesn't bundle
 * it; Homebrew's is found even though GUI apps don't inherit the shell PATH.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";

import type { RunningServer, ServerStarter } from "./types.js";

const CANDIDATES = ["/opt/homebrew/bin/iperf3", "/usr/local/bin/iperf3", "/usr/bin/iperf3"];

export async function findIperf3(): Promise<string | null> {
  const fromPath = (process.env.PATH ?? "").split(":").map((dir) => `${dir}/iperf3`);
  for (const candidate of [...CANDIDATES, ...fromPath]) {
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

export const startIperfServer: ServerStarter = async ({ config, host, log, onFatal }) => {
  const binary = await findIperf3();
  if (!binary) throw new Error("iperf3 isn't installed. Install it with: brew install iperf3");

  // --forceflush: print each interval line as it happens instead of buffering until the test ends.
  const child = spawn(binary, ["-s", "-p", String(config.port), "-B", host, "--forceflush"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stopping = false;

  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.trim();
      // Skip iperf3's dashed separators and per-interval column headers.
      if (trimmed && !/^-+$/.test(trimmed) && !trimmed.startsWith("[ ID]")) log(trimmed);
    }
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);

  // A bad port or an address in use makes iperf3 exit almost immediately; wait briefly to report that as a start failure.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`iperf3 exited straight away (code ${code}); is port ${config.port} in use?`));
    });
  });
  child.removeAllListeners("exit");
  child.on("exit", (code) => {
    if (!stopping) onFatal(new Error(`iperf3 stopped unexpectedly (code ${code})`));
  });

  const running: RunningServer = {
    stop: () =>
      new Promise<void>((resolve) => {
        stopping = true;
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
  return running;
};
