import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  ToolbarDescription,
  ToolbarActions,
  Button,
  TabsRoot,
  Tabs,
  TabsTrigger,
  TabsContent,
  Text,
  toast,
} from "@renderer/lib/ui";
import {
  ChevronLeftIcon,
  FolderIcon,
  TerminalIcon,
  ArrowDownToLineIcon,
  NetworkIcon,
} from "lucide-react";
import { getSession, removeSession } from "@renderer/lib/sessions";
import { closeOpenSession } from "@renderer/lib/open-sessions-store";
import { ipc } from "@renderer/lib/ipc";
import { useTransfers } from "@renderer/lib/use-transfers";
import { DualPaneView } from "./files/dual-pane-view";
import { TerminalTabs } from "./terminal/terminal-tabs";
import { TransferQueuePanel } from "./transfer-queue/transfer-queue-panel";
import { RemoteDesktopPane } from "./remote-desktop/remote-desktop-pane";
import { PortForwardPanel } from "./port-forwards/port-forward-panel";

interface WorkspaceViewProps {
  sessionId: string;
}

export function WorkspaceView({ sessionId }: WorkspaceViewProps) {
  const qc = useQueryClient();
  const session = getSession(sessionId);

  const [activeTab, setActiveTab] = React.useState("files");
  const [showTransfers, setShowTransfers] = React.useState(false);

  const transferState = useTransfers();

  const activeCount = transferState.active.length;

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

  async function handleDisconnect() {
    console.log("[WorkspaceView:disconnect]", { sessionId });
    try {
      await ipc.session.disconnect({ sessionId });
    } catch {
      // best-effort
    }
    removeSession(sessionId);
    closeOpenSession(sessionId);
  }

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

  return (
    <div className="h-full flex flex-col">
      <Toolbar>
        <ToolbarContent>
          <Button
            variant="glass"
            size="large"
            iconOnly
            onClick={() => void handleDisconnect()}
            aria-label="Disconnect and go back"
          >
            <ChevronLeftIcon className="size-4.5" />
          </Button>
          <div className="flex flex-col min-w-0 ml-1">
            <div className="flex items-center gap-2 min-w-0">
              <ToolbarTitle>{session.name}</ToolbarTitle>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-accent/15 text-accent">
                {session.protocol}
              </span>
            </div>
            <ToolbarDescription>
              {session.username}@{session.host}
            </ToolbarDescription>
          </div>
        </ToolbarContent>
        {session.kind === "file" && (
          <ToolbarActions>
            <Button
              variant="glass"
              size="large"
              iconOnly
              onClick={() => setShowTransfers((v) => !v)}
              aria-label="Toggle transfer queue"
            >
              <div className="relative">
                <ArrowDownToLineIcon className="size-4.5" />
                {activeCount > 0 && (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-accent" />
                )}
              </div>
            </Button>
          </ToolbarActions>
        )}
      </Toolbar>

      {session.kind === "display" ? (
        // Remote Desktop (rdp) — no file browsing/terminal/transfers, just
        // the embedded native remote-desktop view filling the rest of the tab.
        <div className="flex-1 min-h-0">
          <RemoteDesktopPane session={session} />
        </div>
      ) : (
        <>
          <TabsRoot
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="px-4 border-b border-separator">
              <Tabs size="medium" variant="transparent">
                <TabsTrigger value="files">
                  <FolderIcon className="size-3.5 mr-1.5" />
                  Files
                </TabsTrigger>
                {session.supportsTerminal && (
                  <TabsTrigger value="terminal">
                    <TerminalIcon className="size-3.5 mr-1.5" />
                    Terminal
                  </TabsTrigger>
                )}
                {session.supportsTerminal && (
                  <TabsTrigger value="forwards">
                    <NetworkIcon className="size-3.5 mr-1.5" />
                    Forwards
                  </TabsTrigger>
                )}
              </Tabs>
            </div>

            {/* Keep tabs mounted so terminal/state persist */}
            <div className="flex-1 min-h-0 relative">
              <TabsContent value="files" className="h-full absolute inset-0 data-[state=inactive]:pointer-events-none">
                <DualPaneView session={session} transferState={transferState} />
              </TabsContent>

              {session.supportsTerminal && (
                <TabsContent value="terminal" className="h-full absolute inset-0 data-[state=inactive]:pointer-events-none">
                  <TerminalTabs session={session} isVisible={activeTab === "terminal"} />
                </TabsContent>
              )}

              {session.supportsTerminal && (
                <TabsContent value="forwards" className="h-full absolute inset-0 data-[state=inactive]:pointer-events-none">
                  <PortForwardPanel sessionId={session.sessionId} />
                </TabsContent>
              )}
            </div>
          </TabsRoot>

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
