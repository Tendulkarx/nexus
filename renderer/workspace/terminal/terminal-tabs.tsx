/**
 * Terminal tabs within one session, each split into up to four panes (see
 * terminal-layout.ts). Every pane is its own shell. Tabs and panes are
 * local-only ids (terminal:open itself is async and creates the real backend
 * terminal) and stay mounted, so switching tabs never kills a shell.
 *
 * Split with the buttons on the tab bar or File › Split Right / Split Down
 * (⌘D / ⇧⌘D), which arrive as SPLIT_TERMINAL_EVENT and are handled only by
 * the visible TerminalTabs of the active session tab.
 */
import * as React from "react";
import { Columns2Icon, PlusIcon, Rows2Icon, XIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button, PanelGroup, Panel } from "@renderer/lib/ui";
import { useOpenSessions } from "@renderer/lib/open-sessions-store";
import { SPLIT_TERMINAL_EVENT, type SplitTerminalEventDetail } from "@renderer/lib/menu-events";
import { TerminalPane } from "./terminal-pane";
import { canSplit, closePane, singlePane, splitPane, type SplitDirection, type TabLayout } from "./terminal-layout";
import type { SessionInfo } from "@shared/ipc-contract";
import { usePreferences } from "@renderer/lib/preferences";
import { formatAccelerator } from "@shared/shortcuts";

interface TerminalTabsProps {
  session: SessionInfo;
  isVisible: boolean;
}

interface TerminalTab {
  id: string;
  label: string;
  layout: TabLayout;
}

let nextTabNumber = 1;

function newTab(): TerminalTab {
  return { id: crypto.randomUUID(), label: `Terminal ${nextTabNumber++}`, layout: singlePane(crypto.randomUUID()) };
}

export function TerminalTabs({ session, isVisible }: TerminalTabsProps) {
  const { shortcuts } = usePreferences();
  const [tabs, setTabs] = React.useState<TerminalTab[]>(() => [newTab()]);
  const [activeId, setActiveId] = React.useState<string>(() => tabs[0].id);
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const { order, active: activeView } = useOpenSessions();
  // In the main window only the active session tab takes ⌘D. A popped-out session window has no tab list
  // (the session isn't in its store), and there this terminal is the only one.
  const isFrontmost = isVisible && (order.includes(session.sessionId) ? activeView === session.sessionId : true);

  function addTab() {
    const tab = newTab();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id && next.length > 0) {
        setActiveId(next[idx] ? next[idx].id : next[next.length - 1].id);
      }
      return next;
    });
  }

  const updateLayout = (tabId: string, change: (layout: TabLayout) => TabLayout | null) =>
    setTabs((prev) =>
      prev.flatMap((t) => {
        if (t.id !== tabId) return [t];
        const layout = change(t.layout);
        return layout ? [{ ...t, layout }] : [];
      }),
    );

  const split = React.useCallback(
    (direction: SplitDirection) => updateLayout(activeTab.id, (l) => splitPane(l, direction, crypto.randomUUID())),
    [activeTab.id],
  );

  function removePane(tabId: string, paneId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.layout.panes.length === 1) closeTab(tabId);
    else updateLayout(tabId, (l) => closePane(l, paneId));
  }

  React.useEffect(() => {
    if (!isFrontmost) return;
    const handler = (e: Event) => split((e as CustomEvent<SplitTerminalEventDetail>).detail.direction);
    window.addEventListener(SPLIT_TERMINAL_EVENT, handler);
    return () => window.removeEventListener(SPLIT_TERMINAL_EVENT, handler);
  }, [isFrontmost, split]);

  return (
    <div className="terminal-surface h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 pt-1.5 bg-[var(--bg-secondary)] border-b border-separator shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "group flex items-center gap-1.5 rounded-t-medium px-2.5 py-1 text-xs shrink-0 transition-colors",
              activeId === tab.id ? "bg-[var(--bg)] text-primary" : "text-secondary hover:text-primary",
            )}
          >
            <span className="truncate max-w-[100px]">{tab.label}</span>
            {tab.layout.panes.length > 1 && (
              <span className="text-[10px] text-tertiary" aria-label={`${tab.layout.panes.length} panes`}>
                ×{tab.layout.panes.length}
              </span>
            )}
            {tabs.length > 1 && (
              <XIcon
                className="size-3 opacity-0 group-hover:opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              />
            )}
          </button>
        ))}
        <Button variant="transparent" size="small" iconOnly onClick={addTab} aria-label="New terminal">
          <PlusIcon className="size-3.5 text-secondary" />
        </Button>
        <div className="ml-auto flex items-center gap-0.5 pl-2">
          <Button
            variant="transparent"
            size="small"
            iconOnly
            disabled={!canSplit(activeTab.layout, "horizontal")}
            onClick={() => split("horizontal")}
            aria-label="Split right"
            title={`Split right (${formatAccelerator(shortcuts.splitRight)})`}
          >
            <Columns2Icon className="size-3.5 text-secondary" />
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            disabled={!canSplit(activeTab.layout, "vertical")}
            onClick={() => split("vertical")}
            aria-label="Split down"
            title={`Split down (${formatAccelerator(shortcuts.splitDown)})`}
          >
            <Rows2Icon className="size-3.5 text-secondary" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => {
          const multi = tab.layout.panes.length > 1;
          return (
            <div key={tab.id} className={cn("absolute inset-0", activeId !== tab.id && "hidden")}>
              <PanelGroup direction={tab.layout.direction} className="h-full">
                {tab.layout.panes.map((paneId, order) => (
                  <Panel key={paneId} id={paneId} order={order} minSize={120} className="min-h-0">
                    <div
                      className={cn(
                        "h-full",
                        multi && "border-t-2",
                        multi && (tab.layout.active === paneId ? "border-accent" : "border-transparent"),
                      )}
                      onMouseDown={() =>
                        tab.layout.active !== paneId && updateLayout(tab.id, (l) => ({ ...l, active: paneId }))
                      }
                    >
                      <TerminalPane
                        session={session}
                        isVisible={isVisible && activeId === tab.id}
                        onClose={multi ? () => removePane(tab.id, paneId) : undefined}
                      />
                    </div>
                  </Panel>
                ))}
              </PanelGroup>
            </div>
          );
        })}
      </div>
    </div>
  );
}
