/**
 * Imports saved sessions from a sessions.ini or .mxtsessions export. Parsing
 * happens on the backend (main/services/session-ini-parser.ts); this dialog
 * recreates the other client's folder tree with folders:create and saves each chosen
 * session through connections:create, like the ~/.ssh/config import.
 * Sessions of types Nexus can't open are listed but can't be selected, and
 * sessions that match a saved profile start unticked. Passwords aren't
 * imported: session-file encrypts them, so the first connect asks.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, Checkbox, Text, toast } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { ConnectionInput, ConnectionProfileDTO, Folder, IniSession } from "@shared/ipc-contract";

interface SessionImportDialogProps {
  /** The file to read; the dialog is open while this is set. */
  path: string | null;
  onClose: () => void;
}

const DEFAULT_PORT = { ssh: 22, sftp: 22, rdp: 3389, vnc: 5900 } as const;

/** Type names for sessions Nexus can't open, as the format documents them. */
const UNSUPPORTED_TYPE: Record<number, string> = { 11: "Browser" };

function sessionKey(s: IniSession, index: number): string {
  return `${index}:${s.name}`;
}

function isAlreadySaved(s: IniSession, profiles: ConnectionProfileDTO[]): boolean {
  if (!s.protocol) return false;
  const port = s.port ?? DEFAULT_PORT[s.protocol];
  return profiles.some(
    (p) => p.protocol === s.protocol && p.host === s.host && p.port === port && p.username === s.username,
  );
}

function buildInput(
  s: IniSession & { protocol: NonNullable<IniSession["protocol"]> },
  folderId: string | null,
): ConnectionInput {
  return {
    name: s.name,
    protocol: s.protocol,
    host: s.host,
    port: s.port ?? DEFAULT_PORT[s.protocol],
    username: s.username,
    authType: "password",
    privateKeyPath: null,
    folderId,
    tags: ["imported"],
    defaultRemotePath: null,
    color: null,
    agentForward: false,
    onConnectCommand: null,
    jumpHost: s.jumpHost
      ? {
          host: s.jumpHost.host,
          port: s.jumpHost.port ?? 22,
          username: s.jumpHost.username,
          authType: "password",
          privateKeyPath: null,
        }
      : null,
  };
}

/** Finds or creates each folder along `path`, reusing existing folders with the same name and parent. */
async function ensureFolderPath(
  path: string[],
  folders: Folder[],
  created: Map<string, string>,
): Promise<string | null> {
  let parentId: string | null = null;
  for (const name of path) {
    const key: string = `${parentId ?? ""}/${name}`;
    let id: string | undefined =
      created.get(key) ?? folders.find((f) => f.name === name && (f.parentId ?? null) === parentId)?.id;
    if (!id) {
      id = (await ipc.folders.create({ name, parentId })).id;
      created.set(key, id);
    }
    parentId = id;
  }
  return parentId;
}

export function SessionImportDialog({ path, onClose }: SessionImportDialogProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const parseQuery = useQuery({
    queryKey: ["session-ini", path],
    queryFn: () => ipc.sessionImport.parseIni({ path: path! }),
    enabled: path !== null,
    retry: 0,
    staleTime: 0,
  });
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: () => ipc.connections.list() });
  const profiles = connectionsQuery.data?.profiles ?? [];
  const sessions = React.useMemo(() => parseQuery.data?.sessions ?? [], [parseQuery.data]);

  // Preselect everything Nexus can open that isn't saved already.
  const profilesLoaded = connectionsQuery.isSuccess;
  React.useEffect(() => {
    if (!parseQuery.data || !profilesLoaded) return;
    setSelected(
      new Set(
        parseQuery.data.sessions
          .map((s, i) => [s, i] as const)
          .filter(([s]) => s.protocol && !isAlreadySaved(s, connectionsQuery.data?.profiles ?? []))
          .map(([s, i]) => sessionKey(s, i)),
      ),
    );
  }, [parseQuery.data, profilesLoaded, connectionsQuery.data]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const folders = connectionsQuery.data?.folders ?? [];
      const createdFolders = new Map<string, string>();
      let imported = 0;
      for (const [i, s] of sessions.entries()) {
        if (!s.protocol || !selected.has(sessionKey(s, i))) continue;
        const folderId = await ensureFolderPath(s.folderPath, folders, createdFolders);
        await ipc.connections.create({ input: buildInput({ ...s, protocol: s.protocol }, folderId) });
        imported++;
      }
      return imported;
    },
    onSuccess: (imported) => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      onClose();
      toast.success(`Imported ${imported} session${imported === 1 ? "" : "s"} from session-file`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const fileName = path?.split("/").pop() ?? "sessions.ini";

  return (
    <Dialog
      open={path !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Import from ${fileName}`}
      size="medium"
      confirmLabel={importMutation.isPending ? "Importing..." : `Import ${selected.size || ""} Selected`}
      confirmDisabled={selected.size === 0 || importMutation.isPending}
      onConfirm={() => importMutation.mutate()}
    >
      {parseQuery.isPending ? (
        <div className="p-4">
          <Text color="secondary">Reading {fileName}...</Text>
        </div>
      ) : parseQuery.isError ? (
        <div className="p-4">
          <Text color="secondary">
            Couldn&apos;t read {fileName}: {parseQuery.error.message}
          </Text>
        </div>
      ) : sessions.length === 0 ? (
        <div className="p-4">
          <Text color="secondary">No saved sessions found. Choose sessions.ini or a .mxtsessions export.</Text>
        </div>
      ) : (
        <div className="flex flex-col">
          <p className="px-4 py-2.5 text-xs text-secondary border-b border-separator">
            Passwords aren&apos;t imported (session-file encrypts them), so Nexus asks the first time you connect.
          </p>
          {sessions.map((s, i) => {
            const key = sessionKey(s, i);
            const saved = isAlreadySaved(s, profiles);
            const note = !s.protocol
              ? `${UNSUPPORTED_TYPE[s.typeCode] ?? `type ${s.typeCode}`} sessions aren't supported`
              : saved
                ? "already saved"
                : null;
            return (
              <label
                key={key}
                className="flex items-start gap-2.5 px-4 py-2.5 border-b border-separator last:border-b-0 cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(key)}
                  disabled={!s.protocol}
                  onCheckedChange={() => toggle(key)}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex flex-col min-w-0">
                  <Text variant="strong" truncate>
                    {s.folderPath.length ? `${s.folderPath.join(" / ")} / ` : ""}
                    {s.name}
                  </Text>
                  <Text variant="small" color="tertiary" truncate>
                    {s.protocol?.toUpperCase() ?? "Unsupported"} · {s.username ? `${s.username}@` : ""}
                    {s.host}
                    {s.port ? `:${s.port}` : ""}
                    {s.jumpHost ? ` · via ${s.jumpHost.host}` : ""}
                    {note ? ` · ${note}` : ""}
                  </Text>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
