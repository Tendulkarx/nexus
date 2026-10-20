import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "cmdk";
import {
  ServerIcon,
  PlusIcon,
  FolderPlusIcon,
  SettingsIcon,
  SunMoonIcon,
  LogOutIcon,
  Loader2Icon,
  HistoryIcon,
  ArrowRightLeftIcon,
  PlugIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { getPreferences } from "@renderer/lib/preferences";
import { eventMatches } from "@shared/shortcuts";
import { setSession, getSession } from "@renderer/lib/sessions";
import { addOpenSession, closeOpenSession, setActiveView, useOpenSessions } from "@renderer/lib/open-sessions-store";
import { NEW_CONNECTION_EVENT, NEW_FOLDER_EVENT, OPEN_PALETTE_EVENT } from "@renderer/lib/menu-events";
import { toggleTheme } from "@renderer/lib/theme-actions";
import { openLocalShell } from "@renderer/lib/local-shell";
import { openTool, parseToolTab, TOOL_IDS, TOOL_INFO } from "@renderer/tools/tool-tabs";
import { TOOL_ICONS } from "@renderer/tools/tool-view";
import { Badge, Dialog, Input, Text, toast } from "@renderer/lib/ui";
import type { ActivityLogEntry, ActivityLogEventType, ConnectionProfileDTO, Protocol } from "@shared/ipc-contract";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

function getProtocolColor(protocol: Protocol): BadgeColor {
  switch (protocol) {
    case "sftp": return "blue";
    case "ftp": return "green";
    case "ftps": return "purple";
    case "ssh": return "orange";
    case "rdp": return "magenta";
    case "vnc": return "red";
    case "mosh": return "yellow";
    case "telnet": return "secondary";
    case "serial": return "primary";
    default: return "secondary";
  }
}

const PROTOCOL_LABELS: Record<string, string> = {
  sftp: "SFTP",
  ftp: "FTP",
  ftps: "FTPS",
  ssh: "SSH",
  rdp: "RDP",
  vnc: "VNC",
  mosh: "Mosh",
  telnet: "Telnet",
  serial: "Serial",
};

function protocolLabel(protocol: Protocol): string {
  return PROTOCOL_LABELS[protocol] ?? protocol.toUpperCase();
}

const itemClassName =
  "flex items-center gap-2 rounded-medium px-2.5 py-2 text-sm text-secondary cursor-default select-none " +
  "data-[selected=true]:bg-accent/15 data-[selected=true]:text-accent " +
  "data-[disabled=true]:opacity-50 data-[disabled=true]:pointer-events-none";

const groupClassName =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs " +
  "[&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide " +
  "[&_[cmdk-group-heading]]:text-tertiary";

const ACTIVITY_ICONS: Record<ActivityLogEventType, React.ComponentType<{ className?: string }>> = {
  connect: PlugIcon,
  disconnect: PlugZapIcon,
  "transfer-done": ArrowRightLeftIcon,
  "transfer-error": ArrowRightLeftIcon,
  "sync-done": RefreshCwIcon,
};

function ActivityLogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const activityQuery = useQuery({
    queryKey: ["activityLog"],
    queryFn: () => ipc.activityLog.list(),
    enabled: open,
  });

  const entries = activityQuery.data?.entries ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Activity Log" size="medium">
      <div className="flex flex-col divide-y divide-separator">
        {entries.length === 0 && (
          <div className="px-4 py-8 text-center">
            <Text color="tertiary">
              {activityQuery.isLoading ? "Loading…" : "No activity recorded yet."}
            </Text>
          </div>
        )}
        {entries.map((entry: ActivityLogEntry) => {
          const Icon = ACTIVITY_ICONS[entry.type] ?? HistoryIcon;
          return (
            <div key={entry.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <Icon
                className={`size-3.5 shrink-0 mt-0.5 ${entry.type === "transfer-error" ? "text-destructive" : "text-tertiary"}`}
              />
              <div className="min-w-0 flex-1">
                <Text>{entry.message}</Text>
                {entry.detail && <Text color="tertiary" variant="small">{entry.detail}</Text>}
              </div>
              <Text color="tertiary" variant="small" className="shrink-0 whitespace-nowrap">
                {new Date(entry.timestamp).toLocaleString()}
              </Text>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = React.useState<{ profile: ConnectionProfileDTO; password: string } | null>(null);
  const [showActivityLog, setShowActivityLog] = React.useState(false);

  const { order, active } = useOpenSessions();

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => ipc.connections.list(),
    enabled: open,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Settings › Keyboard Shortcuts; capture phase so a focused terminal doesn't swallow it.
      if (!eventMatches(e, getPreferences().shortcuts.palette)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  React.useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_PALETTE_EVENT, handler);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, handler);
  }, []);

  const profiles = connectionsQuery.data?.profiles ?? [];

  async function connect(profile: ConnectionProfileDTO, secret?: string) {
    // VNC asks in its own viewer, and only if the server wants a login, so it doesn't need one up front.
    if (!secret && !profile.hasSecret && profile.authType === "password" && profile.protocol !== "vnc") {
      setOpen(false);
      setPasswordPrompt({ profile, password: "" });
      return;
    }
    setConnectingId(profile.id);
    try {
      const sessionInfo = await ipc.session.connect({ profileId: profile.id, secret: secret ?? undefined });
      setSession(sessionInfo);
      addOpenSession(sessionInfo.sessionId);
      setOpen(false);
      setPasswordPrompt(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnectingId(null);
    }
  }

  async function disconnectActiveSession() {
    if (active === "connections" || parseToolTab(active)) return;
    const sessionId = active;
    try {
      await ipc.session.disconnect({ sessionId });
    } catch {
      // best-effort
    }
    closeOpenSession(sessionId);
    setOpen(false);
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        label="Command Palette"
        loop
        overlayClassName="fixed inset-0 z-50 bg-black/40"
        contentClassName="fixed left-1/2 top-24 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-card border border-field bg-popover shadow-xl outline-none overflow-hidden"
      >
        <CommandInput
          autoFocus
          placeholder="Search connections, sessions, actions..."
          className="w-full border-b border-separator bg-transparent px-3.5 py-3 text-sm text-primary outline-none placeholder:text-tertiary"
        />
        <CommandList className="max-h-96 overflow-y-auto p-1.5">
          <CommandEmpty className="py-8 text-center text-sm text-tertiary">No results found.</CommandEmpty>

          {order.length > 0 && (
            <CommandGroup heading="Open Tabs" className={groupClassName}>
              {order.map((sessionId) => {
                const session = getSession(sessionId);
                const toolId = parseToolTab(sessionId);
                const label = toolId ? TOOL_INFO[toolId].name : (session?.name ?? sessionId);
                return (
                  <CommandItem
                    key={sessionId}
                    value={`${label} ${toolId ? "tool" : "session"}`}
                    className={itemClassName}
                    onSelect={() => {
                      setActiveView(sessionId);
                      setOpen(false);
                    }}
                  >
                    <ServerIcon className="size-3.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{label}</span>
                    {active === sessionId && (
                      <Badge color="secondary" size="small">Current</Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          <CommandGroup heading="Connections" className={groupClassName}>
            {profiles.map((profile) => (
              <CommandItem
                key={profile.id}
                value={`${profile.name} ${profile.host} ${protocolLabel(profile.protocol)}`}
                className={itemClassName}
                disabled={connectingId === profile.id}
                onSelect={() => void connect(profile)}
              >
                <ServerIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{profile.name}</span>
                <span className="min-w-0 truncate text-xs text-tertiary">{profile.host}</span>
                <span className="flex-1" />
                {connectingId === profile.id ? (
                  <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <Badge color={getProtocolColor(profile.protocol)} size="small" className="shrink-0">
                    {protocolLabel(profile.protocol)}
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator className="my-1 h-px bg-separator" />

          <CommandGroup heading="Tools" className={groupClassName}>
            {TOOL_IDS.map((id) => {
              const Icon = TOOL_ICONS[id];
              return (
                <CommandItem
                  key={id}
                  value={`${TOOL_INFO[id].name} tool ${TOOL_INFO[id].description}`}
                  className={itemClassName}
                  onSelect={() => {
                    openTool(id);
                    setOpen(false);
                  }}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{TOOL_INFO[id].name}</span>
                  <span className="text-xs text-tertiary truncate">{TOOL_INFO[id].description}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandSeparator className="my-1 h-px bg-separator" />

          <CommandGroup heading="Actions" className={groupClassName}>
            <CommandItem
              value="New Local Shell"
              className={itemClassName}
              onSelect={() => {
                setOpen(false);
                void openLocalShell();
              }}
            >
              <SquareTerminalIcon className="size-3.5 shrink-0" />
              New Local Shell
            </CommandItem>
            <CommandItem
              value="New Connection"
              className={itemClassName}
              onSelect={() => {
                setActiveView("connections");
                window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
                setOpen(false);
              }}
            >
              <PlusIcon className="size-3.5 shrink-0" />
              New Connection
            </CommandItem>
            <CommandItem
              value="New Folder"
              className={itemClassName}
              onSelect={() => {
                setActiveView("connections");
                window.dispatchEvent(new CustomEvent(NEW_FOLDER_EVENT));
                setOpen(false);
              }}
            >
              <FolderPlusIcon className="size-3.5 shrink-0" />
              New Folder
            </CommandItem>
            <CommandItem
              value="Open Settings"
              className={itemClassName}
              onSelect={() => {
                void window.nexusAPI.ipc.invoke("window:openSettings");
                setOpen(false);
              }}
            >
              <SettingsIcon className="size-3.5 shrink-0" />
              Open Settings
            </CommandItem>
            <CommandItem
              value="Toggle Theme"
              className={itemClassName}
              onSelect={() => {
                void toggleTheme();
                setOpen(false);
              }}
            >
              <SunMoonIcon className="size-3.5 shrink-0" />
              Toggle Theme
            </CommandItem>
            <CommandItem
              value="View Activity Log"
              className={itemClassName}
              onSelect={() => {
                setShowActivityLog(true);
                setOpen(false);
              }}
            >
              <HistoryIcon className="size-3.5 shrink-0" />
              View Activity Log
            </CommandItem>
            {active !== "connections" && (
              <CommandItem
                value="Disconnect Current Session"
                className={itemClassName}
                onSelect={() => void disconnectActiveSession()}
              >
                <LogOutIcon className="size-3.5 shrink-0" />
                Disconnect Current Session
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {passwordPrompt && (
        <Dialog
          open={!!passwordPrompt}
          onOpenChange={(o) => { if (!o) setPasswordPrompt(null); }}
          title={`Password for ${passwordPrompt.profile.name}`}
          size="small"
          confirmLabel={connectingId ? "Connecting..." : "Connect"}
          confirmDisabled={!!connectingId}
          onConfirm={() => void connect(passwordPrompt.profile, passwordPrompt.password)}
        >
          <div className="px-4 py-3">
            <Input
              autoFocus
              type="password"
              placeholder="Password"
              value={passwordPrompt.password}
              onChange={(e) =>
                setPasswordPrompt((prev) => (prev ? { ...prev, password: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void connect(passwordPrompt.profile, passwordPrompt.password);
              }}
            />
          </div>
        </Dialog>
      )}

      <ActivityLogDialog open={showActivityLog} onOpenChange={setShowActivityLog} />
    </>
  );
}
