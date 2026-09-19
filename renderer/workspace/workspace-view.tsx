import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, PanelGroup, Panel, Text, toast } from "@renderer/lib/ui";
import { TerminalIcon, ArrowDownToLineIcon, NetworkIcon } from "lucide-react";
import { getSession } from "@renderer/lib/sessions";
import { closeOpenSession } from "@renderer/lib/open-sessions-store";
import { ipc } from "@renderer/lib/ipc";
import { useTransfers } from "@renderer/lib/use-transfers";
import { usePersistedState } from "@renderer/lib/hooks";
import { DualPaneView } from "./files/dual-pane-view";
import { TerminalTabs } from "./terminal/terminal-tabs";
import { TransferQueuePanel } from "./transfer-queue/transfer-queue-panel";
import { RemoteDesktopPane } from "./remote-desktop/remote-desktop-pane";
import { PortForwardPanel } from "./port-forwards/port-forward-panel";

interface WorkspaceViewProps {
  sessionId: string;
}

// Dockable side/bottom panels toggled from the session bar. An array (not a
// couple of hardcoded booleans) so a future panel — snippets, an activity
// log — only needs a new id here plus a slot in the JSX below.
type DockPanelId = "terminal" | "forwards";

const OPEN_PANELS_STORAGE_KEY = "nexus:workspace-open-panels";

export function WorkspaceView({ sessionId }: WorkspaceViewProps) {
  const qc = useQueryClient();
  const session = getSession(sessionId);

  const [openPanels, setOpenPanels] = usePersistedState<DockPanelId[]>(OPEN_PANELS_STORAGE_KEY, []);
  const [showTransfers, setShowTransfers] = React.useState(false);

  const transferState = useTransfers();

  const activeCount = transferState.active.length;

  function togglePanel(id: DockPanelId) {
    setOpenPanels(openPanels.includes(id) ? openPanels.filter((p) => p !== id) : [...openPanels, id]);
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

  const terminalOpen = session.supportsTerminal && openPanels.includes("terminal");
  const forwardsOpen = session.supportsTerminal && openPanels.includes("forwards");

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-separator pl-4 pr-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-support-green shrink-0" title="Connected" />
          <span className="text-sm font-semibold text-primary truncate">{session.name}</span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-accent/15 text-accent">
            {session.protocol}
          </span>
          <span className="text-xs text-secondary truncate">
            {session.username}@{session.host}
          </span>
        </div>

        {session.kind === "file" && (
          <div className="flex items-center gap-1 shrink-0">
            {session.supportsTerminal && (
              <Button
                variant={terminalOpen ? "filled" : "transparent"}
                size="small"
                iconOnly
                onClick={() => togglePanel("terminal")}
                aria-label="Toggle terminal panel"
              >
                <TerminalIcon className="size-3.5" />
              </Button>
            )}
            {session.supportsTerminal && (
              <Button
                variant={forwardsOpen ? "filled" : "transparent"}
                size="small"
                iconOnly
                onClick={() => togglePanel("forwards")}
                aria-label="Toggle port forwards panel"
              >
                <NetworkIcon className="size-3.5" />
              </Button>
            )}
            <Button
              variant="transparent"
              size="small"
              iconOnly
              onClick={() => setShowTransfers((v) => !v)}
              aria-label="Toggle transfer queue"
            >
              <div className="relative">
                <ArrowDownToLineIcon className="size-3.5" />
                {activeCount > 0 && (
                  <span className="absolute -top-1 -right-1 size-1.5 rounded-full bg-accent" />
                )}
              </div>
            </Button>
          </div>
        )}
      </div>

      {session.kind === "display" ? (
        // Remote Desktop (rdp) — no file browsing/terminal/transfers, just
        // the embedded native remote-desktop view filling the rest of the tab.
        <div className="flex-1 min-h-0">
          <RemoteDesktopPane session={session} />
        </div>
      ) : (
        <>
          <PanelGroup storageKey="workspace-vertical" direction="vertical" className="flex-1 min-h-0">
            <Panel id="workspace-main" className="min-h-0">
              <PanelGroup storageKey="workspace-horizontal" className="h-full">
                <Panel id="workspace-files" className="h-full">
                  <DualPaneView session={session} transferState={transferState} />
                </Panel>
                {forwardsOpen && (
                  <Panel id="workspace-forwards" defaultSize={26} minSize={220} className="h-full">
                    <PortForwardPanel sessionId={session.sessionId} />
                  </Panel>
                )}
              </PanelGroup>
            </Panel>
            {terminalOpen && (
              <Panel id="workspace-terminal" defaultSize={35} minSize={120} className="min-h-0">
                <TerminalTabs session={session} isVisible={terminalOpen} />
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
        </>
      )}
    </div>
  );
}
