import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  toast,
} from "@renderer/lib/ui";
import type { ConnectionProfileDTO, Folder, ConnectionInput, Protocol, AuthType } from "@shared/ipc-contract";
import { ipc } from "@renderer/lib/ipc";
import {
  FolderOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  TerminalSquareIcon,
  FolderSyncIcon,
  ServerIcon,
  ShieldCheckIcon,
  RadioTowerIcon,
  MonitorIcon,
  ScreenShareIcon,
  NetworkIcon,
  UsbIcon,
  RefreshCwIcon,
} from "lucide-react";
import { cn } from "@renderer/lib/cn";

const COLOR_SWATCHES = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
];

/** Protocols the session layer can open, in picker order, with what each gives you. */
const PROTOCOLS: { value: Protocol; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { value: "ssh", label: "SSH", hint: "Terminal, plus files", icon: TerminalSquareIcon },
    { value: "sftp", label: "SFTP", hint: "Files, plus terminal", icon: FolderSyncIcon },
    { value: "mosh", label: "Mosh", hint: "Roaming terminal", icon: RadioTowerIcon },
    { value: "rdp", label: "RDP", hint: "Windows desktop", icon: MonitorIcon },
    { value: "vnc", label: "VNC", hint: "Screen sharing", icon: ScreenShareIcon },
    { value: "ftp", label: "FTP", hint: "Files, unencrypted", icon: ServerIcon },
    { value: "ftps", label: "FTPS", hint: "Files over TLS", icon: ShieldCheckIcon },
    { value: "telnet", label: "Telnet", hint: "Terminal, unencrypted", icon: NetworkIcon },
    { value: "serial", label: "Serial", hint: "Console cable", icon: UsbIcon },
  ];

/** Common serial speeds; 115200 suits most dev boards, 9600 most network-gear consoles. */
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/** Protocols that sign in over SSH, so they support keys, jump hosts and the SSH options. */
const SSH_BASED: Protocol[] = ["ssh", "sftp", "mosh"];
/** Protocols that can tunnel through an SSH jump host. */
const JUMP_CAPABLE: Protocol[] = [...SSH_BASED, "vnc"];
/** Protocols with a remote filesystem, where a starting folder makes sense. */
const HAS_FILES: Protocol[] = ["ssh", "sftp", "ftp", "ftps"];

interface ConnectionFormProps {
  editProfile?: ConnectionProfileDTO;
  /** Pre-fill from an existing profile without editing it — always creates a new one, and never carries over the secret. */
  duplicateFrom?: ConnectionProfileDTO;
  folders: Folder[];
  /** `connect` is true when the user chose "Save & connect" (new profiles only). */
  onSave: (profile: ConnectionProfileDTO, options: { connect: boolean }) => void;
  onCancel: () => void;
}

const DEFAULT_PORTS: Record<Protocol, number> = {
  sftp: 22,
  ftp: 21,
  ftps: 990,
  ssh: 22,
  rdp: 3389,
  vnc: 5900,
  mosh: 22,
  telnet: 23,
  // A serial profile's "port" is its speed in baud.
  serial: 115200,
};

export function ConnectionForm({ editProfile, duplicateFrom, folders, onSave, onCancel }: ConnectionFormProps) {
  // duplicateFrom pre-fills the same fields editProfile would, but the form
  // still saves via create (below) rather than update, since editProfile is unset.
  const prefill = editProfile ?? duplicateFrom;

  const [name, setName] = React.useState(
    editProfile ? editProfile.name : duplicateFrom ? `${duplicateFrom.name} Copy` : "",
  );
  const [protocol, setProtocol] = React.useState<Protocol>(prefill?.protocol ?? "ssh");
  const [showMore, setShowMore] = React.useState(false);
  const connectAfterSave = React.useRef(false);
  const [host, setHost] = React.useState(prefill?.host ?? "");
  const [port, setPort] = React.useState(String(prefill?.port ?? 22));
  const [username, setUsername] = React.useState(prefill?.username ?? "");
  const [authType, setAuthType] = React.useState<AuthType>(prefill?.authType ?? "password");
  const [secret, setSecret] = React.useState("");
  const [privateKeyPath, setPrivateKeyPath] = React.useState(prefill?.privateKeyPath ?? "");
  const [folderId, setFolderId] = React.useState(prefill?.folderId ?? "");
  const [defaultRemotePath, setDefaultRemotePath] = React.useState(prefill?.defaultRemotePath ?? "");
  const [tags, setTags] = React.useState(prefill?.tags.join(", ") ?? "");
  const [color, setColor] = React.useState<string | null>(prefill?.color ?? null);

  const [agentForward, setAgentForward] = React.useState(prefill?.agentForward ?? false);
  const [x11Forward, setX11Forward] = React.useState(prefill?.x11Forward ?? false);
  const [onConnectCommand, setOnConnectCommand] = React.useState(prefill?.onConnectCommand ?? "");

  const [jumpEnabled, setJumpEnabled] = React.useState(Boolean(prefill?.jumpHost));
  const [jumpHostAddress, setJumpHostAddress] = React.useState(prefill?.jumpHost?.host ?? "");
  const [jumpPort, setJumpPort] = React.useState(String(prefill?.jumpHost?.port ?? 22));
  const [jumpUsername, setJumpUsername] = React.useState(prefill?.jumpHost?.username ?? "");
  const [jumpAuthType, setJumpAuthType] = React.useState<AuthType>(prefill?.jumpHost?.authType ?? "password");
  const [jumpSecret, setJumpSecret] = React.useState("");
  const [jumpPrivateKeyPath, setJumpPrivateKeyPath] = React.useState(prefill?.jumpHost?.privateKeyPath ?? "");

  // Auto-update port when protocol changes (not for edit/duplicate, which start from an existing port).
  React.useEffect(() => {
    if (!prefill) {
      setPort(String(DEFAULT_PORTS[protocol]));
    }
  }, [protocol, prefill]);

  const sshBased = SSH_BASED.includes(protocol);
  const isSerial = protocol === "serial";
  const serialPortsQuery = useQuery({
    queryKey: ["serial-ports"],
    queryFn: () => ipc.session.serialPorts(),
    enabled: isSerial,
  });
  const hasFiles = HAS_FILES.includes(protocol);
  const jumpCapable = JUMP_CAPABLE.includes(protocol);
  // Mosh carries no SSH channels after setup, so X11 only works over SSH/SFTP sessions.
  const supportsX11 = protocol === "ssh" || protocol === "sftp";
  const x11Query = useQuery({
    queryKey: ["x11-status"],
    queryFn: () => ipc.session.x11Status(),
    enabled: supportsX11 && x11Forward,
  });
  // Only SSH-based protocols can use a key; everything else signs in with a password.
  const effectiveAuth: AuthType = sshBased ? authType : "password";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input: ConnectionInput = {
        name: name.trim() || (isSerial ? host.trim().replace(/^\/dev\/cu\./, "") : host.trim()),
        protocol,
        host,
        port: parseInt(port, 10) || DEFAULT_PORTS[protocol],
        username: isSerial ? "" : username,
        authType: effectiveAuth,
        privateKeyPath: effectiveAuth === "key" ? privateKeyPath || null : null,
        folderId: folderId || null,
        defaultRemotePath: hasFiles ? defaultRemotePath || null : null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        color,
        secret: isSerial ? undefined : secret || undefined,
        agentForward: sshBased && agentForward,
        x11Forward: supportsX11 && x11Forward,
        onConnectCommand: sshBased ? onConnectCommand.trim() || null : null,
        jumpHost:
          jumpCapable && jumpEnabled
            ? {
                host: jumpHostAddress,
                port: parseInt(jumpPort, 10) || 22,
                username: jumpUsername,
                authType: jumpAuthType,
                privateKeyPath: jumpAuthType === "key" ? jumpPrivateKeyPath || null : null,
                secret: jumpSecret || undefined,
              }
            : null,
      };
      if (editProfile) {
        return ipc.connections.update({ id: editProfile.id, patch: input });
      }
      return ipc.connections.create({ input });
    },
    onSuccess: (profile) => {
      console.log("[ConnectionForm:save]", { id: profile.id, name: profile.name });
      onSave(profile, { connect: connectAfterSave.current });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function pickKeyFile() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: "Select Private Key",
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0 && result.filePaths[0]) {
      setPrivateKeyPath(result.filePaths[0]);
    }
  }

  async function pickJumpKeyFile() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: "Select Jump Host Private Key",
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0 && result.filePaths[0]) {
      setJumpPrivateKeyPath(result.filePaths[0]);
    }
  }

  const isValid =
    host.trim() &&
    // RDP and FTP servers can allow a blank user; SSH needs one.
    (!sshBased || username.trim()) &&
    (!isSerial || Number(port) > 0) &&
    (!jumpCapable || !jumpEnabled || (jumpHostAddress.trim() && jumpUsername.trim()));

  function save(connect: boolean) {
    connectAfterSave.current = connect;
    saveMutation.mutate();
  }

  const authToggle = (value: AuthType, set: (v: AuthType) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex rounded-medium bg-control-subtle p-0.5 w-fit">
      {(
        [
          ["password", "Password"],
          ["key", "Private key"],
        ] as const
      ).map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => set(v)}
          className={cn(
            "h-7 px-3 rounded-[6px] text-xs transition-colors",
            value === v ? "bg-[var(--bg)] text-primary shadow-sm" : "text-secondary hover:text-primary",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );

  const keyFileField = (value: string, set: (v: string) => void, pick: () => void, label: string) => (
    <div className="flex items-center gap-2 w-full">
      <Input
        placeholder="~/.ssh/id_ed25519"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="flex-1 min-w-0"
        aria-label={label}
      />
      <Button variant="filled" size="medium" iconOnly onClick={pick} aria-label={`Browse for ${label.toLowerCase()}`}>
        <FolderOpenIcon className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 px-4 py-4">
        <div role="radiogroup" aria-label="Protocol" className="grid grid-cols-4 gap-2">
          {PROTOCOLS.map(({ value, label, hint, icon: Icon }) => {
            const selected = protocol === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setProtocol(value)}
                className={cn(
                  "flex items-start gap-2.5 rounded-card border p-2.5 text-left transition-colors",
                  selected ? "border-accent bg-accent/10" : "border-separator hover:bg-control-subtle",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-accent" : "text-secondary")} />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-primary">{label}</span>
                  <span className="text-[11px] leading-4 text-secondary">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {isSerial ? (
          <FieldSet title="Port">
            <Field
              label="Device"
              description="Plug the adapter in first. Its name usually has usbserial in it."
              orientation="horizontal"
            >
              <div className="flex items-center gap-2 w-full">
                <Select value={host} onValueChange={setHost}>
                  <SelectTrigger className="flex-1 min-w-0">
                    <SelectValue
                      placeholder={serialPortsQuery.data?.length === 0 ? "No serial devices found" : "Choose a device"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Keep a saved device listed even while it's unplugged. */}
                    {[...new Set([...(host ? [host] : []), ...(serialPortsQuery.data ?? [])])].map((device) => (
                      <SelectItem key={device} value={device}>
                        {device.replace(/^\/dev\//, "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="filled"
                  size="medium"
                  iconOnly
                  onClick={() => void serialPortsQuery.refetch()}
                  aria-label="Look for devices again"
                >
                  <RefreshCwIcon className="size-4" />
                </Button>
              </div>
            </Field>
            <Field label="Speed" description="Baud rate, 8 data bits, no parity, 1 stop bit." orientation="horizontal">
              <Select value={port} onValueChange={setPort}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAUD_RATES.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {rate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Name" description="Optional. Defaults to the device." orientation="horizontal">
              <Input
                placeholder={host.replace(/^\/dev\/cu\./, "") || "Switch console"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </FieldSet>
        ) : (
          <FieldSet title="Server">
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2 py-2">
              <Field label="Host" className="py-0">
                <Input
                  autoFocus
                  placeholder="10.0.10.11 or server.example.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </Field>
              <Field label="Port" className="py-0">
                <Input
                  type="number"
                  placeholder={String(DEFAULT_PORTS[protocol])}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Name" description="Optional. Defaults to the host." orientation="horizontal">
              <Input placeholder={host.trim() || "My Server"} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </FieldSet>
        )}

        {!isSerial && (
          <FieldSet title="Sign in">
            <Field label="Username" orientation="horizontal">
              <Input
                placeholder={
                  protocol === "rdp"
                    ? "administrator"
                    : protocol === "vnc"
                      ? "Only for macOS Screen Sharing"
                      : protocol === "telnet"
                        ? "Optional. Typed in at the login prompt"
                        : "root"
                }
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            {sshBased && (
              <Field label="Method" orientation="horizontal">
                {authToggle(authType, setAuthType, "Sign-in method")}
              </Field>
            )}
            {effectiveAuth === "password" ? (
              <Field
                label={editProfile?.hasSecret ? "New password" : "Password"}
                description={
                  editProfile?.hasSecret
                    ? "Leave blank to keep the saved one."
                    : "Optional. Leave blank to be asked each time."
                }
                orientation="horizontal"
              >
                <Input
                  type="password"
                  placeholder={editProfile?.hasSecret ? "••••••••" : ""}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="Key file" orientation="horizontal">
                  {keyFileField(privateKeyPath, setPrivateKeyPath, () => void pickKeyFile(), "Private key file")}
                </Field>
                <Field label="Passphrase" description="Optional." orientation="horizontal">
                  <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
                </Field>
              </>
            )}
          </FieldSet>
        )}

        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary hover:text-secondary w-fit"
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", showMore && "rotate-90")} />
          More options
          {jumpCapable && jumpEnabled && !showMore && (
            <span className="normal-case font-normal">· via {jumpHostAddress || "jump host"}</span>
          )}
        </button>

        {showMore && (
          <div className="flex flex-col">
            {jumpCapable && (
              <FieldSet title="Jump host">
                <Field orientation="horizontal">
                  <label className="flex items-center gap-2 text-sm text-primary">
                    <input type="checkbox" checked={jumpEnabled} onChange={(e) => setJumpEnabled(e.target.checked)} />
                    Connect through a jump host (bastion)
                  </label>
                </Field>
                {jumpEnabled && (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2 py-2">
                      <Field label="Host" className="py-0">
                        <Input
                          placeholder="bastion.example.com"
                          value={jumpHostAddress}
                          onChange={(e) => setJumpHostAddress(e.target.value)}
                        />
                      </Field>
                      <Field label="Port" className="py-0">
                        <Input
                          type="number"
                          placeholder="22"
                          value={jumpPort}
                          onChange={(e) => setJumpPort(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Username" orientation="horizontal">
                      <Input
                        placeholder="admin"
                        value={jumpUsername}
                        onChange={(e) => setJumpUsername(e.target.value)}
                      />
                    </Field>
                    <Field label="Method" orientation="horizontal">
                      {authToggle(jumpAuthType, setJumpAuthType, "Jump host sign-in method")}
                    </Field>
                    {jumpAuthType === "password" ? (
                      <Field
                        label={editProfile?.jumpHost?.hasSecret ? "New password" : "Password"}
                        description={
                          editProfile?.jumpHost?.hasSecret ? "Leave blank to keep the saved one." : "Optional."
                        }
                        orientation="horizontal"
                      >
                        <Input
                          type="password"
                          placeholder={editProfile?.jumpHost?.hasSecret ? "••••••••" : ""}
                          value={jumpSecret}
                          onChange={(e) => setJumpSecret(e.target.value)}
                        />
                      </Field>
                    ) : (
                      <>
                        <Field label="Key file" orientation="horizontal">
                          {keyFileField(
                            jumpPrivateKeyPath,
                            setJumpPrivateKeyPath,
                            () => void pickJumpKeyFile(),
                            "Jump host key file",
                          )}
                        </Field>
                        <Field label="Passphrase" description="Optional." orientation="horizontal">
                          <Input type="password" value={jumpSecret} onChange={(e) => setJumpSecret(e.target.value)} />
                        </Field>
                      </>
                    )}
                  </>
                )}
              </FieldSet>
            )}

            {sshBased && (
              <FieldSet title="SSH">
                <Field orientation="horizontal">
                  <label className="flex items-center gap-2 text-sm text-primary">
                    <input type="checkbox" checked={agentForward} onChange={(e) => setAgentForward(e.target.checked)} />
                    Forward local SSH agent
                  </label>
                </Field>
                {supportsX11 && (
                  <Field orientation="horizontal">
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-2 text-sm text-primary">
                        <input type="checkbox" checked={x11Forward} onChange={(e) => setX11Forward(e.target.checked)} />
                        X11 forwarding: open remote GUI apps on this Mac
                      </label>
                      {x11Forward && x11Query.data && !x11Query.data.xquartzInstalled && (
                        <p className="text-xs text-secondary">
                          Needs XQuartz, which isn&apos;t installed. Get it from xquartz.org or run{" "}
                          <code className="font-mono">brew install --cask xquartz</code>, then log out and back in.
                        </p>
                      )}
                      {x11Forward && x11Query.data?.xquartzInstalled && !x11Query.data.display && (
                        <p className="text-xs text-secondary">
                          XQuartz is installed but not set up yet. Log out and back in once so it can register its
                          display.
                        </p>
                      )}
                    </div>
                  </Field>
                )}
                <Field
                  label="On connect"
                  description="Typed into each new terminal automatically. One command per line."
                  orientation="horizontal"
                >
                  <textarea
                    placeholder={"cd /var/www\ngit status"}
                    value={onConnectCommand}
                    onChange={(e) => setOnConnectCommand(e.target.value)}
                    rows={3}
                    className="w-full rounded-medium border border-field bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/40 placeholder:text-tertiary font-mono"
                  />
                </Field>
              </FieldSet>
            )}

            <FieldSet title="Organise">
              {folders.length > 0 && (
                <Field label="Folder" orientation="horizontal">
                  <Select value={folderId} onValueChange={setFolderId}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {hasFiles && (
                <Field label="Start folder" orientation="horizontal">
                  <Input
                    placeholder="/home/user"
                    value={defaultRemotePath}
                    onChange={(e) => setDefaultRemotePath(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Tags" description="Comma-separated" orientation="horizontal">
                <Input placeholder="production, web" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <Field label="Color" orientation="horizontal">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setColor(null)}
                    aria-label="No color"
                    className={cn(
                      "size-5 rounded-full border border-separator flex items-center justify-center",
                      color === null && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
                    )}
                  />
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setColor(swatch)}
                      aria-label={`Color ${swatch}`}
                      className={cn(
                        "size-5 rounded-full flex items-center justify-center",
                        color === swatch && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
                      )}
                      style={{ backgroundColor: swatch }}
                    >
                      {color === swatch && <CheckIcon className="size-3 text-white" />}
                    </button>
                  ))}
                </div>
              </Field>
            </FieldSet>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-separator">
        <Button variant="transparent" onClick={onCancel}>
          Cancel
        </Button>
        {editProfile ? (
          <Button variant="accent" onClick={() => save(false)} disabled={!isValid || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        ) : (
          <>
            <Button variant="filled" onClick={() => save(false)} disabled={!isValid || saveMutation.isPending}>
              Save
            </Button>
            <Button variant="accent" onClick={() => save(true)} disabled={!isValid || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save & connect"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
