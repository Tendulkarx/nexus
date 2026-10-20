import * as React from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button, PanelGroup, Panel, Text, toast } from "@renderer/lib/ui";
import { TerminalIcon, FolderIcon, ArrowDownToLineIcon, NetworkIcon, ExternalLinkIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { getSession, removeSession } from "@renderer/lib/sessions";
import { clearSessionStatus, useSessionStatus } from "@renderer/lib/session-status";
import { CONNECT_PROFILE_EVENT, type ConnectProfileEventDetail } from "@renderer/lib/menu-events";
import { SessionDot } from "@renderer/main/shell/session-dot";
import { closeOpenSession, useOpenSessions } from "@renderer/lib/open-sessions-store";
import { useFilesSidebarSlot } from "@renderer/lib/files-sidebar-slot";
import { getPreferences } from "@renderer/lib/preferences";
import { ipc } from "@renderer/lib/ipc";
import { useTransfers } from "@renderer/lib/use-transfers";
import { DualPaneView } from "./files/dual-pane-view";
import { RemoteFilesPanel } from "./files/remote-files-panel";
import { TerminalTabs } from "./terminal/terminal-tabs";
import { TransferQueuePanel } from "./transfer-queue/transfer-queue-panel";
import { RemoteDesktopPane } from "./remote-desktop/remote-desktop-pane";
import { VncPane } from "./remote-desktop/vnc-pane";
import { PortForwardPanel } from "./port-forwards/port-forward-panel";
import type { SessionInfo } from "@shared/ipc-contract";

interface WorkspaceViewProps {
  sessionId: string;
  /**
   * Only passed by the main window's AppShell — pops this session into its
   * own BrowserWindow (see main/windows/session-window.ts) and removes it
   * from the main window's tab list. Omitted (and so hidden) in the popped-out
   * window itself, which renders this same component for just that one session.
   */
  onPopOut?: () => void;
}

/** What fills a file session's tab: its terminal, or the dual-pane file browser. */
type MainView = "terminal" | "files";

/** SSH profiles open on Settings › Sessions' choice (terminal by default); SFTP/FTP (and anything without a shell) open on files. */
function defaultMainView(session: Pick<SessionInfo, "protocol" | "supportsTerminal">): MainView {
  if (!session.supportsTerminal || session.protocol !== "ssh") return "files";
  return getPreferences().sessions.sshOpensOn;
}

export function WorkspaceView({ sessionId, onPopOut }: WorkspaceViewProps) {
  const qc = useQueryClient();
  const session = getSession(sessionId);
  // In the main window the shell provides the Files and Tunnels sidebars; a
  // popped-out window has neither, so it keeps the in-tab port forwards panel.
  const inShell = onPopOut !== undefined;

  const [mainView, setMainView] = React.useState<MainView>(() => (session ? defaultMainView(session) : "files"));
  // The terminal mounts the first time it's shown and then stays mounted, so
  // switching views never kills the shell, and SFTP-first sessions don't open
  // one nobody asked for.
  const [terminalMounted, setTerminalMounted] = React.useState(mainView === "terminal");
  const [showForwards, setShowForwards] = React.useState(false);
  const [showTransfers, setShowTransfers] = React.useState(false);

  const transferState = useTransfers();
  const activeCount = transferState.active.length;

  const filesSlot = useFilesSidebarSlot();
  const { active } = useOpenSessions();

  const status = useSessionStatus(sessionId);

  /** Opens a fresh session from the same profile (the connect flow handles prompts), then closes this dead tab. */
  function reconnect() {
    if (!session?.profileId) return;
    window.dispatchEvent(
      new CustomEvent<ConnectProfileEventDetail>(CONNECT_PROFILE_EVENT, { detail: { profileId: session.profileId } }),
    );
    void ipc.session.disconnect({ sessionId }).catch(() => {});
    removeSession(sessionId);
    clearSessionStatus(sessionId);
    closeOpenSession(sessionId);
  }

  function showView(view: MainView) {
    setMainView(view);
    if (view === "terminal") setTerminalMounted(true);
  }

  // Toast + refresh when an externally-edited file is saved back to the server.
  React.useEffect(() => {
    const offSaved = ipc.edit.onSaved((e) => {
      console.log("[WorkspaceView:edit:saved]", e);
      toast.success(`Saved "${e.name}" to the server`);
      void qc.invalidateQueries({ queryKey: ["remote", sessionId] });
    });
    const offError = ipc.edit.onError((e) => {
      console.log("[WorkspaceView:edit:error]", e);
      toast.error(`Couldn't save changes: ${e.message}`);
    });
    return () => {
      offSaved();
      offError();
    };
  }, [qc, sessionId]);

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <Text color="secondary">Session not found</Text>
        <Button variant="accent" onClick={() => closeOpenSession(sessionId)}>
          Back to Connections
        </Button>
      </div>
    );
  }

  const canSwitch = session.kind === "file" && session.supportsTerminal;
  const forwardsOpen = !inShell && canSwitch && showForwards;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-separator pl-4 pr-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SessionDot sessionId={session.sessionId} className="size-2" />
          <span className="text-sm font-semibold text-primary truncate">{session.name}</span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-accent/15 text-accent">
            {session.protocol}
          </span>
          <span className="text-xs text-secondary truncate">
            {session.username ? `${session.username}@` : ""}
            {session.host}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canSwitch && (
            <div
              role="radiogroup"
              aria-label="Show"
              className="flex items-center rounded-medium bg-control-subtle p-0.5 mr-1"
            >
              {(
                [
                  { view: "terminal", label: "Terminal", icon: TerminalIcon },
                  { view: "files", label: "Files", icon: FolderIcon },
                ] as const
              ).map(({ view, label, icon: Icon }) => (
                <button
                  key={view}
                  type="button"
                  role="radio"
                  aria-checked={mainView === view}
                  onClick={() => showView(view)}
                  className={cn(
                    "flex items-center gap-1.5 h-6 px-2.5 rounded-[6px] text-xs transition-colors",
                    mainView === view ? "bg-[var(--bg)] text-primary shadow-sm" : "text-secondary hover:text-primary",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          )}
          {!inShell && canSwitch && (
            <Button
              variant={forwardsOpen ? "filled" : "transparent"}
              size="small"
              iconOnly
              onClick={() => setShowForwards((v) => !v)}
              aria-label="Toggle port forwards panel"
            >
              <NetworkIcon className="size-3.5" />
            </Button>
          )}
          {session.kind === "file" && (
            <Button
              variant="transparent"
              size="small"
              iconOnly
              onClick={() => setShowTransfers((v) => !v)}
              aria-label="Toggle transfer queue"
            >
              <div className="relative">
                <ArrowDownToLineIcon className="size-3.5" />
                {activeCount > 0 && <span className="absolute -top-1 -right-1 size-1.5 rounded-full bg-accent" />}
              </div>
            </Button>
          )}
          {onPopOut && (
            <Button variant="transparent" size="small" iconOnly onClick={onPopOut} aria-label="Open in new window">
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {status.state === "disconnected" && session.kind !== "display" && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-separator bg-support-red/10 text-sm shrink-0">
          <span className="flex-1 min-w-0 text-primary">
            Disconnected{status.detail ? `: ${status.detail}` : ""}. The terminal and file views below are no longer
            live.
          </span>
          {session.profileId && (
            <Button variant="accent" size="small" onClick={reconnect}>
              Reconnect
            </Button>
          )}
        </div>
      )}

      {session.kind === "display" ? (
        // Remote Desktop (rdp) — no file browsing/terminal/transfers, just
        // the embedded native remote-desktop view filling the rest of the tab.
        <div className="flex-1 min-h-0">
          {session.protocol === "vnc" ? <VncPane session={session} /> : <RemoteDesktopPane session={session} />}
        </div>
      ) : session.kind === "terminal" ? (
        // Mosh and local shells — terminal-only, no filesystem.
        <div className="flex-1 min-h-0">
          <TerminalTabs session={session} isVisible={true} />
        </div>
      ) : (
        <>
          <PanelGroup storageKey="workspace-horizontal" className="flex-1 min-h-0">
            <Panel id="workspace-main" className="h-full relative">
              {terminalMounted && (
                <div className={cn("absolute inset-0", mainView !== "terminal" && "hidden")}>
                  <TerminalTabs session={session} isVisible={mainView === "terminal"} />
                </div>
              )}
              <div className={cn("absolute inset-0", mainView !== "files" && "hidden")}>
                <DualPaneView session={session} transferState={transferState} />
              </div>
            </Panel>
            {forwardsOpen && (
              <Panel id="workspace-forwards" defaultSize={26} minSize={220} className="h-full">
                <PortForwardPanel sessionId={session.sessionId} />
              </Panel>
            )}
          </PanelGroup>

          {showTransfers && (
            <TransferQueuePanel
              transfers={transferState.transfers}
              onCancel={transferState.cancelTransfer}
              onClose={() => setShowTransfers(false)}
            />
          )}

          {/* The shell's Files sidebar, showing this session's browser only while its tab is active. */}
          {filesSlot &&
            createPortal(
              <div className={cn("h-full", active !== sessionId && "hidden")}>
                <RemoteFilesPanel session={session} transferState={transferState} />
              </div>,
              filesSlot,
            )}
        </>
      )}
    </div>
  );
}
