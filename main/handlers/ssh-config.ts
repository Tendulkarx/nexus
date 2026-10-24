/**
 * IPC handlers for importing connection-profile candidates from the user's
 * ~/.ssh/config or a session .ini export. Read-only — actually creating profiles from
 * the parsed hosts the user selects goes through connections:create.
 */
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { ipcMain } from "electron";

import { asRecord, reqString } from "./validate.js";
import { decodeIni, parseSessionIni } from "../services/session-ini-parser.js";
import { parseSshConfig } from "../services/ssh-config-parser.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { SessionIniParseResult, SshConfigListResult } from "@shared/ipc-contract";

export function registerSshConfigHandlers(): void {
  ipcMain.handle(IPC.sshConfig.list, async (): Promise<SshConfigListResult> => {
    let contents: string;
    try {
      contents = await readFile(join(homedir(), ".ssh", "config"), "utf-8");
    } catch {
      // No ~/.ssh/config — not an error, just nothing to import.
      return { hosts: [] };
    }
    return { hosts: parseSshConfig(contents) };
  });

  // The path comes from a file picker the user just used; the file is only read.
  ipcMain.handle(IPC.sessionImport.parseIni, async (_e, payload: unknown): Promise<SessionIniParseResult> => {
    const path = reqString(asRecord(payload, "sessionImport:parseIni"), "path", "sessionImport:parseIni");
    return { sessions: parseSessionIni(decodeIni(await readFile(path))) };
  });
}
