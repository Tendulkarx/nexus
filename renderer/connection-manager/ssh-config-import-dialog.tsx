/**
 * Picker for importing entries from the user's ~/.ssh/config as connection
 * profiles. Parsing happens on the backend (main/services/ssh-config-parser.ts);
 * "Import Selected" creates each chosen host through the same
 * connections:create path used by the manual connection form. When a host's
 * ProxyJump target is also selected in this batch, the created profile's
 * jumpHost is wired to it automatically.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, Checkbox, Text, toast } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { ConnectionInput, SshConfigHost } from "@shared/ipc-contract";

interface SshConfigImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function buildProfileInput(host: SshConfigHost, jumpTarget: SshConfigHost | undefined): ConnectionInput {
  const authType = host.identityFile ? "key" : "password";
  return {
    name: host.alias,
    protocol: "ssh",
    host: host.hostName || host.alias,
    port: host.port ?? 22,
    username: host.user ?? "",
    authType,
    privateKeyPath: authType === "key" ? (host.identityFile ?? null) : null,
    folderId: null,
    tags: [],
    defaultRemotePath: null,
    color: null,
    agentForward: false,
    onConnectCommand: null,
    jumpHost: jumpTarget
      ? {
          host: jumpTarget.hostName || jumpTarget.alias,
          port: jumpTarget.port ?? 22,
          username: jumpTarget.user ?? "",
          authType: jumpTarget.identityFile ? "key" : "password",
          privateKeyPath: jumpTarget.identityFile ?? null,
        }
      : null,
  };
}

export function SshConfigImportDialog({ open, onOpenChange }: SshConfigImportDialogProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const hostsQuery = useQuery({
    queryKey: ["ssh-config-hosts"],
    queryFn: () => ipc.sshConfig.list(),
    enabled: open,
  });

  const hosts = React.useMemo(() => hostsQuery.data?.hosts ?? [], [hostsQuery.data]);

  React.useEffect(() => {
    if (open && hostsQuery.data) {
      setSelected(new Set(hostsQuery.data.hosts.map((h) => h.alias)));
    }
  }, [open, hostsQuery.data]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const byAlias = new Map(hosts.map((h) => [h.alias, h] as const));
      const chosen = hosts.filter((h) => selected.has(h.alias));
      let imported = 0;
      for (const host of chosen) {
        const jumpTarget =
          host.proxyJump && selected.has(host.proxyJump) ? byAlias.get(host.proxyJump) : undefined;
        await ipc.connections.create({ input: buildProfileInput(host, jumpTarget) });
        imported++;
      }
      return imported;
    },
    onSuccess: (imported) => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      onOpenChange(false);
      toast.success(`Imported ${imported} connection${imported === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggle(alias: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import from ~/.ssh/config"
      size="medium"
      confirmLabel={importMutation.isPending ? "Importing..." : "Import Selected"}
      confirmDisabled={selected.size === 0 || importMutation.isPending}
      onConfirm={() => importMutation.mutate()}
    >
      {hostsQuery.isPending ? (
        <div className="p-4">
          <Text color="secondary">Reading ~/.ssh/config...</Text>
        </div>
      ) : hosts.length === 0 ? (
        <div className="p-4">
          <Text color="secondary">No importable hosts found in ~/.ssh/config.</Text>
        </div>
      ) : (
        <div className="flex flex-col">
          {hosts.map((host) => (
            <label
              key={host.alias}
              className="flex items-start gap-2.5 px-4 py-2.5 border-b border-separator last:border-b-0 cursor-pointer"
            >
              <Checkbox
                checked={selected.has(host.alias)}
                onCheckedChange={() => toggle(host.alias)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <Text variant="strong" truncate>{host.alias}</Text>
                <Text variant="small" color="tertiary" truncate>
                  {host.user ? `${host.user}@` : ""}
                  {host.hostName ?? host.alias}
                  {host.port ? `:${host.port}` : ""}
                  {host.identityFile ? ` · key: ${host.identityFile}` : ""}
                  {host.proxyJump ? ` · via ${host.proxyJump}` : ""}
                </Text>
              </div>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}
