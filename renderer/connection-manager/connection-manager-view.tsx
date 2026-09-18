import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SplitView,
  Sidebar,
  SidebarList,
  SidebarListItem,
  ScrollArea,
  Button,
  EmptyState,
  AlertDialog,
  Dialog,
  Input,
  Text,
  Badge,
  Checkbox,
  Label,
  Field,
} from "@renderer/lib/ui";
import {
  PlusIcon,
  FolderIcon,
  ServerIcon,
  FolderPlusIcon,
  Loader2Icon,
  LayoutGridIcon,
  ListIcon,
  DownloadIcon,
  UploadIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { setSession } from "@renderer/lib/sessions";
import { addOpenSession } from "@renderer/lib/open-sessions-store";
import { NEW_CONNECTION_EVENT, NEW_FOLDER_EVENT } from "@renderer/lib/menu-events";
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
import { collectTags, matchesTagFilter } from "./tag-filter";
import { toast } from "@renderer/lib/ui";

type ViewMode = "grid" | "list";

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

type SidebarItem =
  | { kind: "all" }
  | { kind: "folder"; folder: Folder };

function getProtocolColor(protocol: Protocol): BadgeColor {
  switch (protocol) {
    case "sftp": return "blue";
    case "ftp": return "green";
    case "ftps": return "purple";
    case "ssh": return "orange";
    case "rdp": return "magenta";
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

  const { profiles = [], folders = [] } = connectionsQuery.data ?? {};

  const sidebarItems: SidebarItem[] = [
    { kind: "all" },
    ...folders.map((f): SidebarItem => ({ kind: "folder", folder: f })),
  ];

  const getItemKey = (item: SidebarItem) =>
    item.kind === "all" ? "all" : item.folder.id;

  const allTags = collectTags(profiles);

  const filteredProfiles = profiles.filter((p) => {
    const matchesSearch =
      !searchValue ||
      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      p.host.toLowerCase().includes(searchValue.toLowerCase());
    const matchesFolder =
      selectedSidebarItem.kind === "all" ||
      p.folderId === selectedSidebarItem.folder.id;
    return matchesSearch && matchesFolder && matchesTagFilter(p.tags, selectedTags);
  });

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
    if (!secret && !profile.hasSecret && profile.authType === "password") {
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
      const msg = err instanceof Error ? err.message : "Connection failed";
      toast.error(msg);
    } finally {
      setConnectingId(null);
      setPasswordPrompt(null);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <SplitView
        storageKey="connection-manager"
        sidebar={
          <Sidebar
            searchable
            searchPlaceholder="Filter connections..."
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            actions={
              <>
                <Button
                  iconOnly
                  variant="transparent"
                  size="small"
                  onClick={() => setShowNewFolder(true)}
                  aria-label="New folder"
                >
                  <FolderPlusIcon className="size-3.5" />
                </Button>
                <Button
                  iconOnly
                  variant="transparent"
                  size="small"
                  onClick={() => setShowNewConnection(true)}
                  aria-label="New connection"
                >
                  <PlusIcon className="size-3.5" />
                </Button>
                <Button
                  iconOnly
                  variant="transparent"
                  size="small"
                  onClick={openExportDialog}
                  aria-label="Export connections"
                >
                  <DownloadIcon className="size-3.5" />
                </Button>
                <Button
                  iconOnly
                  variant="transparent"
                  size="small"
                  onClick={() => void handleImportClick()}
                  aria-label="Import connections"
                >
                  <UploadIcon className="size-3.5" />
                </Button>
              </>
            }
          >
            <SidebarList
              items={sidebarItems}
              selectedItem={selectedSidebarItem}
              onSelectedItemChange={setSelectedSidebarItem}
              getItemKey={getItemKey}
            >
              {sidebarItems.map((item) => {
                if (item.kind === "all") {
                  return (
                    <SidebarListItem
                      key="all"
                      item={item}
                      icon={<ServerIcon className="size-4" />}
                      title="All Connections"
                      accessory={
                        <Badge color="secondary">{profiles.length}</Badge>
                      }
                    />
                  );
                }
                const count = profiles.filter((p) => p.folderId === item.folder.id).length;
                return (
                  <SidebarListItem
                    key={item.folder.id}
                    item={item}
                    icon={<FolderIcon className="size-4" />}
                    title={item.folder.name}
                    accessory={
                      count > 0 ? <Badge color="secondary">{count}</Badge> : undefined
                    }
                  />
                );
              })}
            </SidebarList>
          </Sidebar>
        }
      >
        <div className="h-full flex flex-col">
          <QuickConnectBar onConnect={(sessionInfo) => {
            setSession(sessionInfo);
            addOpenSession(sessionInfo.sessionId);
          }} />

          <ScrollArea
            className="flex-1"
            title={
              selectedSidebarItem.kind === "all"
                ? "All Connections"
                : selectedSidebarItem.folder.name
            }
            toolbar={
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-separator">
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  {allTags.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagFilter(tag)}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                          active ? "bg-accent text-white" : "bg-control text-secondary hover:bg-control/80",
                        )}
                      >
                        {tag}
                      </button>
                    );
                  })}
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="text-[10px] text-tertiary hover:text-secondary underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
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
                </div>
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
            ) : viewMode === "grid" ? (
              <div className="p-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                {filteredProfiles.map((profile) => (
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
                {filteredProfiles.map((profile) => (
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
          </ScrollArea>
        </div>
      </SplitView>

      {/* New connection dialog */}
      <Dialog
        open={showNewConnection}
        onOpenChange={setShowNewConnection}
        title="New Connection"
        size="medium"
      >
        <ConnectionForm
          onSave={(profile) => {
            setShowNewConnection(false);
            void qc.invalidateQueries({ queryKey: ["connections"] });
            toast.success(`Saved: ${profile.name}`);
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
            onSave={(profile) => {
              setDuplicateSource(null);
              void qc.invalidateQueries({ queryKey: ["connections"] });
              toast.success(`Saved: ${profile.name}`);
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
