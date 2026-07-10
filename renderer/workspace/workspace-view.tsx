import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
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
} from "@glaze/core/components";
import {
  ChevronLeftIcon,
  FolderIcon,
  TerminalIcon,
  ArrowDownToLineIcon,
} from "lucide-react";
import { getSession, removeSession } from "@renderer/lib/sessions";
import { ipc } from "@renderer/lib/ipc";
import { useTransfers } from "@renderer/lib/use-transfers";
import { DualPaneView } from "./files/dual-pane-view";
import { TerminalPane } from "./terminal/terminal-pane";
import { TransferQueuePanel } from "./transfer-queue/transfer-queue-panel";

export function WorkspaceView() {
  const { sessionId } = useParams({ from: "/workspace/$sessionId" });
  const navigate = useNavigate();
  const session = getSession(sessionId);

  const [activeTab, setActiveTab] = React.useState("files");
  const [showTransfers, setShowTransfers] = React.useState(false);

  const transferState = useTransfers();

  const activeCount = transferState.active.length;

  async function handleDisconnect() {
    console.log("[WorkspaceView:disconnect]", { sessionId });
    try {
      await ipc.session.disconnect({ sessionId });
    } catch {
      // best-effort
    }
    removeSession(sessionId);
    await navigate({ to: "/" });
  }

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <Text color="secondary">Session not found</Text>
        <Button variant="accent" onClick={() => void navigate({ to: "/" })}>
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
            <ToolbarTitle>{session.name}</ToolbarTitle>
            <ToolbarDescription>
              {session.username}@{session.host}
            </ToolbarDescription>
          </div>
        </ToolbarContent>
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
      </Toolbar>

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
          </Tabs>
        </div>

        {/* Keep tabs mounted so terminal/state persist */}
        <div className="flex-1 min-h-0 relative">
          <TabsContent value="files" className="h-full absolute inset-0 data-[state=inactive]:pointer-events-none">
            <DualPaneView session={session} transferState={transferState} />
          </TabsContent>

          {session.supportsTerminal && (
            <TabsContent value="terminal" className="h-full absolute inset-0 data-[state=inactive]:pointer-events-none">
              <TerminalPane session={session} isVisible={activeTab === "terminal"} />
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
    </div>
  );
}
