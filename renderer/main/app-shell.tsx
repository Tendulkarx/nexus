/**
 * App-level shell: title bar, icon rail + sidebar, session tab strip, the
 * main area and a status bar. Keeps every open session's WorkspaceView
 * mounted (visibility toggled, not unmounted) so terminal/file state survives
 * switching tabs. ConnectionManagerView is always mounted too: it owns the
 * new-connection and connect flows the title bar and Sessions sidebar trigger.
 */
import * as React from "react";
import {
  XIcon,
  LayoutGridIcon,
  SearchIcon,
  PlusIcon,
  SettingsIcon,
  SunMoonIcon,
  SquareTerminalIcon,
  RadioIcon,
} from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { AlertDialog, Button, TrafficLightInsetContext } from "@renderer/lib/ui";
import {
  acknowledgeBroadcastWarning,
  shouldWarnBeforeBroadcast,
  toggleAllBroadcasting,
  useBroadcastGroup,
  useLiveTerminalCount,
} from "@renderer/lib/terminal-broadcast-store";
import { getPreferences } from "@renderer/lib/preferences";
import { getSession, removeSession } from "@renderer/lib/sessions";
import { useOpenSessions, closeOpenSession, setActiveView } from "@renderer/lib/open-sessions-store";
import { usePersistedState } from "@renderer/lib/hooks";
import { ipc } from "@renderer/lib/ipc";
import {
  NEW_CONNECTION_EVENT,
  OPEN_PALETTE_EVENT,
  SPLIT_TERMINAL_EVENT,
  type SplitTerminalEventDetail,
} from "@renderer/lib/menu-events";
import { toggleTheme } from "@renderer/lib/theme-actions";
import { openLocalShell } from "@renderer/lib/local-shell";
import { ConnectionManagerView } from "@renderer/connection-manager/connection-manager-view";
import { WorkspaceView } from "@renderer/workspace/workspace-view";
import { CommandPalette } from "@renderer/command-palette/command-palette";
import { IconRail, SIDEBAR_VIEW_LABEL, type SidebarView } from "./shell/icon-rail";
import { SessionsSidebar } from "./shell/sessions-sidebar";
import { TunnelsSidebar, FilesSidebar, ToolsSidebar } from "./shell/secondary-views";
import { ServersSidebar } from "./shell/servers-sidebar";
import { StatusBar } from "./shell/status-bar";
import { SessionDot } from "./shell/session-dot";
import { clearSessionStatus } from "@renderer/lib/session-status";
import { setFilesSidebarSlot } from "@renderer/lib/files-sidebar-slot";
import { parseToolTab, TOOL_INFO } from "@renderer/tools/tool-tabs";
import { ToolView, TOOL_ICONS } from "@renderer/tools/tool-view";
import { usePreferences } from "@renderer/lib/preferences";
import { formatAccelerator } from "@shared/shortcuts";

async function popOutSession(sessionId: string): Promise<void> {
  try {
    await window.nexusAPI.ipc.invoke("window:openSessionWindow", { sessionId });
    closeOpenSession(sessionId);
  } catch {
    // best-effort
  }
}

function openNewConnection() {
  setActiveView("connections");
  window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
}

/** Closes a tab: tools just close; sessions disconnect first (best-effort). */
async function closeTab(tabId: string): Promise<void> {
  if (!parseToolTab(tabId)) {
    try {
      await ipc.session.disconnect({ sessionId: tabId });
    } catch {
      // best-effort
    }
    removeSession(tabId);
    clearSessionStatus(tabId);
  }
  closeOpenSession(tabId);
}

function SessionTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const session = getSession(sessionId);
  const toolId = parseToolTab(sessionId);
  const ToolIcon = toolId ? TOOL_ICONS[toolId] : null;

  async function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    await closeTab(sessionId);
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setActiveView(sessionId)}
      className={cn(
        "group flex items-center gap-2 rounded-t-medium px-3 h-8 text-xs max-w-[200px] shrink-0 transition-colors",
        active ? "bg-[var(--bg)] text-primary" : "text-secondary hover:bg-control-subtle hover:text-primary",
      )}
    >
      {ToolIcon ? (
        <ToolIcon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <SessionDot sessionId={sessionId} className="size-1.5" />
      )}
      <span className="truncate">{toolId ? TOOL_INFO[toolId].name : (session?.name ?? sessionId)}</span>
      {session && <span className="font-mono text-[10px] uppercase text-tertiary">{session.protocol}</span>}
      <XIcon
        aria-label={toolId ? "Close tool" : "Close session"}
        className="size-3 shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100"
        onClick={(e) => void handleClose(e)}
      />
    </button>
  );
}

function SidebarContent({ view }: { view: SidebarView }) {
  switch (view) {
    case "sessions":
      return <SessionsSidebar />;
    case "files":
      return null; // rendered separately in AppShell; see the aside below
    case "tunnels":
      return <TunnelsSidebar />;
    case "tools":
      return <ToolsSidebar />;
    case "servers":
      return <ServersSidebar />;
  }
}

/**
 * One switch for multi-exec across every open terminal (terminals can still
 * join or leave one at a time from their own header). Warns the first time
 * per app run unless Settings › Sessions turns the warning off.
 */
function MultiExecSwitch() {
  const broadcasting = useBroadcastGroup().size;
  const live = useLiveTerminalCount();
  const [confirming, setConfirming] = React.useState(false);
  const on = broadcasting > 0;

  function toggle() {
    if (!on && shouldWarnBeforeBroadcast() && getPreferences().sessions.warnBeforeMultiExec) {
      setConfirming(true);
      return;
    }
    toggleAllBroadcasting();
  }

  return (
    <>
      <Button
        variant={on ? "filled" : "transparent"}
        size="small"
        className={cn("gap-1.5", on && "bg-support-red/15 text-primary")}
        aria-pressed={on}
        disabled={!on && live < 2}
        title={
          on
            ? "Stop sending typing to every terminal"
            : live < 2
              ? "Open two or more terminals first"
              : "Send typing to every open terminal"
        }
        onClick={toggle}
      >
        <RadioIcon className="size-3.5" aria-hidden="true" />
        {on ? `Multi-exec · ${broadcasting}` : "Multi-exec"}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Send typing to all ${live} terminals?`}
        description="Everything you type in any of them goes to all of them, including terminals on different servers. Check which servers are open before running anything destructive."
        confirmLabel="Turn on multi-exec"
        onConfirm={() => {
          acknowledgeBroadcastWarning();
          toggleAllBroadcasting();
        }}
      />
    </>
  );
}

export function AppShell() {
  const { shortcuts } = usePreferences();
  const { order, active } = useOpenSessions();
  const [sidebarView, setSidebarView] = usePersistedState<SidebarView>("shell:sidebar-view", "sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("shell:sidebar-collapsed", false);

  React.useEffect(() => {
    const off = window.nexusAPI.ipc.on("menu:action", (_event, action) => {
      if (action === "new-connection") openNewConnection();
      if (action === "new-local-shell") void openLocalShell();
      if (action === "split-right" || action === "split-down") {
        const direction = action === "split-right" ? "horizontal" : "vertical";
        window.dispatchEvent(
          new CustomEvent<SplitTerminalEventDetail>(SPLIT_TERMINAL_EVENT, { detail: { direction } }),
        );
      }
    });
    return off;
  }, []);

  // Separate effect (re-subscribed whenever the active tab changes) so
  // "close-tab" always closes whichever session is currently active rather
  // than one captured in a stale closure.
  React.useEffect(() => {
    const off = window.nexusAPI.ipc.on("menu:action", (_event, action) => {
      if (action !== "close-tab") return;
      if (active === "connections") return;
      void closeTab(active);
    });
    return off;
  }, [active]);

  function selectSidebarView(view: SidebarView) {
    if (view === sidebarView && !sidebarCollapsed) {
      setSidebarCollapsed(true);
    } else {
      setSidebarView(view);
      setSidebarCollapsed(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Title bar. pl-20 clears the inset macOS traffic lights (trafficLightPosition x:16 in main/index.ts). */}
      <header className="drag-region flex items-center gap-3 pl-20 pr-2 py-1.5 bg-chrome border-b border-separator shrink-0">
        <span className="text-sm font-semibold text-primary">Nexus</span>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
          className="no-drag flex flex-1 max-w-md items-center gap-2 h-7 rounded-medium px-2.5 bg-control-subtle text-xs text-secondary hover:bg-control"
        >
          <SearchIcon className="size-3.5" aria-hidden="true" />
          <span className="flex-1 text-left truncate">Search connections and commands</span>
          <kbd className="rounded border border-separator px-1.5 font-sans text-[10px]">
            {formatAccelerator(shortcuts.palette)}
          </kbd>
        </button>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-1 shrink-0">
          <MultiExecSwitch />
          <Button variant="accent" size="small" className="gap-1.5" onClick={openNewConnection}>
            <PlusIcon className="size-3.5" />
            New session
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => void toggleTheme()}
            aria-label="Toggle theme"
          >
            <SunMoonIcon className="size-3.5" />
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => void window.nexusAPI.ipc.invoke("window:openSettings")}
            aria-label="Open settings"
          >
            <SettingsIcon className="size-3.5" />
          </Button>
        </div>
      </header>

      <TrafficLightInsetContext.Provider value={false}>
        <div className="flex-1 min-h-0 flex">
          <IconRail view={sidebarView} collapsed={sidebarCollapsed} onSelect={selectSidebarView} />

          {/* Hidden rather than unmounted when collapsed: the Files view's slot hosts each
              file session's browser (portalled from WorkspaceView), which would otherwise
              lose its folder every time the sidebar closes. */}
          <aside
            aria-label={SIDEBAR_VIEW_LABEL[sidebarView]}
            className={cn(
              "shrink-0 flex flex-col min-h-0 bg-chrome border-r border-separator",
              sidebarView === "files" || sidebarView === "servers" ? "w-80" : "w-64",
              sidebarCollapsed && "hidden",
            )}
          >
            <h2 className="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {SIDEBAR_VIEW_LABEL[sidebarView]}
            </h2>
            {sidebarView !== "files" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <SidebarContent view={sidebarView} />
              </div>
            )}
            <div className={cn("flex-1 min-h-0 flex flex-col", sidebarView !== "files" && "hidden")}>
              <FilesSidebar />
              <div ref={setFilesSidebarSlot} className="flex-1 min-h-0" />
            </div>
          </aside>

          <main className="flex-1 min-w-0 flex flex-col">
            <div
              role="tablist"
              aria-label="Open sessions"
              className="flex items-end gap-0.5 px-2 pt-1 bg-chrome border-b border-separator overflow-x-auto shrink-0"
            >
              <button
                type="button"
                role="tab"
                aria-selected={active === "connections"}
                onClick={() => setActiveView("connections")}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-medium px-3 h-8 text-xs font-medium shrink-0 transition-colors",
                  active === "connections"
                    ? "bg-[var(--bg)] text-primary"
                    : "text-secondary hover:bg-control-subtle hover:text-primary",
                )}
              >
                <LayoutGridIcon className="size-3.5" aria-hidden="true" />
                Connections
              </button>
              {order.map((sessionId) => (
                <SessionTab key={sessionId} sessionId={sessionId} active={active === sessionId} />
              ))}
              <button
                type="button"
                aria-label="New local shell"
                title={`New local shell (${formatAccelerator(shortcuts.newLocalShell)})`}
                onClick={() => void openLocalShell()}
                className="flex size-8 items-center justify-center shrink-0 text-secondary hover:text-primary"
              >
                <SquareTerminalIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="New session"
                title="New session (⌘N)"
                onClick={openNewConnection}
                className="flex size-8 items-center justify-center shrink-0 text-secondary hover:text-primary"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 relative">
              <div className={cn("absolute inset-0", active !== "connections" && "hidden")}>
                <ConnectionManagerView />
              </div>
              {order.map((tabId) => {
                const toolId = parseToolTab(tabId);
                return (
                  <div key={tabId} className={cn("absolute inset-0", active !== tabId && "hidden")}>
                    {toolId ? (
                      <ToolView id={toolId} />
                    ) : (
                      <WorkspaceView sessionId={tabId} onPopOut={() => void popOutSession(tabId)} />
                    )}
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </TrafficLightInsetContext.Provider>

      <StatusBar />
      <CommandPalette />
    </div>
  );
}
