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
} from "@glaze/core/components";
import type { ConnectionProfileDTO, Folder, ConnectionInput, Protocol, AuthType } from "@shared/ipc-contract";
import { ipc } from "@renderer/lib/ipc";
import { FolderOpenIcon } from "lucide-react";
import { toast } from "@glaze/core/components";

interface ConnectionFormProps {
  editProfile?: ConnectionProfileDTO;
  folders: Folder[];
  onSave: (profile: ConnectionProfileDTO) => void;
  onCancel: () => void;
}

const DEFAULT_PORTS: Record<Protocol, number> = {
  sftp: 22,
  ftp: 21,
  ftps: 990,
  ssh: 22,
};

export function ConnectionForm({ editProfile, folders, onSave, onCancel }: ConnectionFormProps) {
  const [name, setName] = React.useState(editProfile?.name ?? "");
  const [protocol, setProtocol] = React.useState<Protocol>(editProfile?.protocol ?? "sftp");
  const [host, setHost] = React.useState(editProfile?.host ?? "");
  const [port, setPort] = React.useState(String(editProfile?.port ?? 22));
  const [username, setUsername] = React.useState(editProfile?.username ?? "");
  const [authType, setAuthType] = React.useState<AuthType>(editProfile?.authType ?? "password");
  const [secret, setSecret] = React.useState("");
  const [privateKeyPath, setPrivateKeyPath] = React.useState(editProfile?.privateKeyPath ?? "");
  const [folderId, setFolderId] = React.useState(editProfile?.folderId ?? "");
  const [defaultRemotePath, setDefaultRemotePath] = React.useState(editProfile?.defaultRemotePath ?? "");
  const [tags, setTags] = React.useState(editProfile?.tags.join(", ") ?? "");

  // Auto-update port when protocol changes
  React.useEffect(() => {
    if (!editProfile) {
      setPort(String(DEFAULT_PORTS[protocol]));
    }
  }, [protocol, editProfile]);

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
        color: null,
        secret: secret || undefined,
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
    const result = await window.glazeAPI.dialog.showOpenDialog({
      title: "Select Private Key",
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0 && result.filePaths[0]) {
      setPrivateKeyPath(result.filePaths[0]);
    }
  }

  const isValid = name.trim() && host.trim() && username.trim();

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
