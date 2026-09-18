import * as React from "react";
import { useMutation } from "@tanstack/react-query";
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
import { FolderOpenIcon, CheckIcon } from "lucide-react";
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

interface ConnectionFormProps {
  editProfile?: ConnectionProfileDTO;
  /** Pre-fill from an existing profile without editing it — always creates a new one, and never carries over the secret. */
  duplicateFrom?: ConnectionProfileDTO;
  folders: Folder[];
  onSave: (profile: ConnectionProfileDTO) => void;
  onCancel: () => void;
}

const DEFAULT_PORTS: Record<Protocol, number> = {
  sftp: 22,
  ftp: 21,
  ftps: 990,
  ssh: 22,
  rdp: 3389,
};

export function ConnectionForm({ editProfile, duplicateFrom, folders, onSave, onCancel }: ConnectionFormProps) {
  // duplicateFrom pre-fills the same fields editProfile would, but the form
  // still saves via create (below) rather than update, since editProfile is unset.
  const prefill = editProfile ?? duplicateFrom;

  const [name, setName] = React.useState(
    editProfile ? editProfile.name : duplicateFrom ? `${duplicateFrom.name} Copy` : "",
  );
  const [protocol, setProtocol] = React.useState<Protocol>(prefill?.protocol ?? "sftp");
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input: ConnectionInput = {
        name,
        protocol,
        host,
        port: parseInt(port, 10) || DEFAULT_PORTS[protocol],
        username,
        authType,
        privateKeyPath: authType === "key" ? (privateKeyPath || null) : null,
        folderId: folderId || null,
        defaultRemotePath: defaultRemotePath || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        color,
        secret: secret || undefined,
        jumpHost: jumpEnabled
          ? {
              host: jumpHostAddress,
              port: parseInt(jumpPort, 10) || 22,
              username: jumpUsername,
              authType: jumpAuthType,
              privateKeyPath: jumpAuthType === "key" ? (jumpPrivateKeyPath || null) : null,
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
      onSave(profile);
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
    name.trim() &&
    host.trim() &&
    username.trim() &&
    (!jumpEnabled || (jumpHostAddress.trim() && jumpUsername.trim()));

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0 px-4 py-3">
        <FieldSet title="General">
          <Field label="Name" orientation="horizontal">
            <Input
              autoFocus
              placeholder="My Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Protocol" orientation="horizontal">
            <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sftp">SFTP</SelectItem>
                <SelectItem value="ftp">FTP</SelectItem>
                <SelectItem value="ftps">FTPS</SelectItem>
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="rdp">RDP (Remote Desktop)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Host" orientation="horizontal">
            <Input
              placeholder="example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </Field>
          <Field label="Port" orientation="horizontal">
            <Input
              type="number"
              placeholder="22"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </Field>
        </FieldSet>

        <FieldSet title="Authentication">
          <Field label="Username" orientation="horizontal">
            <Input
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Auth Type" orientation="horizontal">
            <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="key">Private Key</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {authType === "password" ? (
            <Field
              label={editProfile?.hasSecret ? "New password (leave blank to keep)" : "Password"}
              orientation="horizontal"
            >
              <Input
                type="password"
                placeholder={editProfile?.hasSecret ? "••••••••" : "optional"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="Private Key" orientation="horizontal">
                <div className="flex items-center gap-2 w-full">
                  <Input
                    placeholder="/Users/you/.ssh/id_rsa"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    variant="filled"
                    size="medium"
                    iconOnly
                    onClick={() => void pickKeyFile()}
                    aria-label="Browse for key file"
                  >
                    <FolderOpenIcon className="size-4" />
                  </Button>
                </div>
              </Field>
              <Field label="Passphrase" orientation="horizontal">
                <Input
                  type="password"
                  placeholder="optional"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
            </>
          )}
        </FieldSet>

        {(protocol === "sftp" || protocol === "ssh") && (
          <FieldSet title="Jump Host (Bastion)">
            <Field orientation="horizontal">
              <label className="flex items-center gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={jumpEnabled}
                  onChange={(e) => setJumpEnabled(e.target.checked)}
                />
                Connect through a jump host
              </label>
            </Field>

            {jumpEnabled && (
              <>
                <Field label="Host" orientation="horizontal">
                  <Input
                    placeholder="bastion.example.com"
                    value={jumpHostAddress}
                    onChange={(e) => setJumpHostAddress(e.target.value)}
                  />
                </Field>
                <Field label="Port" orientation="horizontal">
                  <Input
                    type="number"
                    placeholder="22"
                    value={jumpPort}
                    onChange={(e) => setJumpPort(e.target.value)}
                  />
                </Field>
                <Field label="Username" orientation="horizontal">
                  <Input
                    placeholder="admin"
                    value={jumpUsername}
                    onChange={(e) => setJumpUsername(e.target.value)}
                  />
                </Field>
                <Field label="Auth Type" orientation="horizontal">
                  <Select value={jumpAuthType} onValueChange={(v) => setJumpAuthType(v as AuthType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="key">Private Key</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {jumpAuthType === "password" ? (
                  <Field
                    label={editProfile?.jumpHost?.hasSecret ? "New password (leave blank to keep)" : "Password"}
                    orientation="horizontal"
                  >
                    <Input
                      type="password"
                      placeholder={editProfile?.jumpHost?.hasSecret ? "••••••••" : "optional"}
                      value={jumpSecret}
                      onChange={(e) => setJumpSecret(e.target.value)}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Private Key" orientation="horizontal">
                      <div className="flex items-center gap-2 w-full">
                        <Input
                          placeholder="/Users/you/.ssh/id_rsa"
                          value={jumpPrivateKeyPath}
                          onChange={(e) => setJumpPrivateKeyPath(e.target.value)}
                          className="flex-1 min-w-0"
                        />
                        <Button
                          variant="filled"
                          size="medium"
                          iconOnly
                          onClick={() => void pickJumpKeyFile()}
                          aria-label="Browse for jump host key file"
                        >
                          <FolderOpenIcon className="size-4" />
                        </Button>
                      </div>
                    </Field>
                    <Field label="Passphrase" orientation="horizontal">
                      <Input
                        type="password"
                        placeholder="optional"
                        value={jumpSecret}
                        onChange={(e) => setJumpSecret(e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </>
            )}
          </FieldSet>
        )}

        <FieldSet title="Options">
          {folders.length > 0 && (
            <Field label="Folder" orientation="horizontal">
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Default remote path" orientation="horizontal">
            <Input
              placeholder="/home/user"
              value={defaultRemotePath}
              onChange={(e) => setDefaultRemotePath(e.target.value)}
            />
          </Field>
          <Field label="Tags" description="Comma-separated" orientation="horizontal">
            <Input
              placeholder="production, web"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
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

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-separator">
        <Button variant="filled" onClick={onCancel}>Cancel</Button>
        <Button
          variant="accent"
          onClick={() => saveMutation.mutate()}
          disabled={!isValid || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : editProfile ? "Save Changes" : "Add Connection"}
        </Button>
      </div>

    </div>
  );
}
