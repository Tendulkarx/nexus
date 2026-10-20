import {
  Text,
  Badge,
  Button,
} from "@renderer/lib/ui";
import {
  Loader2Icon,
  PlugIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import type { ConnectionProfileDTO } from "@shared/ipc-contract";
import { HealthDot, formatLastConnected } from "./connection-health";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

interface ProfileRowProps {
  profile: ConnectionProfileDTO;
  protocolColor: BadgeColor;
  connecting: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
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

export function ProfileRow({
  profile,
  protocolColor,
  connecting,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: ProfileRowProps) {
  async function handleRowMenu() {
    const CMD_EDIT = 1;
    const CMD_DUPLICATE = 2;
    const CMD_DELETE = 3;
    const result = await window.nexusAPI.Menu.popup({
      items: [
        { label: "Edit", commandId: CMD_EDIT },
        { label: "Duplicate", commandId: CMD_DUPLICATE },
        { type: "separator" },
        { label: "Delete", commandId: CMD_DELETE },
      ],
    });
    if (result.commandId === CMD_EDIT) onEdit();
    else if (result.commandId === CMD_DUPLICATE) onDuplicate();
    else if (result.commandId === CMD_DELETE) onDelete();
  }

  return (
    <div
      className="group flex w-full items-center gap-2 px-4 py-1.5 border-b border-separator/50 last:border-b-0 hover:bg-control-subtle transition-colors cursor-default"
      onDoubleClick={() => { if (!connecting) onConnect(); }}
    >
      <Badge color={protocolColor} size="small" className="shrink-0 w-14 justify-center">
        {PROTOCOL_LABELS[profile.protocol] ?? profile.protocol.toUpperCase()}
      </Badge>
      <Text variant="small-strong" truncate className="w-28 shrink-0">{profile.name}</Text>
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
        <Text variant="small" color="secondary" truncate className="flex-1 min-w-0 shrink tabular-nums">
          {profile.host}:{profile.port}
        </Text>
        <Text variant="small" color="tertiary" truncate className="flex-1 min-w-0 shrink">{profile.username}</Text>
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {profile.tags.map((tag) => (
            <Badge key={tag} color="secondary" size="small" className="shrink-0">{tag}</Badge>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 w-16 shrink-0">
        <HealthDot host={profile.host} port={profile.port} />
        <Text variant="small" color="tertiary" truncate>{formatLastConnected(profile.lastConnectedAt)}</Text>
      </div>
      <Button
        variant="transparent"
        size="small"
        iconOnly
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => void handleRowMenu()}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label="More actions"
      >
        <MoreHorizontalIcon className="size-3.5 text-secondary" />
      </Button>
      <Button
        variant="accent"
        size="small"
        className="shrink-0 w-24"
        onClick={onConnect}
        onDoubleClick={(e) => e.stopPropagation()}
        disabled={connecting}
      >
        {connecting ? <Loader2Icon className="size-3.5 animate-spin" /> : <PlugIcon className="size-3.5" />}
        {connecting ? "Connecting" : "Connect"}
      </Button>
    </div>
  );
}
