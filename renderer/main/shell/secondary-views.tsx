/**
 * Sidebar views other than Sessions. Tunnels reuses the existing per-session
 * PortForwardPanel; Files falls back to a note when no file session is
 * active; Tools opens tool tabs. Servers lives in servers-sidebar.tsx.
 */
import type { ReactNode } from "react";
import { PortForwardPanel } from "@renderer/workspace/port-forwards/port-forward-panel";
import { getSession } from "@renderer/lib/sessions";
import { useOpenSessions } from "@renderer/lib/open-sessions-store";
import type { SessionInfo } from "@shared/ipc-contract";
import { openTool, TOOL_IDS, TOOL_INFO } from "@renderer/tools/tool-tabs";
import { TOOL_ICONS } from "@renderer/tools/tool-view";

function useActiveSession(): SessionInfo | undefined {
  const { active } = useOpenSessions();
  return active === "connections" ? undefined : getSession(active);
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2 text-xs leading-5 text-secondary">
      <p className="mb-1 text-sm font-medium text-primary">{title}</p>
      {children}
    </div>
  );
}

export function TunnelsSidebar() {
  const session = useActiveSession();
  // Same condition WorkspaceView uses for its forwards panel: only SSH-backed file sessions can forward.
  if (!session || session.kind !== "file" || !session.supportsTerminal) {
    return (
      <Note title="No SSH session selected">
        Open an SSH or SFTP session tab to start local (-L) or remote (-R) forwards through it.
      </Note>
    );
  }
  return <PortForwardPanel sessionId={session.sessionId} />;
}

/**
 * Fallback for the Files view. When the active tab is a file session, its
 * WorkspaceView portals a live remote browser into the slot below this in
 * AppShell, and this renders nothing.
 */
export function FilesSidebar() {
  const session = useActiveSession();
  if (session?.kind === "file") return null;
  return <Note title="No file session selected">Open an SFTP, SSH or FTP session tab to browse its files here.</Note>;
}

export function ToolsSidebar() {
  return (
    <div className="flex flex-col gap-1 px-1.5 pb-2">
      {TOOL_IDS.map((id) => {
        const Icon = TOOL_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => openTool(id)}
            className="flex items-start gap-2.5 rounded-medium px-2 py-2 text-left hover:bg-control-subtle"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-sm text-primary">{TOOL_INFO[id].name}</span>
              <span className="text-xs text-secondary">{TOOL_INFO[id].description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
