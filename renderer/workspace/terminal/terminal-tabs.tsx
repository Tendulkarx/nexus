/**
 * A strip of terminal instances within a single session — lets a user open
 * more than one shell against the same server. Each instance is a local-only
 * id (terminal:open itself is async and creates the real backend terminal),
 * kept mounted so switching tabs doesn't kill the shell.
 */
import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button } from "@renderer/lib/ui";
import { TerminalPane } from "./terminal-pane";
import type { SessionInfo } from "@shared/ipc-contract";

interface TerminalTabsProps {
  session: SessionInfo;
  isVisible: boolean;
}

interface TerminalTab {
  id: string;
  label: string;
}

let nextTabNumber = 1;

export function TerminalTabs({ session, isVisible }: TerminalTabsProps) {
  const [tabs, setTabs] = React.useState<TerminalTab[]>(() => [
    { id: crypto.randomUUID(), label: `Terminal ${nextTabNumber++}` },
  ]);
  const [activeId, setActiveId] = React.useState<string>(() => tabs[0].id);

  function addTab() {
    const tab: TerminalTab = { id: crypto.randomUUID(), label: `Terminal ${nextTabNumber++}` };
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

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a]">
      <div className="flex items-center gap-1 px-2 pt-1.5 border-b border-white/10 shrink-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 rounded-t-medium px-2.5 py-1 text-xs shrink-0 transition-colors",
                activeId === tab.id ? "bg-white/10 text-primary" : "text-tertiary hover:text-secondary",
              )}
            >
              <span className="truncate max-w-[100px]">{tab.label}</span>
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
            <PlusIcon className="size-3.5 text-tertiary" />
          </Button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div key={tab.id} className={cn("absolute inset-0", activeId !== tab.id && "hidden")}>
            <TerminalPane session={session} isVisible={isVisible && activeId === tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
