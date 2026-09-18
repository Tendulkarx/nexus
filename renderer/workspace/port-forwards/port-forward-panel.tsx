/**
 * Port-forward management for an open SSH session: a form to start a new
 * local/remote rule, and a list of active rules with basic stats and a stop
 * button. Dynamic (-D / SOCKS) forwarding isn't implemented on the backend
 * yet, so it isn't offered here.
 */
import * as React from "react";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Field,
  FieldSet,
  ScrollArea,
  Text,
  Badge,
  Status,
  toast,
} from "@renderer/lib/ui";
import { PlusIcon, SquareIcon, ArrowRightIcon } from "lucide-react";
import { usePortForwards } from "@renderer/lib/use-port-forwards";
import type { PortForwardRule, PortForwardType } from "@shared/ipc-contract";

interface PortForwardPanelProps {
  sessionId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_LABEL: Record<PortForwardType, string> = {
  local: "Local (-L)",
  remote: "Remote (-R)",
  dynamic: "Dynamic (-D)",
};

function ForwardRow({ rule, onStop }: { rule: PortForwardRule; onStop: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-separator last:border-b-0">
      <Badge color={rule.type === "local" ? "blue" : "purple"} size="small">
        {TYPE_LABEL[rule.type]}
      </Badge>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Text variant="small" className="tabular-nums truncate">
          {rule.srcHost}:{rule.srcPort}
        </Text>
        <ArrowRightIcon className="size-3 text-tertiary shrink-0" />
        <Text variant="small" className="tabular-nums truncate">
          {rule.dstHost}:{rule.dstPort}
        </Text>
      </div>
      <Text variant="small" color="tertiary" className="tabular-nums shrink-0">
        {rule.connectionCount} conn · {formatBytes(rule.bytesIn)} in / {formatBytes(rule.bytesOut)} out
      </Text>
      {rule.state === "error" ? (
        <Badge color="red" size="small">Error</Badge>
      ) : (
        <Badge color="green" size="small">Listening</Badge>
      )}
      <Button variant="transparent" size="small" iconOnly onClick={() => onStop(rule.id)} aria-label="Stop forward">
        <SquareIcon className="size-3.5 text-secondary" />
      </Button>
    </div>
  );
}

export function PortForwardPanel({ sessionId }: PortForwardPanelProps) {
  const { rules, startForward, stopForward } = usePortForwards(sessionId);

  const [type, setType] = React.useState<PortForwardType>("local");
  const [srcHost, setSrcHost] = React.useState("127.0.0.1");
  const [srcPort, setSrcPort] = React.useState("");
  const [dstHost, setDstHost] = React.useState("");
  const [dstPort, setDstPort] = React.useState("");
  const [starting, setStarting] = React.useState(false);

  const isValid =
    srcPort.trim().length > 0 && dstHost.trim().length > 0 && dstPort.trim().length > 0;

  async function handleStart() {
    setStarting(true);
    try {
      await startForward({
        type,
        srcHost: srcHost.trim() || "127.0.0.1",
        srcPort: parseInt(srcPort, 10),
        dstHost: dstHost.trim(),
        dstPort: parseInt(dstPort, 10),
      });
      setSrcPort("");
      setDstHost("");
      setDstPort("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start port forward");
    } finally {
      setStarting(false);
    }
  }

  async function handleStop(id: string) {
    try {
      await stopForward(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop port forward");
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-separator shrink-0">
        <FieldSet title="New Forward" className="border-b-0 pb-0 mb-0">
          <Field label="Type" orientation="horizontal">
            <Select value={type} onValueChange={(v) => setType(v as PortForwardType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (-L)</SelectItem>
                <SelectItem value="remote">Remote (-R)</SelectItem>
                <SelectItem value="dynamic" disabled>
                  Dynamic / SOCKS (-D) — coming soon
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={type === "remote" ? "Bind on server" : "Listen on"}
            orientation="horizontal"
          >
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="127.0.0.1"
                value={srcHost}
                onChange={(e) => setSrcHost(e.target.value)}
                className="flex-1 min-w-0"
              />
              <Input
                type="number"
                placeholder="8080"
                value={srcPort}
                onChange={(e) => setSrcPort(e.target.value)}
                className="w-24 shrink-0"
              />
            </div>
          </Field>
          <Field label="Forward to" orientation="horizontal">
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="destination.internal"
                value={dstHost}
                onChange={(e) => setDstHost(e.target.value)}
                className="flex-1 min-w-0"
              />
              <Input
                type="number"
                placeholder="80"
                value={dstPort}
                onChange={(e) => setDstPort(e.target.value)}
                className="w-24 shrink-0"
              />
            </div>
          </Field>
          <div className="flex justify-end pt-1">
            <Button
              variant="accent"
              size="small"
              onClick={() => void handleStart()}
              disabled={!isValid || starting}
            >
              <PlusIcon className="size-3.5 mr-1" />
              {starting ? "Starting..." : "Start Forward"}
            </Button>
          </div>
        </FieldSet>
      </div>

      <ScrollArea className="flex-1 min-h-0" scrollbars="vertical">
        {rules.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <Text variant="small" color="tertiary">No active port forwards</Text>
          </div>
        ) : (
          rules.map((rule) => <ForwardRow key={rule.id} rule={rule} onStop={(id) => void handleStop(id)} />)
        )}
      </ScrollArea>

      <div className="px-4 py-2 border-t border-separator shrink-0">
        <Status variant="info">
          Dynamic (SOCKS) forwarding is not implemented yet — only local and remote forwards are available.
        </Status>
      </div>
    </div>
  );
}
