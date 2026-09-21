import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@renderer/lib/ipc";
import type { SessionInfo } from "@shared/ipc-contract";
import { Text, Button, AlertDialog } from "@renderer/lib/ui";
import { cn } from "@renderer/lib/cn";
import { TerminalIcon, RefreshCwIcon, ListIcon, RadioTowerIcon } from "lucide-react";
import { SnippetLibraryDialog } from "./snippet-library-dialog";
import {
  useBroadcastGroup,
  joinBroadcastGroup,
  leaveBroadcastGroup,
  getBroadcastTargets,
  shouldWarnBeforeBroadcast,
  acknowledgeBroadcastWarning,
} from "@renderer/lib/terminal-broadcast-store";

interface TerminalPaneProps {
  session: SessionInfo;
  isVisible: boolean;
}

export function TerminalPane({ session, isVisible }: TerminalPaneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const terminalIdRef = React.useRef<string | null>(null);
  const offDataRef = React.useRef<(() => void) | null>(null);
  const offExitRef = React.useRef<(() => void) | null>(null);
  const [isClosed, setIsClosed] = React.useState(false);
  const [exitCode, setExitCode] = React.useState<number | null>(null);
  const [isInitializing, setIsInitializing] = React.useState(true);
  const [showSnippets, setShowSnippets] = React.useState(false);
  const [terminalId, setTerminalId] = React.useState<string | null>(null);
  const [confirmBroadcast, setConfirmBroadcast] = React.useState(false);

  const broadcastGroup = useBroadcastGroup();
  const isBroadcastMember = terminalId !== null && broadcastGroup.has(terminalId);

  const initTerminal = React.useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up any previous instance
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    if (terminalIdRef.current) {
      leaveBroadcastGroup(terminalIdRef.current);
      setTerminalId(null);
    }

    const term = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: "transparent",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(container);
    fitAddon.fit();

    const { cols, rows } = term;
    console.log("[TerminalPane:open]", { sessionId: session.sessionId, cols, rows });

    setIsInitializing(true);
    setIsClosed(false);
    setExitCode(null);

    try {
      const { terminalId: newTerminalId } = await ipc.terminal.open({
        sessionId: session.sessionId,
        cols,
        rows,
      });
      console.log("[TerminalPane:opened]", { terminalId: newTerminalId });
      terminalIdRef.current = newTerminalId;
      setTerminalId(newTerminalId);

      // Subscribe to data events
      offDataRef.current = ipc.terminal.onData(({ terminalId: tid, chunk }) => {
        if (tid === newTerminalId) term.write(chunk);
      });

      offExitRef.current = ipc.terminal.onExit(({ terminalId: tid, code }) => {
        if (tid === newTerminalId) {
          console.log("[TerminalPane:exit]", { terminalId: newTerminalId, code });
          setIsClosed(true);
          setExitCode(code);
        }
      });

      // Send user input, fanned out to the rest of the broadcast group when this terminal is a member
      term.onData((data) => {
        const id = terminalIdRef.current;
        if (!id) return;
        for (const targetId of getBroadcastTargets(id)) {
          ipc.terminal.send({ terminalId: targetId, data });
        }
      });

      setIsInitializing(false);
    } catch (err) {
      console.error("[TerminalPane:error]", err);
      setIsInitializing(false);
      setIsClosed(true);
    }
  }, [session.sessionId]);

  React.useEffect(() => {
    void initTerminal();

    return () => {
      // Cleanup on unmount
      offDataRef.current?.();
      offExitRef.current?.();
      if (terminalIdRef.current) {
        console.log("[TerminalPane:close]", { terminalId: terminalIdRef.current });
        leaveBroadcastGroup(terminalIdRef.current);
        void ipc.terminal.close({ terminalId: terminalIdRef.current }).catch(() => {});
        terminalIdRef.current = null;
      }
      termRef.current?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per mounted instance; the parent keys each tab by session id so session.sessionId never changes for a given instance
  }, []);

  // ResizeObserver -> fit + resize
  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      const fitAddon = fitAddonRef.current;
      const term = termRef.current;
      const terminalId = terminalIdRef.current;
      if (!fitAddon || !term || !terminalId) return;
      try {
        fitAddon.fit();
        const { cols, rows } = term;
        console.log("[TerminalPane:resize]", { terminalId, cols, rows });
        void ipc.terminal.resize({ terminalId, cols, rows }).catch(() => {});
      } catch {
        // fit() can throw when terminal is disposed
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Re-fit when tab becomes visible
  React.useEffect(() => {
    if (isVisible && fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
      } catch {
        // ignore
      }
    }
  }, [isVisible]);

  function handleToggleBroadcast() {
    if (!terminalId) return;
    if (isBroadcastMember) {
      leaveBroadcastGroup(terminalId);
      return;
    }
    if (shouldWarnBeforeBroadcast()) {
      setConfirmBroadcast(true);
      return;
    }
    joinBroadcastGroup(terminalId);
  }

  return (
    <div
      className={cn(
        "h-full flex flex-col bg-[#1a1a1a]",
        isBroadcastMember && "ring-2 ring-inset ring-yellow-500/70",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 shrink-0">
        <TerminalIcon className="size-3.5 text-tertiary" />
        <Text variant="small" color="secondary" className="flex-1">
          {session.username}@{session.host}
        </Text>
        {isBroadcastMember && (
          <Text variant="small" className="text-yellow-500 font-medium">
            Broadcasting to {broadcastGroup.size}
          </Text>
        )}
        {!isClosed && terminalId && (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={handleToggleBroadcast}
            aria-label={isBroadcastMember ? "Leave broadcast group" : "Join broadcast group"}
            aria-pressed={isBroadcastMember}
            className={isBroadcastMember ? "bg-yellow-500/20 hover:bg-yellow-500/30" : undefined}
          >
            <RadioTowerIcon className={cn("size-3.5", isBroadcastMember ? "text-yellow-500" : "text-tertiary")} />
          </Button>
        )}
        {!isClosed && !isInitializing && (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => setShowSnippets(true)}
            aria-label="Run a snippet"
          >
            <ListIcon className="size-3.5 text-tertiary" />
          </Button>
        )}
        {!isClosed && (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => void initTerminal()}
            aria-label="Reset terminal"
          >
            <RefreshCwIcon className="size-3.5 text-tertiary" />
          </Button>
        )}
      </div>

      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} className="absolute inset-0 p-2" />

        {isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]">
            <Text variant="small" color="tertiary">Connecting...</Text>
          </div>
        )}

        {isClosed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1a1a1a]/90">
            <Text color="secondary">
              Terminal closed{exitCode !== null ? ` (exit ${exitCode})` : ""}
            </Text>
            <Button variant="filled" size="small" onClick={() => void initTerminal()}>
              Reconnect
            </Button>
          </div>
        )}
      </div>

      <SnippetLibraryDialog
        open={showSnippets}
        onOpenChange={setShowSnippets}
        onRun={(command) => {
          if (!terminalIdRef.current) return;
          ipc.terminal.send({ terminalId: terminalIdRef.current, data: `${command}\n` });
        }}
      />

      <AlertDialog
        open={confirmBroadcast}
        onOpenChange={setConfirmBroadcast}
        title="Enable broadcast mode?"
        description="Everything you type here will be sent to every other terminal in the broadcast group too, including tabs on different servers. Double-check which servers are in the group before running anything destructive."
        confirmLabel="Enable broadcast"
        confirmVariant="destructive"
        onConfirm={() => {
          acknowledgeBroadcastWarning();
          if (terminalId) joinBroadcastGroup(terminalId);
        }}
      />
    </div>
  );
}
