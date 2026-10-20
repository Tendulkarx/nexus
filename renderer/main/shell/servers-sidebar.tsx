/**
 * Servers view of the shell sidebar: start and stop the local HTTP, TFTP,
 * SFTP and iperf3 servers (main/services/servers/). Settings are remembered
 * per server, except the SFTP password, which is generated each run and never
 * written to disk. A file server can't start until a folder is chosen, so
 * nothing is shared by accident.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, CopyIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button, Input, toast } from "@renderer/lib/ui";
import { usePersistedState } from "@renderer/lib/hooks";
import { ipc } from "@renderer/lib/ipc";
import type { LocalServerKind, LocalServerStatus } from "@shared/ipc-contract";

interface ServerSettings {
  port: string;
  rootDir: string;
  lan: boolean;
  allowWrites: boolean;
  username: string;
}

const SERVERS: { kind: LocalServerKind; name: string; description: string; defaults: ServerSettings }[] = [
  {
    kind: "http",
    name: "HTTP",
    description: "Share a folder read-only over the web",
    defaults: { port: "8000", rootDir: "", lan: true, allowWrites: false, username: "" },
  },
  {
    kind: "tftp",
    name: "TFTP",
    description: "Firmware and config files for network devices",
    defaults: { port: "69", rootDir: "", lan: true, allowWrites: false, username: "" },
  },
  {
    kind: "sftp",
    name: "SFTP",
    description: "Secure file sharing with a login",
    defaults: { port: "2222", rootDir: "", lan: true, allowWrites: false, username: "nexus" },
  },
  {
    kind: "iperf3",
    name: "iperf3",
    description: "Network speed tests (iperf3 -s)",
    defaults: { port: "5201", rootDir: "", lan: true, allowWrites: false, username: "" },
  },
];

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
}

function useServerStatuses(): Map<LocalServerKind, LocalServerStatus> {
  const query = useQuery({ queryKey: ["servers"], queryFn: () => ipc.servers.list() });
  const [live, setLive] = React.useState<Map<LocalServerKind, LocalServerStatus>>(new Map());
  React.useEffect(() => ipc.servers.onStatus((s) => setLive((prev) => new Map(prev).set(s.kind, s))), []);
  const merged = new Map((query.data ?? []).map((s) => [s.kind, s] as const));
  for (const [kind, s] of live) merged.set(kind, s);
  return merged;
}

/** The URL or command a client would use, for the copy button. */
function clientHint(kind: LocalServerKind, address: string, username: string): string {
  const [host, port] = address.split(":");
  switch (kind) {
    case "http":
      return `http://${address}/`;
    case "tftp":
      return port === "69" ? `tftp ${host}` : `tftp ${host} ${port}`;
    case "sftp":
      return `sftp -P ${port} ${username}@${host}`;
    case "iperf3":
      return `iperf3 -c ${host} -p ${port}`;
  }
}

function ServerCard({
  kind,
  name,
  description,
  defaults,
  status,
}: (typeof SERVERS)[number] & { status: LocalServerStatus | undefined }) {
  const [settings, setSettings] = usePersistedState<ServerSettings>(`servers:${kind}`, defaults);
  const [password, setPassword] = React.useState(randomPassword);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const running = status?.running ?? false;
  const needsFolder = kind !== "iperf3";
  const canStart = !needsFolder || settings.rootDir.trim() !== "";

  const set = (patch: Partial<ServerSettings>) => setSettings({ ...settings, ...patch });

  async function toggle() {
    setBusy(true);
    try {
      if (running) {
        await ipc.servers.stop({ kind });
      } else {
        const result = await ipc.servers.start({
          kind,
          port: Number(settings.port),
          rootDir: needsFolder ? settings.rootDir : null,
          lan: settings.lan,
          allowWrites: settings.allowWrites,
          username: kind === "sftp" ? settings.username : undefined,
          password: kind === "sftp" ? password : undefined,
        });
        if (result.error) setOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: `Folder to share over ${name}`,
      properties: ["openDirectory", "createDirectory"],
    });
    const dir = result.filePaths[0];
    if (!result.canceled && dir) set({ rootDir: dir });
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  }

  return (
    <div className="rounded-card border border-separator bg-[var(--bg)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-start gap-1.5 text-left"
        >
          <ChevronRightIcon
            className={cn("mt-0.5 size-3.5 shrink-0 text-tertiary transition-transform", open && "rotate-90")}
          />
          <span className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-primary">
              {name}{" "}
              <span className="font-mono text-[11px] font-normal text-secondary">
                :{status?.config?.port ?? settings.port}
              </span>
            </span>
            <span className="text-xs text-secondary truncate">
              {running ? "Running" : status?.error ? "Failed to start" : description}
            </span>
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={running}
          aria-label={`${running ? "Stop" : "Start"} ${name} server`}
          disabled={busy || (!running && !canStart)}
          title={!running && !canStart ? "Choose a folder to share first" : undefined}
          onClick={() => void toggle()}
          className="flex h-11 w-11 items-center justify-center disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className={cn("flex h-5 w-9 rounded-full transition-colors", running ? "bg-accent" : "bg-control")}
          >
            <span
              className={cn(
                "m-0.5 size-4 rounded-full bg-white shadow transition-transform",
                running && "translate-x-4",
              )}
            />
          </span>
        </button>
      </div>

      {running && status && (
        <div className="flex flex-col gap-1 px-3 pb-2.5">
          {status.addresses.map((address) => {
            const hint = clientHint(kind, address, status.config?.username ?? settings.username);
            return (
              <div key={address} className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 truncate rounded bg-control-subtle px-1.5 py-0.5 text-[11px] text-primary">
                  {hint}
                </code>
                <Button
                  variant="transparent"
                  size="small"
                  iconOnly
                  aria-label={`Copy ${hint}`}
                  onClick={() => copy(hint)}
                >
                  <CopyIcon className="size-3" />
                </Button>
              </div>
            );
          })}
          {kind === "sftp" && (
            <p className="text-xs text-secondary">
              Login <span className="font-mono text-primary">{status.config?.username}</span> /{" "}
              <span className="font-mono text-primary">{password}</span>
            </p>
          )}
        </div>
      )}

      {!running && status?.error && <p className="px-3 pb-2.5 text-xs text-support-red">{status.error}</p>}

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-separator px-3 py-3 text-xs text-secondary">
          <fieldset disabled={running} className="flex flex-col gap-2.5 disabled:opacity-60">
            {running && <p>Stop the server to change these.</p>}
            {needsFolder && (
              <label className="flex flex-col gap-1">
                Shared folder
                <div className="flex gap-1">
                  <Input
                    size="small"
                    value={settings.rootDir}
                    placeholder="Choose a folder…"
                    readOnly
                    onClick={() => void chooseFolder()}
                  />
                  <Button
                    size="small"
                    variant="filled"
                    iconOnly
                    aria-label="Choose folder"
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpenIcon className="size-3.5" />
                  </Button>
                </div>
              </label>
            )}
            <label className="flex flex-col gap-1">
              Port
              <Input
                size="small"
                type="number"
                min={1}
                max={65535}
                value={settings.port}
                onChange={(e) => set({ port: e.target.value })}
                className="w-24"
              />
            </label>
            <div role="radiogroup" aria-label="Reachable from" className="flex flex-col gap-1">
              Reachable from
              <div className="flex rounded-medium bg-control-subtle p-0.5 w-fit">
                {(
                  [
                    [true, "Local network"],
                    [false, "This Mac only"],
                  ] as const
                ).map(([lan, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={settings.lan === lan}
                    onClick={() => set({ lan })}
                    className={cn(
                      "h-6 px-2.5 rounded-[6px] transition-colors",
                      settings.lan === lan ? "bg-[var(--bg)] text-primary shadow-sm" : "text-secondary",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(kind === "tftp" || kind === "sftp") && (
              <label className="flex items-center gap-2 text-primary">
                <input
                  type="checkbox"
                  checked={settings.allowWrites}
                  onChange={(e) => set({ allowWrites: e.target.checked })}
                />
                {kind === "tftp" ? "Allow uploads (config backups)" : "Allow uploads and changes"}
              </label>
            )}
            {kind === "sftp" && (
              <div className="flex gap-2">
                <label className="flex flex-col gap-1 flex-1">
                  Username
                  <Input size="small" value={settings.username} onChange={(e) => set({ username: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  Password
                  <div className="flex gap-1">
                    <Input
                      size="small"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="font-mono"
                    />
                    <Button
                      size="small"
                      variant="filled"
                      iconOnly
                      aria-label="New password"
                      onClick={() => setPassword(randomPassword())}
                    >
                      <RefreshCwIcon className="size-3" />
                    </Button>
                  </div>
                </label>
              </div>
            )}
          </fieldset>
          {status && status.log.length > 0 && (
            <div className="flex flex-col gap-1">
              Activity
              <pre className="max-h-32 overflow-auto rounded bg-control-subtle p-2 font-mono text-[10px] leading-4 text-primary whitespace-pre-wrap">
                {status.log.slice(-12).join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ServersSidebar() {
  const statuses = useServerStatuses();
  return (
    <div className="flex flex-col gap-2 px-2 pb-3">
      {SERVERS.map((s) => (
        <ServerCard key={s.kind} {...s} status={statuses.get(s.kind)} />
      ))}
      <p className="px-1 text-[11px] leading-4 text-secondary">
        Servers stop when Nexus quits. macOS may ask once whether Nexus can accept incoming connections.
      </p>
    </div>
  );
}
