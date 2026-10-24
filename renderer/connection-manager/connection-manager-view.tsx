import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScrollArea,
  Button,
  EmptyState,
  AlertDialog,
  Dialog,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Text,
  Checkbox,
  Label,
  Field,
} from "@renderer/lib/ui";
import {
  PlusIcon,
  Loader2Icon,
  LayoutGridIcon,
  ListIcon,
  TagIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { setSession } from "@renderer/lib/sessions";
import { addOpenSession } from "@renderer/lib/open-sessions-store";
import {
  NEW_CONNECTION_EVENT,
  NEW_FOLDER_EVENT,
  CONNECT_PROFILE_EVENT,
  type ConnectProfileEventDetail,
} from "@renderer/lib/menu-events";
import { usePersistedState } from "@renderer/lib/hooks";
import { cn } from "@renderer/lib/cn";
import type {
  ConnectionProfileDTO,
  ConnectionsExportRequest,
  ConnectionsImportRequest,
  Folder,
  Protocol,
} from "@shared/ipc-contract";
import { ConnectionForm } from "./connection-form";
import { QuickConnectBar } from "./quick-connect-bar";
import { ProfileCard } from "./profile-card";
import { ProfileRow } from "./profile-row";
import { SshConfigImportDialog } from "./ssh-config-import-dialog";
import { SessionImportDialog } from "./session-import-dialog";
import { collectTags, matchesTagFilter } from "./tag-filter";
import { groupProfiles } from "@renderer/main/shell/group-profiles";
import { describeConnectFailure } from "@renderer/lib/connect-error";
import { toast } from "@renderer/lib/ui";

type ViewMode = "grid" | "list";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

type SidebarItem =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "folder"; folder: Folder }
  | { kind: "protocol"; protocol: Protocol };

const PROTOCOL_LABELS: Record<Protocol, string> = {
  sftp: "SFTP",
  ftp: "FTP",
  ftps: "FTPS",
  ssh: "SSH",
  rdp: "RDP",
  vnc: "VNC",
  mosh: "Mosh",
  telnet: "Telnet",
  serial: "Serial",
};

/** VNC asks for its password itself; Telnet and serial sign in inside the terminal. */
const NO_PASSWORD_PROMPT: Protocol[] = ["vnc", "telnet", "serial"];

const PROTOCOL_ORDER: Protocol[] = ["sftp", "ssh", "mosh", "telnet", "serial", "ftp", "ftps", "rdp", "vnc"];


function getProtocolColor(protocol: Protocol): BadgeColor {
  switch (protocol) {
    case "sftp": return "blue";
    case "ftp": return "green";
    case "ftps": return "purple";
    case "ssh": return "orange";
    case "rdp": return "magenta";
    case "vnc": return "red";
    case "mosh": return "yellow";
    case "telnet": return "secondary";
    case "serial": return "primary";
  }
}

function getItemKey(item: SidebarItem): string {
  switch (item.kind) {
    case "all": return "all";
    case "recent": return "recent";
    case "folder": return `folder:${item.folder.id}`;
    case "protocol": return `protocol:${item.protocol}`;
  }
}

function getViewTitle(item: SidebarItem): string {
  switch (item.kind) {
    case "all": return "All Connections";
    case "recent": return "Recent";
    case "folder": return item.folder.name;
    case "protocol": return PROTOCOL_LABELS[item.protocol];
  }
}

function matchesSidebarSelection(profile: ConnectionProfileDTO, item: SidebarItem): boolean {
  switch (item.kind) {
    case "all": return true;
    case "recent": return profile.lastConnectedAt != null;
    case "folder": return profile.folderId === item.folder.id;
    case "protocol": return profile.protocol === item.protocol;
  }
}


export function ConnectionManagerView() {
  const qc = useQueryClient();

  const [selectedSidebarItem, setSelectedSidebarItem] = React.useState<SidebarItem>({ kind: "all" });
  const [searchValue, setSearchValue] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [showNewConnection, setShowNewConnection] = React.useState(false);
  const [editProfile, setEditProfile] = React.useState<ConnectionProfileDTO | null>(null);
  const [duplicateSource, setDuplicateSource] = React.useState<ConnectionProfileDTO | null>(null);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [showNewFolder, setShowNewFolder] = React.useState(false);
  const [showSshConfigImport, setShowSshConfigImport] = React.useState(false);
  const [importFile, setImportFile] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ConnectionProfileDTO | null>(null);
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = React.useState<{ profile: ConnectionProfileDTO; password: string } | null>(null);
  const [viewMode, setViewMode] = usePersistedState<ViewMode>("connection-manager:view-mode", "grid");

  const [showExportDialog, setShowExportDialog] = React.useState(false);
  const [exportSelectedIds, setExportSelectedIds] = React.useState<Set<string>>(new Set());
  const [exportIncludeSecrets, setExportIncludeSecrets] = React.useState(false);
  const [exportPassword, setExportPassword] = React.useState("");
  const [showImportDialog, setShowImportDialog] = React.useState(false);
  const [importFilePath, setImportFilePath] = React.useState<string | null>(null);
  const [importPassword, setImportPassword] = React.useState("");

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => ipc.connections.list(),
  });

  // Cross-device sync applies remote changes directly through connectionStore
  // (connection-sync-service.ts), bypassing the connections:create/update/delete
  // mutations above — so a pulled-in profile/folder needs its own invalidation
  // trigger rather than piggybacking on a local mutation's onSuccess.
  React.useEffect(() => {
    return ipc.connectionSync.onStatusChanged(() => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
    });
  }, [qc]);

  const deleteConnectionMutation = useMutation({
    mutationFn: (id: string) => ipc.connections.delete({ id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => ipc.folders.create({ name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
      setShowNewFolder(false);
      setNewFolderName("");
      toast.success("Folder created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const exportMutation = useMutation({
    mutationFn: (req: ConnectionsExportRequest) => ipc.connections.export(req),
    onSuccess: (result) => {
      setShowExportDialog(false);
      setExportPassword("");
      toast.success(`Exported ${result.profileCount} connection${result.profileCount === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const importMutation = useMutation({
    mutationFn: (req: ConnectionsImportRequest) => ipc.connections.import(req),
    onSuccess: (result) => {
      setShowImportDialog(false);
      setImportFilePath(null);
      setImportPassword("");
      void qc.invalidateQueries({ queryKey: ["connections"] });
      toast.success(`Imported ${result.profileCount} connection${result.profileCount === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  React.useEffect(() => {
    const handler = () => setShowNewConnection(true);
    window.addEventListener(NEW_CONNECTION_EVENT, handler);
    return () => window.removeEventListener(NEW_CONNECTION_EVENT, handler);
  }, []);

  React.useEffect(() => {
    const handler = () => setShowNewFolder(true);
    window.addEventListener(NEW_FOLDER_EVENT, handler);
    return () => window.removeEventListener(NEW_FOLDER_EVENT, handler);
  }, []);

  // Connect requests from the shell's Sessions sidebar. Re-subscribed when the
  // profile list changes so the lookup never reads a stale snapshot.
  const profilesForConnect = connectionsQuery.data?.profiles;
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { profileId } = (e as CustomEvent<ConnectProfileEventDetail>).detail;
      const profile = profilesForConnect?.find((p) => p.id === profileId);
      if (profile) void handleConnect(profile);
    };
    window.addEventListener(CONNECT_PROFILE_EVENT, handler);
    return () => window.removeEventListener(CONNECT_PROFILE_EVENT, handler);
  }, [profilesForConnect]);

  const { profiles = [], folders = [] } = connectionsQuery.data ?? {};

  const recentCount = profiles.filter((p) => p.lastConnectedAt != null).length;
  const sidebarViewItems: SidebarItem[] = [
    { kind: "all" },
    ...(recentCount > 0 ? [{ kind: "recent" } as SidebarItem] : []),
  ];
  const sidebarFolderItems: SidebarItem[] = folders.map((f): SidebarItem => ({ kind: "folder", folder: f }));
  const presentProtocols = PROTOCOL_ORDER.filter((protocol) => profiles.some((p) => p.protocol === protocol));
  const sidebarProtocolItems: SidebarItem[] = presentProtocols.map((protocol): SidebarItem => ({ kind: "protocol", protocol }));

  const allTags = collectTags(profiles);
  // The page's "Show" menu: everything the old side list offered, in one control.
  const showItems: SidebarItem[] = [...sidebarViewItems, ...sidebarFolderItems, ...sidebarProtocolItems];
  const countFor = (item: SidebarItem) =>
    item.kind === "recent" ? recentCount : profiles.filter((p) => matchesSidebarSelection(p, item)).length;
  const showLabel = (item: SidebarItem) =>
    `${item.kind === "folder" ? "Folder: " : ""}${getViewTitle(item)} (${countFor(item)})`;

  let filteredProfiles = profiles.filter((p) => {
    const matchesSearch =
      !searchValue ||
      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      p.host.toLowerCase().includes(searchValue.toLowerCase());
    return matchesSearch && matchesSidebarSelection(p, selectedSidebarItem) && matchesTagFilter(p.tags, selectedTags);
  });
  if (selectedSidebarItem.kind === "recent") {
    filteredProfiles = [...filteredProfiles].sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
  }

  // Folder headings, as in the Sessions sidebar. Not for Recent (its order is the point) or a single
  // folder (the Show menu already names it), and no heading when there are no folders at all.
  const sections: { key: string; name: string | null; profiles: ConnectionProfileDTO[] }[] =
    selectedSidebarItem.kind === "recent" || selectedSidebarItem.kind === "folder" || folders.length === 0
      ? [{ key: "all", name: null, profiles: filteredProfiles }]
      : groupProfiles(filteredProfiles, folders, "");

  async function pickImportFile() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: "Import Sessions",
      message: "Choose a session .ini file or a .mxtsessions export",
      properties: ["openFile"],
      filters: [{ name: "Saved sessions", extensions: ["ini", "mxtsessions"] }],
    });
    const filePath = result.filePaths[0];
    if (!result.canceled && filePath) setImportFile(filePath);
  }

  async function handleMoreActions() {
    const CMD_NEW_FOLDER = 1;
    const CMD_SSH_IMPORT = 2;
    const CMD_EXPORT = 3;
    const CMD_IMPORT = 4;
    const CMD_SESSION_IMPORT = 5;
    const result = await window.nexusAPI.Menu.popup({
      items: [
        { label: "New Folder…", commandId: CMD_NEW_FOLDER },
        { type: "separator" },
        { label: "Import from SSH Config…", commandId: CMD_SSH_IMPORT },
        { label: "Import Sessions from File…", commandId: CMD_SESSION_IMPORT },
        { type: "separator" },
        { label: "Export Connections…", commandId: CMD_EXPORT },
        { label: "Import Connections…", commandId: CMD_IMPORT },
      ],
    });
    if (result.commandId === null) return;
    if (result.commandId === CMD_NEW_FOLDER) setShowNewFolder(true);
    else if (result.commandId === CMD_SSH_IMPORT) setShowSshConfigImport(true);
    else if (result.commandId === CMD_EXPORT) openExportDialog();
    else if (result.commandId === CMD_IMPORT) void handleImportClick();
    else if (result.commandId === CMD_SESSION_IMPORT) void pickImportFile();
  }

  function toggleTagFilter(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function openExportDialog() {
    setExportSelectedIds(new Set(profiles.map((p) => p.id)));
    setExportIncludeSecrets(false);
    setExportPassword("");
    setShowExportDialog(true);
  }

  async function handleExportConfirm() {
    if (exportSelectedIds.size === 0) return;
    if (exportIncludeSecrets && !exportPassword) {
      toast.error("Enter an export password to include secrets");
      return;
    }
    const result = await window.nexusAPI.dialog.showSaveDialog({
      title: "Export Connections",
      defaultPath: "nexus-connections.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return;
    exportMutation.mutate({
      filePath: result.filePath,
      profileIds: [...exportSelectedIds],
      includeSecrets: exportIncludeSecrets,
      password: exportIncludeSecrets ? exportPassword : undefined,
    });
  }

  async function handleImportClick() {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: "Import Connections",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return;
    setImportFilePath(filePath);
    setImportPassword("");
    setShowImportDialog(true);
  }

  async function handleConnect(profile: ConnectionProfileDTO, secret?: string) {
    console.log("[ConnectionManagerView:connect]", { profileId: profile.id, hasSecret: profile.hasSecret, authType: profile.authType });
    // VNC asks in its own viewer, and only if the server wants a login, so it doesn't need one up front.
    if (!secret && !profile.hasSecret && profile.authType === "password" && !NO_PASSWORD_PROMPT.includes(profile.protocol)) {
      setPasswordPrompt({ profile, password: "" });
      return;
    }
    setConnectingId(profile.id);
    try {
      const sessionInfo = await ipc.session.connect({
        profileId: profile.id,
        secret: secret ?? undefined,
      });
      console.log("[ConnectionManagerView:connected]", sessionInfo);
      setSession(sessionInfo);
      addOpenSession(sessionInfo.sessionId);
    } catch (err) {
      const failure = describeConnectFailure(err instanceof Error ? err.message : "Connection failed", profile);
      // Stays until dismissed: a sign-in failure is easy to miss otherwise, and looks like nothing happened.
      toast.error(failure.title, {
        description: failure.hint,
        duration: Infinity,
        action: failure.suggestEdit ? { label: "Edit", onClick: () => setEditProfile(profile) } : undefined,
      });
    } finally {
      setConnectingId(null);
      setPasswordPrompt(null);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
          <QuickConnectBar onConnect={(sessionInfo) => {
            setSession(sessionInfo);
            addOpenSession(sessionInfo.sessionId);
          }} />

          <ScrollArea
            className="flex-1"
            toolbar={
              <div className="flex flex-col gap-2 px-4 py-2.5 border-b border-separator">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    size="small"
                    variant="filled"
                    placeholder="Filter…"
                    aria-label="Filter connections"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    className="w-48"
                  />
                  <Select
                    value={getItemKey(selectedSidebarItem)}
                    onValueChange={(key) => {
                      const item = showItems.find((i) => getItemKey(i) === key);
                      if (item) setSelectedSidebarItem(item);
                    }}
                  >
                    <SelectTrigger size="small" aria-label="Show" className="min-w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {showItems.map((item) => (
                        <SelectItem key={getItemKey(item)} value={getItemKey(item)}>
                          {showLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Text variant="small" color="tertiary" className="shrink-0">
                    {filteredProfiles.length} connection{filteredProfiles.length === 1 ? "" : "s"}
                  </Text>
                  <div className="flex-1" />
                  <Button
                    iconOnly
                    variant={viewMode === "grid" ? "filled" : "transparent"}
                    size="small"
                    onClick={() => setViewMode("grid")}
                    aria-label="Grid view"
                  >
                    <LayoutGridIcon className="size-3.5" />
                  </Button>
                  <Button
                    iconOnly
                    variant={viewMode === "list" ? "filled" : "transparent"}
                    size="small"
                    onClick={() => setViewMode("list")}
                    aria-label="List view"
                  >
                    <ListIcon className="size-3.5" />
                  </Button>
                  <Button variant="accent" size="small" onClick={() => setShowNewConnection(true)}>
                    <PlusIcon className="size-3.5 shrink-0" />
                    New Connection
                  </Button>
                  <Button
                    iconOnly
                    variant="transparent"
                    size="small"
                    onClick={() => void handleMoreActions()}
                    aria-label="More actions"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </Button>
                </div>
                {allTags.length > 0 && (
                  <div role="group" aria-label="Filter by tag" className="flex flex-wrap items-center gap-1.5">
                    {allTags.map((tag) => {
                      const active = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleTagFilter(tag)}
                          className={cn(
                            "flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs transition-colors",
                            active ? "border-accent bg-accent/10 text-primary" : "border-separator text-secondary hover:text-primary",
                          )}
                        >
                          <TagIcon className="size-3" aria-hidden="true" />
                          {tag}
                        </button>
                      );
                    })}
                    {selectedTags.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTags([])}
                        className="px-1 text-xs text-tertiary hover:text-secondary underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            }
          >
            {connectionsQuery.isPending ? (
              <div className="flex items-center justify-center h-32">
                <Loader2Icon className="size-5 animate-spin text-tertiary" />
              </div>
            ) : connectionsQuery.isError ? (
              <div className="p-4">
                <Text color="secondary">{connectionsQuery.error.message}</Text>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <EmptyState
                title="No connections"
                description={
                  searchValue
                    ? "No connections match your search."
                    : "Add your first server connection to get started."
                }
                actions={
                  !searchValue ? (
                    <Button variant="accent" onClick={() => setShowNewConnection(true)}>
                      Add Connection
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="flex flex-col gap-1 py-2">
                {sections.map((section) => (
                  <section key={section.key} aria-label={section.name ?? "Connections"}>
                    {section.name && (
                      <h3 className="flex items-center gap-2 px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-secondary">
                        {section.name}
                        <span className="font-normal text-tertiary">{section.profiles.length}</span>
                      </h3>
                    )}
                    {viewMode === "grid" ? (
                      <div className="px-5 py-2 grid grid-cols-[repeat(auto-fit,minmax(260px,340px))] gap-4">
                        {section.profiles.map((profile) => (
                          <ProfileCard
                            key={profile.id}
                            profile={profile}
                            protocolColor={getProtocolColor(profile.protocol)}
                            connecting={connectingId === profile.id}
                            onConnect={() => handleConnect(profile)}
                            onEdit={() => setEditProfile(profile)}
                            onDuplicate={() => setDuplicateSource(profile)}
                            onDelete={() => setDeleteTarget(profile)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {section.profiles.map((profile) => (
                          <ProfileRow
                            key={profile.id}
                            profile={profile}
                            protocolColor={getProtocolColor(profile.protocol)}
                            connecting={connectingId === profile.id}
                            onConnect={() => handleConnect(profile)}
                            onEdit={() => setEditProfile(profile)}
                            onDuplicate={() => setDuplicateSource(profile)}
                            onDelete={() => setDeleteTarget(profile)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

      {/* New connection dialog */}
      <Dialog
        open={showNewConnection}
        onOpenChange={setShowNewConnection}
        title="New Session"
        size="medium"
      >
        <ConnectionForm
          onSave={(profile, { connect }) => {
            setShowNewConnection(false);
            void qc.invalidateQueries({ queryKey: ["connections"] });
            if (connect) void handleConnect(profile);
            else toast.success(`Saved: ${profile.name}`);
          }}
          onCancel={() => setShowNewConnection(false)}
          folders={folders}
        />
      </Dialog>

      {/* Edit connection dialog */}
      {editProfile && (
        <Dialog
          open={!!editProfile}
          onOpenChange={(open) => { if (!open) setEditProfile(null); }}
          title="Edit Connection"
          size="medium"
        >
          <ConnectionForm
            editProfile={editProfile}
            onSave={(profile) => {
              setEditProfile(null);
              void qc.invalidateQueries({ queryKey: ["connections"] });
              toast.success(`Updated: ${profile.name}`);
            }}
            onCancel={() => setEditProfile(null)}
            folders={folders}
          />
        </Dialog>
      )}

      {/* Duplicate connection dialog */}
      {duplicateSource && (
        <Dialog
          open={!!duplicateSource}
          onOpenChange={(open) => { if (!open) setDuplicateSource(null); }}
          title="Duplicate Connection"
          size="medium"
        >
          <ConnectionForm
            duplicateFrom={duplicateSource}
            onSave={(profile, { connect }) => {
              setDuplicateSource(null);
              void qc.invalidateQueries({ queryKey: ["connections"] });
              if (connect) void handleConnect(profile);
              else toast.success(`Saved: ${profile.name}`);
            }}
            onCancel={() => setDuplicateSource(null)}
            folders={folders}
          />
        </Dialog>
      )}

      {/* Export connections dialog */}
      <Dialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export Connections"
        size="medium"
        confirmLabel={exportMutation.isPending ? "Exporting..." : "Export"}
        confirmDisabled={
          exportSelectedIds.size === 0 || (exportIncludeSecrets && !exportPassword) || exportMutation.isPending
        }
        onConfirm={() => void handleExportConfirm()}
      >
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Text variant="small" color="secondary">
              {exportSelectedIds.size} of {profiles.length} selected
            </Text>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() =>
                setExportSelectedIds(
                  exportSelectedIds.size === profiles.length ? new Set() : new Set(profiles.map((p) => p.id)),
                )
              }
            >
              {exportSelectedIds.size === profiles.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 border border-field rounded-medium p-2">
            {profiles.map((p) => (
              <Label key={p.id} className="cursor-pointer">
                <Checkbox
                  checked={exportSelectedIds.has(p.id)}
                  onCheckedChange={(checked) => {
                    setExportSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    });
                  }}
                />
                <span className="truncate">
                  {p.name} <span className="text-tertiary">({p.host})</span>
                </span>
              </Label>
            ))}
          </div>
          <Label className="cursor-pointer">
            <Checkbox
              checked={exportIncludeSecrets}
              onCheckedChange={(checked) => setExportIncludeSecrets(checked === true)}
            />
            Include secrets (password-protected)
          </Label>
          {exportIncludeSecrets && (
            <Field
              label="Export password"
              description="Needed again to import secrets from this file"
              orientation="horizontal"
            >
              <Input
                type="password"
                placeholder="Required"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            </Field>
          )}
        </div>
      </Dialog>

      {/* Import connections dialog */}
      {showImportDialog && importFilePath && (
        <Dialog
          open={showImportDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowImportDialog(false);
              setImportFilePath(null);
            }
          }}
          title="Import Connections"
          size="small"
          confirmLabel={importMutation.isPending ? "Importing..." : "Import"}
          confirmDisabled={importMutation.isPending}
          onConfirm={() => importMutation.mutate({ filePath: importFilePath, password: importPassword || undefined })}
        >
          <div className="px-4 py-3 flex flex-col gap-2">
            <Text variant="small" color="secondary" truncate>{importFilePath}</Text>
            <Field label="Password" description="Only needed if this file's secrets were password-protected" orientation="horizontal">
              <Input
                type="password"
                placeholder="optional"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </Field>
          </div>
        </Dialog>
      )}

      {/* New folder dialog */}
      <Dialog
        open={showNewFolder}
        onOpenChange={setShowNewFolder}
        title="New Folder"
        size="small"
        confirmLabel="Create"
        onConfirm={() => {
          if (newFolderName.trim()) {
            createFolderMutation.mutate(newFolderName.trim());
          }
        }}
        confirmDisabled={!newFolderName.trim()}
      >
        <div className="px-4 py-3">
          <Input
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) {
                createFolderMutation.mutate(newFolderName.trim());
              }
            }}
          />
        </div>
      </Dialog>

      <SshConfigImportDialog open={showSshConfigImport} onOpenChange={setShowSshConfigImport} />
      <SessionImportDialog path={importFile} onClose={() => setImportFile(null)} />

      {/* Delete confirmation */}
      {deleteTarget && (
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={`Delete "${deleteTarget.name}"?`}
          description="This connection profile will be permanently deleted."
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={() => {
            deleteConnectionMutation.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}

      {/* Password prompt */}
      {passwordPrompt && (
        <Dialog
          open={!!passwordPrompt}
          onOpenChange={(open) => { if (!open) setPasswordPrompt(null); }}
          title={`Password for ${passwordPrompt.profile.name}`}
          size="small"
          confirmLabel={connectingId ? "Connecting..." : "Connect"}
          confirmVariant="accent"
          confirmDisabled={!!connectingId}
          onConfirm={() => handleConnect(passwordPrompt.profile, passwordPrompt.password)}
        >
          <div className="px-4 py-3">
            <Input
              autoFocus
              type="password"
              placeholder="Password"
              value={passwordPrompt.password}
              onChange={(e) =>
                setPasswordPrompt((prev) =>
                  prev ? { ...prev, password: e.target.value } : null,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleConnect(passwordPrompt.profile, passwordPrompt.password);
                }
              }}
            />
          </div>
        </Dialog>
      )}

    </div>
  );
}
