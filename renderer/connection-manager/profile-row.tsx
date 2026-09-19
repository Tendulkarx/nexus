import {
  Text,
  Badge,
  Button,
} from "@renderer/lib/ui";
import {
  Loader2Icon,
  EditIcon,
  Trash2Icon,
  PlugIcon,
  CopyIcon,
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
  return (
    <div
      className="group flex items-center gap-3 px-3 py-1 border-b border-separator/50 last:border-b-0 hover:bg-control-subtle transition-colors cursor-default"
      onDoubleClick={() => { if (!connecting) onConnect(); }}
    >
      <Badge color={protocolColor} size="small" className="shrink-0 w-14 justify-center">
        {PROTOCOL_LABELS[profile.protocol] ?? profile.protocol.toUpperCase()}
      </Badge>
      <Text variant="small-strong" truncate className="w-40 shrink-0">{profile.name}</Text>
      <Text variant="small" color="secondary" truncate className="w-48 shrink-0 tabular-nums">
        {profile.host}:{profile.port}
      </Text>
      <Text variant="small" color="tertiary" truncate className="w-28 shrink-0">{profile.username}</Text>
      <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        {profile.tags.map((tag) => (
          <Badge key={tag} color="secondary" size="small" className="shrink-0">{tag}</Badge>
        ))}
      </div>
      <div className="flex items-center gap-1.5 w-32 shrink-0">
        <HealthDot host={profile.host} port={profile.port} />
        <Text variant="small" color="tertiary" truncate>{formatLastConnected(profile.lastConnectedAt)}</Text>
      </div>
      <div
        className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Button variant="transparent" size="small" iconOnly onClick={onEdit} aria-label="Edit">
          <EditIcon className="size-3.5 text-secondary" />
        </Button>
        <Button variant="transparent" size="small" iconOnly onClick={onDuplicate} aria-label="Duplicate">
          <CopyIcon className="size-3.5 text-secondary" />
        </Button>
        <Button variant="transparent" size="small" iconOnly onClick={onDelete} aria-label="Delete">
          <Trash2Icon className="size-3.5 text-secondary" />
        </Button>
      </div>
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
