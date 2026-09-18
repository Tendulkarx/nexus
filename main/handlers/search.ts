/**
 * IPC handler for remote content search (grep) — sftp/ssh sessions only, see
 * remote-search.ts.
 */
import { ipcMain } from "electron";

import { asRecord, optNumber, reqString } from "./validate.js";
import { DEFAULT_MAX_RESULTS, searchRemote } from "../services/remote-search.js";
import { sessionManager } from "../services/session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerSearchHandlers(): void {
  ipcMain.handle(IPC.remote.search, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remote:search");
    const session = sessionManager.getSsh(reqString(obj, "sessionId", "remote:search"));
    const path = reqString(obj, "path", "remote:search");
    const query = reqString(obj, "query", "remote:search");
    const maxResults = optNumber(obj, "maxResults") ?? DEFAULT_MAX_RESULTS;
    return searchRemote(session, path, query, maxResults);
  });
}
