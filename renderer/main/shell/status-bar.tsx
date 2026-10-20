/**
 * Bottom status bar: what the active tab is connected to, plus app-wide
 * state that's otherwise easy to miss (open session count, multi-exec).
 */
import { RadioIcon } from "lucide-react";
import { getSession } from "@renderer/lib/sessions";
import { useOpenSessions } from "@renderer/lib/open-sessions-store";
import { useBroadcastGroup } from "@renderer/lib/terminal-broadcast-store";
import { parseToolTab, TOOL_INFO } from "@renderer/tools/tool-tabs";

const KIND_LABEL = { file: "Files + terminal", display: "Remote desktop", terminal: "Terminal" } as const;

export function StatusBar() {
  const { order, active } = useOpenSessions();
  const broadcast = useBroadcastGroup();
  const session = active === "connections" ? undefined : getSession(active);
  const toolId = parseToolTab(active);
  const sessionCount = order.filter((id) => !parseToolTab(id)).length;

  const items = session
    ? [session.protocol.toUpperCase(), `${session.username ? `${session.username}@` : ""}${session.host}`, KIND_LABEL[session.kind]]
    : [toolId ? TOOL_INFO[toolId].name : "Connections"];
  items.push(`${sessionCount} open session${sessionCount === 1 ? "" : "s"}`);

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1 border-t border-separator bg-chrome text-[11px] text-secondary shrink-0">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
      {broadcast.size > 0 && (
        <span className="ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 bg-support-red/15 text-primary">
          <RadioIcon className="size-3" aria-hidden="true" />
          Multi-exec: typing goes to {broadcast.size} terminal{broadcast.size === 1 ? "" : "s"}
        </span>
      )}
    </footer>
  );
}
