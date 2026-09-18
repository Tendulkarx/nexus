/**
 * IPC handlers for interactive terminals. open/resize/close are invoke calls;
 * keystrokes arrive fire-and-forget on terminal:input; output streams back via
 * terminal:data events (see SshTerminalService).
 */
import { ipcMain } from "electron";

import { asRecord, reqNumber, reqString } from "./validate.js";
import { sshTerminalService } from "../services/ssh-terminal-service.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC.terminal.open, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "terminal:open");
    const terminalId = await sshTerminalService.open(
      reqString(obj, "sessionId", "terminal:open"),
      reqNumber(obj, "cols", "terminal:open"),
      reqNumber(obj, "rows", "terminal:open"),
    );
    return { terminalId };
  });

  ipcMain.handle(IPC.terminal.resize, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "terminal:resize");
    sshTerminalService.resize(
      reqString(obj, "terminalId", "terminal:resize"),
      reqNumber(obj, "cols", "terminal:resize"),
      reqNumber(obj, "rows", "terminal:resize"),
    );
    return { ok: true as const };
  });

  ipcMain.handle(IPC.terminal.close, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "terminal:close");
    sshTerminalService.close(reqString(obj, "terminalId", "terminal:close"));
    return { ok: true as const };
  });

  // Fire-and-forget keystrokes from the renderer. `data` may be any string
  // (including control sequences), so it is validated as a plain string here.
  ipcMain.on(IPC.terminal.input, (_e, payload: unknown) => {
    try {
      const obj = asRecord(payload, "terminal:input");
      const data = obj.data;
      if (typeof data !== "string") return;
      sshTerminalService.input(reqString(obj, "terminalId", "terminal:input"), data);
    } catch {
      // Ignore malformed input frames.
    }
  });
}
