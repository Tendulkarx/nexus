/**
 * IPC handler for importing entries from the user's ~/.ssh/config as
 * connection-profile candidates. Read-only — actually creating profiles from
 * the parsed hosts the user selects goes through connections:create.
 */
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { ipcMain } from "electron";

import { parseSshConfig } from "../services/ssh-config-parser.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { SshConfigListResult } from "@shared/ipc-contract";

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
}
