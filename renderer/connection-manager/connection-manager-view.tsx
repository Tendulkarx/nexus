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
} from "@renderer/lib/ui";
import {
  PlusIcon,
  FolderIcon,
  ServerIcon,
  FolderPlusIcon,
  Loader2Icon,
  LayoutGridIcon,
  ListIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { setSession } from "@renderer/lib/sessions";
import { addOpenSession } from "@renderer/lib/open-sessions-store";
import { NEW_CONNECTION_EVENT, NEW_FOLDER_EVENT } from "@renderer/lib/menu-events";
import { usePersistedState } from "@renderer/lib/hooks";
import type { ConnectionProfileDTO, Folder, Protocol } from "@shared/ipc-contract";
import { ConnectionForm } from "./connection-form";
import { QuickConnectBar } from "./quick-connect-bar";
import { ProfileCard } from "./profile-card";
import { ProfileRow } from "./profile-row";
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
  const [showNewConnection, setShowNewConnection] = React.useState(false);
  const [editProfile, setEditProfile] = React.useState<ConnectionProfileDTO | null>(null);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [showNewFolder, setShowNewFolder] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<ConnectionProfileDTO | null>(null);
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = React.useState<{ profile: ConnectionProfileDTO; password: string } | null>(null);
  const [viewMode, setViewMode] = usePersistedState<ViewMode>("connection-manager:view-mode", "grid");

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

  const filteredProfiles = profiles.filter((p) => {
    const matchesSearch =
      !searchValue ||
      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      p.host.toLowerCase().includes(searchValue.toLowerCase());
    const matchesFolder =
      selectedSidebarItem.kind === "all" ||
      p.folderId === selectedSidebarItem.folder.id;
    return matchesSearch && matchesFolder;
  });

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
              <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-separator">
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
