/**
 * IPC handlers for per-session SSH port-forwarding rules. See PortForwardManager
 * — dynamic (SOCKS) forwarding is not implemented yet, start() rejects it.
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqNumber, reqString } from "./validate.js";
import { portForwardManager } from "../services/port-forward-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { PortForwardStartRequest, PortForwardType } from "@shared/ipc-contract";

const FORWARD_TYPES: PortForwardType[] = ["local", "remote", "dynamic"];

export function registerPortForwardHandlers(): void {
  ipcMain.handle(IPC.portForward.start, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "portForward:start");
    const type = reqString(obj, "type", "portForward:start") as PortForwardType;
    if (!FORWARD_TYPES.includes(type)) {
      throw new Error(`portForward:start: invalid type "${type}"`);
    }
    const request: PortForwardStartRequest = {
      sessionId: reqString(obj, "sessionId", "portForward:start"),
      type,
      srcHost: optString(obj, "srcHost"),
      srcPort: reqNumber(obj, "srcPort", "portForward:start"),
      dstHost: optString(obj, "dstHost"),
      dstPort: typeof obj.dstPort === "number" ? obj.dstPort : undefined,
    };
    return portForwardManager.start(request);
  });

  ipcMain.handle(IPC.portForward.stop, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "portForward:stop");
    await portForwardManager.stop(reqString(obj, "id", "portForward:stop"));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.portForward.list, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "portForward:list");
    return portForwardManager.list(reqString(obj, "sessionId", "portForward:list"));
  });
}
