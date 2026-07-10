/**
 * Manages interactive SSH shell channels. Server output is coalesced over a
 * short interval before being emitted to the renderer to avoid per-byte IPC.
 */
import { randomUUID } from "crypto";

import { logger } from "@glaze/core/backend";

import { emitToRenderer } from "./ipc-emitter.js";
import { sessionManager } from "./session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { TerminalDataEvent, TerminalExitEvent } from "@shared/ipc-contract";
import type { ClientChannel } from "ssh2";

const FLUSH_INTERVAL_MS = 16;

interface Terminal {
  channel: ClientChannel;
  buffer: string[];
  flushTimer: NodeJS.Timeout | null;
}

export class SshTerminalService {
  private terminals = new Map<string, Terminal>();

  async open(sessionId: string, cols: number, rows: number): Promise<string> {
    const session = sessionManager.getSsh(sessionId);
    const channel = await session.openShell(cols, rows);
    const terminalId = randomUUID();
    const term: Terminal = { channel, buffer: [], flushTimer: null };
    this.terminals.set(terminalId, term);

    const onData = (data: Buffer) => this.enqueue(terminalId, data.toString("utf-8"));
    channel.on("data", onData);
    channel.stderr?.on("data", onData);

    channel.on("close", () => this.handleExit(terminalId, null));
    channel.on("exit", (code: number | null) => this.handleExit(terminalId, code));

    logger.info("ssh-terminal", "Opened terminal", { terminalId, sessionId });
    return terminalId;
  }

  private enqueue(terminalId: string, chunk: string): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    term.buffer.push(chunk);
    if (term.flushTimer) return;
    term.flushTimer = setTimeout(() => this.flush(terminalId), FLUSH_INTERVAL_MS);
  }

  private flush(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    term.flushTimer = null;
    if (term.buffer.length === 0) return;
    const chunk = term.buffer.join("");
    term.buffer = [];
    emitToRenderer(IPC.terminal.data, { terminalId, chunk } satisfies TerminalDataEvent);
  }

  input(terminalId: string, data: string): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    term.channel.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    term.channel.setWindow(rows, cols, 0, 0);
  }

  close(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    try {
      term.channel.close();
    } catch {
      // Best-effort.
    }
  }

  private handleExit(terminalId: string, code: number | null): void {
    const term = this.terminals.get(terminalId);
    if (!term) return;
    this.flush(terminalId);
    if (term.flushTimer) clearTimeout(term.flushTimer);
    this.terminals.delete(terminalId);
    emitToRenderer(IPC.terminal.exit, { terminalId, code } satisfies TerminalExitEvent);
    logger.info("ssh-terminal", "Terminal exited", { terminalId, code });
  }

  closeAll(): void {
    for (const [id, term] of this.terminals) {
      if (term.flushTimer) clearTimeout(term.flushTimer);
      try {
        term.channel.close();
      } catch {
        // Best-effort.
      }
      this.terminals.delete(id);
    }
  }
}

export const sshTerminalService = new SshTerminalService();
