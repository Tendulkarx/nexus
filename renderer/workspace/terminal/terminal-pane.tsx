import * as React from "react";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@renderer/lib/ipc";
import type { CommandSnippet, SessionInfo } from "@shared/ipc-contract";
import { Text, Button, AlertDialog, Dialog, Input, Field, toast } from "@renderer/lib/ui";
import { describeMacro, MacroRecorder, playMacro, type MacroStep } from "@shared/macros";
import { cn } from "@renderer/lib/cn";
import { TerminalIcon, RefreshCwIcon, ListIcon, RadioTowerIcon, XIcon, CircleIcon, SquareIcon } from "lucide-react";
import { SnippetLibraryDialog } from "./snippet-library-dialog";
import {
  useBroadcastGroup,
  joinBroadcastGroup,
  leaveBroadcastGroup,
  registerTerminal,
  unregisterTerminal,
  getBroadcastTargets,
  shouldWarnBeforeBroadcast,
  acknowledgeBroadcastWarning,
} from "@renderer/lib/terminal-broadcast-store";
import { parseOsc7Cwd } from "./osc7";
import { reportRemoteCwd } from "@renderer/lib/remote-cwd-store";
import { OB_DARK_THEME } from "./terminal-theme";
import { attachHighlighter, compileRules, type CompiledRule } from "./highlighter";
import { getPreferences, usePreferences } from "@renderer/lib/preferences";
import { terminalFontStack, type AppPreferences } from "@shared/preferences";

interface TerminalPaneProps {
  session: SessionInfo;
  isVisible: boolean;
  /** Set when this pane is one of several splits: shows a close button that removes just this pane. */
  onClose?: () => void;
}

function xtermOptions(t: AppPreferences["terminal"]) {
  return {
    fontFamily: terminalFontStack(t.fontFamily),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    cursorStyle: t.cursorStyle,
    cursorBlink: t.cursorBlink,
    scrollback: t.scrollback,
  };
}

export function TerminalPane({ session, isVisible, onClose }: TerminalPaneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const terminalIdRef = React.useRef<string | null>(null);
  const offDataRef = React.useRef<(() => void) | null>(null);
  const offExitRef = React.useRef<(() => void) | null>(null);
  const oscHandlerRef = React.useRef<IDisposable | null>(null);
  const highlighterRef = React.useRef<ReturnType<typeof attachHighlighter> | null>(null);
  const highlightRef = React.useRef<{ enabled: boolean; rules: CompiledRule[] }>({ enabled: false, rules: [] });
  const [isClosed, setIsClosed] = React.useState(false);
  const [exitCode, setExitCode] = React.useState<number | null>(null);
  const [isInitializing, setIsInitializing] = React.useState(true);
  const [showSnippets, setShowSnippets] = React.useState(false);
  const [terminalId, setTerminalId] = React.useState<string | null>(null);
  const [confirmBroadcast, setConfirmBroadcast] = React.useState(false);
  /** Set while recording a macro; terminal input is copied into it. */
  const recorderRef = React.useRef<MacroRecorder | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  /** A finished recording waiting for a name. */
  const [unsavedMacro, setUnsavedMacro] = React.useState<MacroStep[] | null>(null);
  const [macroName, setMacroName] = React.useState("");
  const playbackRef = React.useRef<AbortController | null>(null);
  const [playingMacro, setPlayingMacro] = React.useState<string | null>(null);

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
      unregisterTerminal(terminalIdRef.current);
      setTerminalId(null);
    }
    oscHandlerRef.current?.dispose();
    oscHandlerRef.current = null;
    highlighterRef.current?.dispose();
    highlighterRef.current = null;

    // Font, cursor and scrollback come from Settings › Terminal (defaults: a Nerd Font, so prompt glyphs render).
    const term = new Terminal({
      ...xtermOptions(getPreferences().terminal),
      drawBoldTextInBrightColors: false,
      theme: OB_DARK_THEME,
      // Decorations (highlight rules) are still behind xterm's proposed-API flag.
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // OSC 7 (`ESC ]7;file://host/path ESC \`) is how shells report their cwd —
    // main/services/shell-integration.ts injects a hook that emits it on every
    // prompt for bash/zsh. Following it drives the remote file pane's cwd.
    oscHandlerRef.current = term.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7Cwd(data);
      if (path) reportRemoteCwd(session.sessionId, path);
      return true;
    });

    term.open(container);
    highlighterRef.current = attachHighlighter(term, () => highlightRef.current);
    term.onSelectionChange(() => {
      if (!getPreferences().terminal.copyOnSelect) return;
      const selection = term.getSelection();
      if (selection) void navigator.clipboard.writeText(selection).catch(() => {});
    });
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
      // Unmounted (or re-initialised) while terminal:open was in flight — e.g.
      // StrictMode's double mount, or closing a tab right away. The cleanup
      // couldn't close this backend terminal because it didn't have its id
      // yet, so close it here instead of wiring it to a disposed xterm.
      if (termRef.current !== term) {
        void ipc.terminal.close({ terminalId: newTerminalId }).catch(() => {});
        return;
      }
      terminalIdRef.current = newTerminalId;
      registerTerminal(newTerminalId);
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
          unregisterTerminal(newTerminalId);
        }
      });

      // Send user input, fanned out to the rest of the broadcast group when this terminal is a member
      term.onData((data) => {
        const id = terminalIdRef.current;
        if (!id) return;
        recorderRef.current?.add(data);
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
        unregisterTerminal(terminalIdRef.current);
        void ipc.terminal.close({ terminalId: terminalIdRef.current }).catch(() => {});
        terminalIdRef.current = null;
      }
      termRef.current?.dispose();
      termRef.current = null;
      oscHandlerRef.current?.dispose();
      oscHandlerRef.current = null;
      highlighterRef.current?.dispose();
      highlighterRef.current = null;
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

  // Apply Settings › Terminal changes to the open terminal, then refit (font size changes the grid).
  const terminalPrefs = usePreferences().terminal;
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    Object.assign(term.options, xtermOptions(terminalPrefs));
    const terminalId = terminalIdRef.current;
    try {
      fitAddonRef.current?.fit();
      if (terminalId) void ipc.terminal.resize({ terminalId, cols: term.cols, rows: term.rows }).catch(() => {});
    } catch {
      // fit() can throw while hidden or disposed; the next resize catches up.
    }
  }, [terminalPrefs]);

  // Settings › Highlighting: recompile and re-colour what's already on screen.
  const highlightPrefs = usePreferences().highlight;
  React.useEffect(() => {
    highlightRef.current = { enabled: highlightPrefs.enabled, rules: compileRules(highlightPrefs.rules) };
    highlighterRef.current?.refresh();
  }, [highlightPrefs]);

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

  function toggleRecording() {
    if (!recorderRef.current) {
      recorderRef.current = new MacroRecorder();
      setIsRecording(true);
      termRef.current?.focus();
      return;
    }
    const steps = recorderRef.current.steps;
    recorderRef.current = null;
    setIsRecording(false);
    if (steps.length === 0) {
      toast("Nothing was typed, so there's no macro to save.");
      return;
    }
    setMacroName("");
    setUnsavedMacro(steps);
  }

  async function saveMacro() {
    if (!unsavedMacro || !macroName.trim()) return;
    try {
      await ipc.snippet.create({
        input: {
          name: macroName.trim(),
          command: describeMacro(unsavedMacro) || "Macro",
          tags: [],
          macro: unsavedMacro,
        },
      });
      toast.success(`Saved macro "${macroName.trim()}". Run it from the snippets list.`);
      setUnsavedMacro(null);
    } catch (err) {
      toast.error(`Couldn't save the macro: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Runs a snippet or macro as if typed here: into every terminal in the multi-exec group when this one is in it. */
  function runSnippet(snippet: CommandSnippet) {
    const id = terminalIdRef.current;
    if (!id) return;
    const send = (data: string) => {
      for (const targetId of getBroadcastTargets(id)) ipc.terminal.send({ terminalId: targetId, data });
    };
    if (!snippet.macro) {
      send(`${snippet.command}\n`);
      return;
    }
    playbackRef.current?.abort();
    const controller = new AbortController();
    playbackRef.current = controller;
    setPlayingMacro(snippet.name);
    void playMacro(snippet.macro, send, controller.signal).finally(() => {
      if (playbackRef.current === controller) {
        playbackRef.current = null;
        setPlayingMacro(null);
      }
    });
  }

  // Stop a playing macro if the pane goes away.
  React.useEffect(() => () => playbackRef.current?.abort(), []);

  function handleToggleBroadcast() {
    if (!terminalId) return;
    if (isBroadcastMember) {
      leaveBroadcastGroup(terminalId);
      return;
    }
    if (shouldWarnBeforeBroadcast() && getPreferences().sessions.warnBeforeMultiExec) {
      setConfirmBroadcast(true);
      return;
    }
    joinBroadcastGroup(terminalId);
  }

  return (
    <div
      className={cn(
        "terminal-surface h-full flex flex-col",
        isBroadcastMember && "ring-2 ring-inset ring-yellow-500/70",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-separator shrink-0">
        <TerminalIcon className="size-3.5 text-tertiary" />
        <Text variant="small" color="secondary" className="flex-1">
          {session.username ? `${session.username}@` : ""}
          {session.host}
        </Text>
        {isRecording && (
          <Text variant="small" className="text-support-red font-medium" role="status">
            Recording macro
          </Text>
        )}
        {playingMacro && (
          <>
            <Text variant="small" color="secondary" role="status">
              Playing {playingMacro}
            </Text>
            <Button variant="transparent" size="small" onClick={() => playbackRef.current?.abort()}>
              Stop
            </Button>
          </>
        )}
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
            onClick={toggleRecording}
            aria-label={isRecording ? "Stop recording macro" : "Record a macro"}
            aria-pressed={isRecording}
            title={isRecording ? "Stop recording" : "Record a macro: everything you type until you stop"}
          >
            {isRecording ? (
              <SquareIcon className="size-3.5 fill-support-red text-support-red" />
            ) : (
              <CircleIcon className="size-3.5 text-tertiary" />
            )}
          </Button>
        )}
        {!isClosed && !isInitializing && (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => setShowSnippets(true)}
            aria-label="Run a snippet or macro"
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
        {onClose && (
          <Button variant="transparent" size="small" iconOnly onClick={onClose} aria-label="Close pane">
            <XIcon className="size-3.5 text-tertiary" />
          </Button>
        )}
      </div>

      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} className="absolute inset-0 p-2" />

        {isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)]">
            <Text variant="small" color="tertiary">
              Connecting...
            </Text>
          </div>
        )}

        {isClosed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]/90">
            <Text color="secondary">Terminal closed{exitCode !== null ? ` (exit ${exitCode})` : ""}</Text>
            <div className="flex gap-2">
              <Button variant="filled" size="small" onClick={() => void initTerminal()}>
                Reconnect
              </Button>
              {onClose && (
                <Button variant="transparent" size="small" onClick={onClose}>
                  Close pane
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <SnippetLibraryDialog open={showSnippets} onOpenChange={setShowSnippets} onRun={runSnippet} />

      <Dialog
        open={unsavedMacro !== null}
        onOpenChange={(open) => !open && setUnsavedMacro(null)}
        title="Save macro"
        size="small"
      >
        <form
          className="flex flex-col gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveMacro();
          }}
        >
          <Field label="Name">
            <Input
              autoFocus
              placeholder="Restart web stack"
              value={macroName}
              onChange={(e) => setMacroName(e.target.value)}
            />
          </Field>
          <Text variant="small" color="tertiary" className="font-mono break-all">
            {unsavedMacro ? describeMacro(unsavedMacro) : ""}
          </Text>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="filled" type="button" onClick={() => setUnsavedMacro(null)}>
              Discard
            </Button>
            <Button variant="accent" type="submit" disabled={!macroName.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

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
