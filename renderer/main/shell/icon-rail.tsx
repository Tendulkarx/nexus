/**
 * Far-left icon rail that picks which view the shell's sidebar shows.
 * Clicking the view that's already active collapses the sidebar; clicking
 * any view while collapsed reopens it.
 */
import * as React from "react";
import { TerminalSquareIcon, FolderIcon, ArrowLeftRightIcon, WrenchIcon, ServerIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";

export type SidebarView = "sessions" | "files" | "tunnels" | "tools" | "servers";

const ITEMS: { id: SidebarView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "sessions", label: "Sessions", icon: TerminalSquareIcon },
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "tunnels", label: "SSH tunnels", icon: ArrowLeftRightIcon },
  { id: "tools", label: "Tools", icon: WrenchIcon },
  { id: "servers", label: "Local servers", icon: ServerIcon },
];

export const SIDEBAR_VIEW_LABEL: Record<SidebarView, string> = Object.fromEntries(
  ITEMS.map((i) => [i.id, i.label]),
) as Record<SidebarView, string>;

interface IconRailProps {
  view: SidebarView;
  collapsed: boolean;
  onSelect: (view: SidebarView) => void;
}

export function IconRail({ view, collapsed, onSelect }: IconRailProps) {
  return (
    <nav
      aria-label="Sidebar views"
      className="flex flex-col items-center gap-1 w-14 shrink-0 py-2 bg-chrome border-r border-separator"
    >
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const active = view === id && !collapsed;
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => onSelect(id)}
            className={cn(
              "flex size-10 items-center justify-center rounded-medium transition-colors",
              active ? "bg-accent/15 text-accent" : "text-secondary hover:bg-control-subtle hover:text-primary",
            )}
          >
            <Icon className="size-[18px]" />
          </button>
        );
      })}
    </nav>
  );
}
