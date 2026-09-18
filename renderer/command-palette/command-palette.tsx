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
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { setSession, getSession } from "@renderer/lib/sessions";
import { addOpenSession, closeOpenSession, setActiveView, useOpenSessions } from "@renderer/lib/open-sessions-store";
import { NEW_CONNECTION_EVENT, NEW_FOLDER_EVENT } from "@renderer/lib/menu-events";
import { Badge, Dialog, Input, toast } from "@renderer/lib/ui";
import type { ConnectionProfileDTO, Protocol } from "@shared/ipc-contract";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

function getProtocolColor(protocol: Protocol): BadgeColor {
  switch (protocol) {
    case "sftp": return "blue";
    case "ftp": return "green";
    case "ftps": return "purple";
    case "ssh": return "orange";
    case "rdp": return "magenta";
    default: return "secondary";
  }
}

const PROTOCOL_LABELS: Record<string, string> = {
  sftp: "SFTP",
  ftp: "FTP",
  ftps: "FTPS",
  ssh: "SSH",
  rdp: "RDP",
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

async function toggleTheme(): Promise<void> {
  const info = await window.nexusAPI.nativeTheme.getInfo();
  await window.nexusAPI.nativeTheme.setThemeSource(info.shouldUseDarkColors ? "light" : "dark");
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = React.useState<{ profile: ConnectionProfileDTO; password: string } | null>(null);

  const { order, active } = useOpenSessions();

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => ipc.connections.list(),
    enabled: open,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const profiles = connectionsQuery.data?.profiles ?? [];

  async function connect(profile: ConnectionProfileDTO, secret?: string) {
    if (!secret && !profile.hasSecret && profile.authType === "password") {
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
    if (active === "connections") return;
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
            <CommandGroup heading="Open Sessions" className={groupClassName}>
              {order.map((sessionId) => {
                const session = getSession(sessionId);
                return (
                  <CommandItem
                    key={sessionId}
                    value={`${session?.name ?? sessionId} session`}
                    className={itemClassName}
                    onSelect={() => {
                      setActiveView(sessionId);
                      setOpen(false);
                    }}
                  >
                    <ServerIcon className="size-3.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{session?.name ?? sessionId}</span>
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

          <CommandGroup heading="Actions" className={groupClassName}>
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
    </>
  );
}
