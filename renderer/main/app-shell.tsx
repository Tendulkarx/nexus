/**
 * App-level shell replacing single-route "/workspace/$sessionId" navigation.
 * Keeps every open session's WorkspaceView mounted (visibility toggled, not
 * unmounted) so terminal/file state survives switching tabs, and renders a
 * persistent tab strip once at least one session is open.
 */
import * as React from "react";
import { XIcon, ServerIcon, CommandIcon, SettingsIcon, SunMoonIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button } from "@renderer/lib/ui";
import { getSession, removeSession } from "@renderer/lib/sessions";
import { useOpenSessions, closeOpenSession, setActiveView } from "@renderer/lib/open-sessions-store";
import { ipc } from "@renderer/lib/ipc";
import { NEW_CONNECTION_EVENT, OPEN_PALETTE_EVENT } from "@renderer/lib/menu-events";
import { toggleTheme } from "@renderer/lib/theme-actions";
import { ConnectionManagerView } from "@renderer/connection-manager/connection-manager-view";
import { WorkspaceView } from "@renderer/workspace/workspace-view";
import { CommandPalette } from "@renderer/command-palette/command-palette";

function SessionTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const session = getSession(sessionId);

  async function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await ipc.session.disconnect({ sessionId });
    } catch {
      // best-effort
    }
    removeSession(sessionId);
    closeOpenSession(sessionId);
  }

  return (
    <button
      type="button"
      onClick={() => setActiveView(sessionId)}
      className={cn(
        "no-drag group flex items-center gap-1.5 rounded-medium px-2.5 py-1 text-xs max-w-[180px] shrink-0 transition-colors",
        active ? "bg-control text-primary" : "text-secondary hover:bg-control-subtle hover:text-primary",
      )}
    >
      <ServerIcon className="size-3 shrink-0" />
      <span className="truncate">{session?.name ?? sessionId}</span>
      <XIcon
        className="size-3 shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100"
        onClick={(e) => void handleClose(e)}
      />
    </button>
  );
}

export function AppShell() {
  const { order, active } = useOpenSessions();

  React.useEffect(() => {
    const off = window.nexusAPI.ipc.on("menu:action", (_event, action) => {
      if (action === "new-connection") {
        setActiveView("connections");
        window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
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
      const sessionId = active;
      void ipc.session.disconnect({ sessionId }).catch(() => {});
      removeSession(sessionId);
      closeOpenSession(sessionId);
    });
    return off;
  }, [active]);

  if (order.length === 0) {
    // No sessions open yet — same full-height connection manager as before,
    // complete with its own drag-region/traffic-light padding.
    return (
      <>
        <ConnectionManagerView />
        <CommandPalette />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="drag-region flex items-center gap-1 pl-20 pr-2 py-1.5 border-b border-separator shrink-0">
        <button
          type="button"
          onClick={() => setActiveView("connections")}
          className={cn(
            "no-drag rounded-medium px-2.5 py-1 text-xs font-medium shrink-0 transition-colors",
            active === "connections"
              ? "bg-control text-primary"
              : "text-secondary hover:bg-control-subtle hover:text-primary",
          )}
        >
          Connections
        </button>
        <div className="flex items-center gap-1 overflow-x-auto no-drag">
          {order.map((sessionId) => (
            <SessionTab key={sessionId} sessionId={sessionId} active={active === sessionId} />
          ))}
        </div>
        <div className="flex-1 min-w-2" />
        <div className="no-drag flex items-center gap-1 shrink-0">
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
            aria-label="Open command palette"
          >
            <CommandIcon className="size-3.5" />
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
      </div>

      <div className="flex-1 min-h-0 relative">
        <div
          className={cn("absolute inset-0", active !== "connections" && "hidden")}
        >
          <ConnectionManagerView />
        </div>
        {order.map((sessionId) => (
          <div key={sessionId} className={cn("absolute inset-0", active !== sessionId && "hidden")}>
            <WorkspaceView sessionId={sessionId} />
          </div>
        ))}
      </div>

      <CommandPalette />
    </div>
  );
}
