/**
 * IPC handler for the cross-session activity log (see main/services/activity-log.ts).
 */
import { ipcMain } from "electron";

import { activityLog } from "../services/activity-log.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { ActivityLogListResult } from "@shared/ipc-contract";

export function registerActivityLogHandlers(): void {
  ipcMain.handle(IPC.activityLog.list, async (): Promise<ActivityLogListResult> => {
    return { entries: await activityLog.list() };
  });
}
