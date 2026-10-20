/**
 * IPC handlers for the Tools tab: port and network scans (run in the
 * background, reported through tools:*:progress / tools:scan:done events)
 * and local folder comparison.
 */
import { ipcMain } from "electron";

import { asRecord, reqString } from "./validate.js";
import { compareFolders } from "../services/tools/folder-compare.js";
import { localNetworks } from "../services/tools/network-scan.js";
import { readCrontab, runnerFor, writeCrontab } from "../services/tools/cron-service.js";
import { homebrewService } from "../services/tools/homebrew.js";
import { scanService } from "../services/tools/scan-service.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { BrewAction, BrewKind, CronTarget } from "@shared/ipc-contract";

function coerceCronTarget(value: unknown, context: string): CronTarget {
  const obj = asRecord(value, context);
  if (obj.kind === "local") return { kind: "local" };
  if (obj.kind === "session") return { kind: "session", sessionId: reqString(obj, "sessionId", context) };
  throw new Error(`${context}: invalid target`);
}

const BREW_ACTIONS: BrewAction[] = ["install", "upgrade", "uninstall"];
const BREW_KINDS: BrewKind[] = ["formula", "cask"];

export function registerToolHandlers(): void {
  ipcMain.handle(IPC.tools.portScanStart, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:portScan:start");
    const timeoutMs = typeof obj.timeoutMs === "number" && obj.timeoutMs > 0 ? obj.timeoutMs : undefined;
    return scanService.startPortScan(
      reqString(obj, "host", "tools:portScan:start"),
      reqString(obj, "ports", "tools:portScan:start"),
      timeoutMs,
    );
  });

  ipcMain.handle(IPC.tools.networkScanStart, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:networkScan:start");
    return scanService.startNetworkScan(reqString(obj, "cidr", "tools:networkScan:start"));
  });

  ipcMain.handle(IPC.tools.cancelScan, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:scan:cancel");
    scanService.cancel(reqString(obj, "scanId", "tools:scan:cancel"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.tools.localNetworks, async () => localNetworks());

  ipcMain.handle(IPC.tools.cronRead, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:cron:read");
    return readCrontab(runnerFor(coerceCronTarget(obj.target, "tools:cron:read.target")));
  });

  ipcMain.handle(IPC.tools.cronWrite, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:cron:write");
    if (typeof obj.text !== "string" || typeof obj.expected !== "string") {
      throw new Error("tools:cron:write: text and expected must be strings");
    }
    return writeCrontab(runnerFor(coerceCronTarget(obj.target, "tools:cron:write.target")), obj.text, obj.expected);
  });

  ipcMain.handle(IPC.tools.brewStatus, async () => homebrewService.status());

  ipcMain.handle(IPC.tools.brewInstalled, async () => homebrewService.listInstalled());

  ipcMain.handle(IPC.tools.brewSearch, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:brew:search");
    return homebrewService.search(reqString(obj, "query", "tools:brew:search"));
  });

  ipcMain.handle(IPC.tools.brewStart, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:brew:start");
    const action = reqString(obj, "action", "tools:brew:start") as BrewAction;
    const kind = reqString(obj, "kind", "tools:brew:start") as BrewKind;
    if (!BREW_ACTIONS.includes(action)) throw new Error(`tools:brew:start: invalid action "${action}"`);
    if (!BREW_KINDS.includes(kind)) throw new Error(`tools:brew:start: invalid kind "${kind}"`);
    const names = Array.isArray(obj.names) ? obj.names.filter((n): n is string => typeof n === "string") : [];
    return { jobId: await homebrewService.start(action, kind, names) };
  });

  ipcMain.handle(IPC.tools.brewCancel, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:brew:cancel");
    homebrewService.cancel(reqString(obj, "jobId", "tools:brew:cancel"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.tools.folderCompare, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "tools:folderCompare");
    return compareFolders(
      reqString(obj, "left", "tools:folderCompare"),
      reqString(obj, "right", "tools:folderCompare"),
    );
  });
}
