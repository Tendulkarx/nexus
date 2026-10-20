/**
 * Sessions view of the shell sidebar: saved connections grouped by folder.
 * Clicking a profile with an open session switches to its tab; otherwise it
 * asks ConnectionManagerView (always mounted by AppShell) to connect it, so
 * the password prompt and error handling stay in one place.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, ChevronRightIcon, LayoutGridIcon, SquareTerminalIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button, Input } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import { openLocalShell } from "@renderer/lib/local-shell";
import { getSession } from "@renderer/lib/sessions";
import { useOpenSessions, setActiveView } from "@renderer/lib/open-sessions-store";
import { NEW_CONNECTION_EVENT, CONNECT_PROFILE_EVENT, type ConnectProfileEventDetail } from "@renderer/lib/menu-events";
import { groupProfiles } from "./group-profiles";
import { SessionDot } from "./session-dot";
import { usePreferences } from "@renderer/lib/preferences";
import { formatAccelerator } from "@shared/shortcuts";

function connectProfile(profileId: string) {
  window.dispatchEvent(new CustomEvent<ConnectProfileEventDetail>(CONNECT_PROFILE_EVENT, { detail: { profileId } }));
}

function newConnection() {
  setActiveView("connections");
  window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
}

export function SessionsSidebar() {
  const [filter, setFilter] = React.useState("");
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const { order, active } = useOpenSessions();
  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => ipc.connections.list(),
  });

  const { profiles = [], folders = [] } = connectionsQuery.data ?? {};
  const groups = groupProfiles(profiles, folders, filter);

  // profileId → the first open sessionId for it (a profile can be opened twice).
  const openByProfile = new Map<string, string>();
  for (const sessionId of order) {
    const profileId = getSession(sessionId)?.profileId;
    if (profileId && !openByProfile.has(profileId)) openByProfile.set(profileId, sessionId);
  }

  function toggleGroup(key: string) {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <Input
          size="small"
          variant="filled"
          placeholder="Filter sessions…"
          aria-label="Filter sessions"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-0"
        />
        <Button variant="transparent" size="small" iconOnly onClick={newConnection} aria-label="New connection">
          <PlusIcon className="size-3.5" />
        </Button>
      </div>

      <div className="px-1.5 pb-1">
        <button
          type="button"
          onClick={() => void openLocalShell()}
          className="flex w-full items-center gap-2 rounded-medium px-2 py-1.5 text-sm text-left text-primary hover:bg-control-subtle"
        >
          <SquareTerminalIcon className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
          <span className="flex-1">Local shell</span>
          <kbd className="font-sans text-[11px] text-tertiary">
            {formatAccelerator(usePreferences().shortcuts.newLocalShell)}
          </kbd>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
        {connectionsQuery.isLoading ? null : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-secondary">
            {profiles.length === 0 ? "No saved connections yet." : "No sessions match that filter."}
          </p>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <div key={group.key} className="mb-2">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center gap-1 rounded-medium px-1.5 py-1 text-xs font-semibold text-secondary hover:text-primary"
                >
                  <ChevronRightIcon className={cn("size-3 transition-transform", !isCollapsed && "rotate-90")} />
                  <span className="flex-1 truncate text-left">{group.name}</span>
                  <span className="font-normal text-tertiary">{group.profiles.length}</span>
                </button>
                {!isCollapsed &&
                  group.profiles.map((profile) => {
                    const openSessionId = openByProfile.get(profile.id);
                    const selected = openSessionId !== undefined && openSessionId === active;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => (openSessionId ? setActiveView(openSessionId) : connectProfile(profile.id))}
                        title={`${profile.username}@${profile.host}:${profile.port}`}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-medium px-2 py-1.5 text-sm text-left transition-colors",
                          selected ? "bg-accent/15 text-primary" : "text-primary hover:bg-control-subtle",
                        )}
                      >
                        {openSessionId ? (
                          <SessionDot sessionId={openSessionId} className="size-2" />
                        ) : (
                          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-quaternary" />
                        )}
                        <span className="flex-1 min-w-0 truncate">{profile.name}</span>
                        {openSessionId && <span className="text-[11px] text-secondary">Open</span>}
                        <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase bg-control-subtle text-secondary">
                          {profile.protocol}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-separator p-2">
        <Button
          variant="transparent"
          size="small"
          className="w-full justify-start gap-2"
          onClick={() => setActiveView("connections")}
        >
          <LayoutGridIcon className="size-3.5" />
          Manage connections
        </Button>
      </div>
    </div>
  );
}
