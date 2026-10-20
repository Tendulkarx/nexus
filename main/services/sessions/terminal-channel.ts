/**
 * The narrow shell-channel interface TerminalService needs — satisfied
 * structurally by both ssh2's ClientChannel (SshSession.openShell) and
 * MoshSession's wrapper around a locally-spawned mosh-client process.
 */
export interface TerminalChannel {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  write(data: string): unknown;
  setWindow(rows: number, cols: number, height: number, width: number): unknown;
  close(): unknown;
}

/** Anything TerminalService can open a shell channel against — SshSession, MoshSession or LocalShellSession. */
export interface TerminalCapableSession {
  openShell(cols: number, rows: number): Promise<TerminalChannel>;
  /** Command(s) to auto-type into each new shell opened on this session, one per line. */
  onConnectCommand: string | null;
  /** false skips typing the OSC 7 cwd hook into new shells; omitted means true. */
  injectShellIntegration?: boolean;
}
