import * as React from "react";
import { Input, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Text } from "@glaze/core/components";
import { ZapIcon, Loader2Icon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { Protocol, SessionInfo } from "@shared/ipc-contract";
import { toast } from "@glaze/core/components";

interface QuickConnectBarProps {
  onConnect: (sessionInfo: SessionInfo) => void;
}

const DEFAULT_PORTS: Record<Protocol, number> = {
  sftp: 22,
  ftp: 21,
  ftps: 990,
  ssh: 22,
};

export function QuickConnectBar({ onConnect }: QuickConnectBarProps) {
  const [protocol, setProtocol] = React.useState<Protocol>("sftp");
  const [host, setHost] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [port, setPort] = React.useState("22");
  const [isConnecting, setIsConnecting] = React.useState(false);

  React.useEffect(() => {
    setPort(String(DEFAULT_PORTS[protocol]));
  }, [protocol]);

  async function handleQuickConnect() {
    if (!host.trim() || !username.trim()) return;
    console.log("[QuickConnectBar:connect]", { protocol, host, username });
    setIsConnecting(true);
    try {
      const sessionInfo = await ipc.session.connect({
        inlineProfile: {
          name: `${username}@${host}`,
          protocol,
          host: host.trim(),
          port: parseInt(port, 10) || DEFAULT_PORTS[protocol],
          username: username.trim(),
          authType: "password",
          tags: [],
          folderId: null,
          defaultRemotePath: null,
          color: null,
          secret: password || undefined,
        },
        secret: password || undefined,
      });
      console.log("[QuickConnectBar:connected]", sessionInfo);
      onConnect(sessionInfo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      toast.error(`Quick connect: ${msg}`);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-separator bg-control-subtle/30">
      <ZapIcon className="size-3.5 text-accent shrink-0" />
      <Text variant="small" color="secondary" className="shrink-0">Quick Connect</Text>

      <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
        <SelectTrigger variant="filled" size="small" className="w-[72px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sftp">SFTP</SelectItem>
          <SelectItem value="ftp">FTP</SelectItem>
          <SelectItem value="ftps">FTPS</SelectItem>
          <SelectItem value="ssh">SSH</SelectItem>
        </SelectContent>
      </Select>

      <Input
        size="small"
        variant="filled"
        placeholder="hostname"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        className="flex-1 min-w-0"
        onKeyDown={(e) => { if (e.key === "Enter") void handleQuickConnect(); }}
      />
      <Input
        size="small"
        variant="filled"
        placeholder="port"
        value={port}
        onChange={(e) => setPort(e.target.value)}
        className="w-16 shrink-0"
      />
      <Input
        size="small"
        variant="filled"
        placeholder="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-28 shrink-0"
        onKeyDown={(e) => { if (e.key === "Enter") void handleQuickConnect(); }}
      />
      <Input
        size="small"
        variant="filled"
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-28 shrink-0"
        onKeyDown={(e) => { if (e.key === "Enter") void handleQuickConnect(); }}
      />

      <Button
        variant="accent"
        size="small"
        onClick={() => void handleQuickConnect()}
        disabled={isConnecting || !host.trim() || !username.trim()}
        className="shrink-0"
      >
        {isConnecting ? <Loader2Icon className="size-3.5 animate-spin" /> : "Connect"}
      </Button>
    </div>
  );
}
