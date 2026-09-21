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
  ShieldIcon,
  KeyIcon,
  ServerIcon,
  CopyIcon,
} from "lucide-react";
import type { ConnectionProfileDTO } from "@shared/ipc-contract";
import { cn } from "@renderer/lib/cn";
import { HealthDot, formatLastConnected } from "./connection-health";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

interface ProfileCardProps {
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
  mosh: "Mosh",
};

const PROTOCOL_BG: Record<string, string> = {
  sftp: "from-blue-500/20 to-blue-600/5",
  ftp: "from-green-500/20 to-green-600/5",
  ftps: "from-purple-500/20 to-purple-600/5",
  ssh: "from-orange-500/20 to-orange-600/5",
  rdp: "from-pink-500/20 to-pink-600/5",
  mosh: "from-yellow-500/20 to-yellow-600/5",
};

export function ProfileCard({
  profile,
  protocolColor,
  connecting,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: ProfileCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 p-4 rounded-card border border-field bg-gradient-to-br",
        PROTOCOL_BG[profile.protocol] ?? "from-fg/5 to-fg/0",
        "hover:border-separator transition-colors cursor-default",
      )}
      style={profile.color ? { borderLeft: `3px solid ${profile.color}` } : undefined}
      onDoubleClick={() => { if (!connecting) onConnect(); }}
    >
      {/* Protocol badge + host */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0 size-8 rounded-full bg-control flex items-center justify-center">
            <ServerIcon className="size-4 text-secondary" />
            {profile.color && (
              <span
                className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-bg"
                style={{ backgroundColor: profile.color }}
              />
            )}
          </div>
          <div className="min-w-0">
            <Text variant="strong" truncate as="p">{profile.name}</Text>
            <Text variant="small" color="secondary" truncate as="p">{profile.host}:{profile.port}</Text>
          </div>
        </div>
        <Badge color={protocolColor} size="small" className="shrink-0">
          {PROTOCOL_LABELS[profile.protocol] ?? profile.protocol.toUpperCase()}
        </Badge>
      </div>

      {/* User + auth */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldIcon className="size-3.5 text-tertiary shrink-0" />
          <Text variant="small" color="secondary" truncate>{profile.username}</Text>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <KeyIcon className="size-3.5 text-tertiary" />
          <Text variant="small" color="tertiary">
            {profile.authType === "key" ? "Key" : "Password"}
          </Text>
        </div>
      </div>

      {/* Health */}
      <div className="flex items-center gap-1.5">
        <HealthDot host={profile.host} port={profile.port} />
        <Text variant="small" color="tertiary">
          Last connected: {formatLastConnected(profile.lastConnectedAt)}
        </Text>
      </div>

      {/* Tags */}
      {profile.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {profile.tags.map((tag) => (
            <Badge key={tag} color="secondary" size="small">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1" onDoubleClick={(e) => e.stopPropagation()}>
        <Button
          variant="accent"
          size="small"
          className="flex-1"
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <Loader2Icon className="size-3.5 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <PlugIcon className="size-3.5" />
              Connect
            </>
          )}
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          onClick={onEdit}
          aria-label="Edit"
        >
          <EditIcon className="size-3.5 text-secondary" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          onClick={onDuplicate}
          aria-label="Duplicate"
        >
          <CopyIcon className="size-3.5 text-secondary" />
        </Button>
        <Button
          variant="transparent"
          size="small"
          iconOnly
          onClick={onDelete}
          aria-label="Delete"
        >
          <Trash2Icon className="size-3.5 text-secondary" />
        </Button>
      </div>
    </div>
  );
}
