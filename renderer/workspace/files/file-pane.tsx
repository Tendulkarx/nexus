import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScrollArea,
  Button,
  Input,
  EmptyState,
  AlertDialog,
  Dialog,
  Text,
  toast,
} from "@renderer/lib/ui";
import {
  FolderIcon,
  FileIcon,
  RefreshCwIcon,
  FolderPlusIcon,
  Loader2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  LinkIcon,
  SearchIcon,
  StarIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { FsEntry, Protocol } from "@shared/ipc-contract";
import { Breadcrumbs } from "./breadcrumbs";
import { FilePreview } from "./file-preview";
import { QuickEditDialog } from "./quick-edit-dialog";
import { SearchDialog } from "./search-dialog";
import { cn } from "@renderer/lib/cn";

const SEARCHABLE_PROTOCOLS: Protocol[] = ["sftp", "ssh"];

interface FilePaneProps {
  mode: "local" | "remote";
  path: string;
  onNavigate: (path: string) => void;
  onUpload: (localPath: string, name: string) => Promise<void>;
  onDownload: (remotePath: string, name: string) => Promise<void>;
  sessionId: string;
  protocol: Protocol;
  /** Connection profile this session was opened from, if any — gates bookmarks/recents (see remote-places-store.ts). */
  profileId?: string | null;
  onDropFromLocal?: (localPath: string, name: string) => Promise<void>;
  onDropFromRemote?: (remotePath: string, name: string) => Promise<void>;
  onSyncFolder?: (entry: FsEntry) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(mtime: number): string {
  return new Date(mtime).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function joinPath(base: string, name: string): string {
  if (base.endsWith("/")) return `${base}${name}`;
  return `${base}/${name}`;
}

function parentPath(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  if (parts.length <= 1) return "/";
  parts.pop();
  return parts.join("/") || "/";
}

export function FilePane({
  mode,
  path,
  onNavigate,
  onUpload,
  onDownload,
  sessionId,
  protocol,
  profileId,
  onDropFromLocal,
  onDropFromRemote,
  onSyncFolder,
}: FilePaneProps) {
  const qc = useQueryClient();
  const queryKey = mode === "local" ? ["local", path] : ["remote", sessionId, path];

  const [pathInput, setPathInput] = React.useState(path);
  const [renameTarget, setRenameTarget] = React.useState<FsEntry | null>(null);
  const [renameTo, setRenameTo] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<FsEntry | null>(null);
  const [showMkdir, setShowMkdir] = React.useState(false);
  const [mkdirName, setMkdirName] = React.useState("");
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = React.useState<number | null>(null);
  const [previewEntry, setPreviewEntry] = React.useState<FsEntry | null>(null);
  const [quickEditEntry, setQuickEditEntry] = React.useState<FsEntry | null>(null);
  const [showSearch, setShowSearch] = React.useState(false);

  const isRemote = mode === "remote";
  const searchable = isRemote && SEARCHABLE_PROTOCOLS.includes(protocol);
  const placesEnabled = isRemote && !!profileId;

  const bookmarksQuery = useQuery({
    queryKey: ["remotePlaces:bookmarks", profileId],
    queryFn: () => ipc.remotePlaces.listBookmarks({ profileId: profileId! }),
    enabled: placesEnabled,
    staleTime: 5_000,
  });

  const recentsQuery = useQuery({
    queryKey: ["remotePlaces:recents", profileId],
    queryFn: () => ipc.remotePlaces.listRecents({ profileId: profileId! }),
    enabled: placesEnabled,
    staleTime: 5_000,
  });

  // Every remote navigation on a profile-backed session updates its recents list.
  React.useEffect(() => {
    if (!placesEnabled) return;
    void ipc.remotePlaces
      .recordVisit({ profileId: profileId!, path })
      .then(() => qc.invalidateQueries({ queryKey: ["remotePlaces:recents", profileId] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesEnabled, profileId, path]);

  async function handlePlacesMenu() {
    if (!profileId) return;
    const bookmarks = bookmarksQuery.data?.bookmarks ?? [];
    const recents = (recentsQuery.data?.recents ?? []).filter((p) => p !== path);
    const isBookmarked = bookmarks.some((b) => b.path === path);

    const CMD_TOGGLE_BOOKMARK = 1;
    const CMD_BOOKMARK_BASE = 100;
    const CMD_RECENT_BASE = 100 + bookmarks.length;

    const items: Array<{ label?: string; commandId?: number; type?: "separator" }> = [
      { label: isBookmarked ? "Remove Bookmark" : "Bookmark This Folder", commandId: CMD_TOGGLE_BOOKMARK },
    ];
    if (bookmarks.length > 0) {
      items.push({ type: "separator" });
      bookmarks.forEach((b, i) => items.push({ label: `★ ${b.path}`, commandId: CMD_BOOKMARK_BASE + i }));
    }
    if (recents.length > 0) {
      items.push({ type: "separator" });
      recents.slice(0, 10).forEach((p, i) => items.push({ label: p, commandId: CMD_RECENT_BASE + i }));
    }

    const result = await window.nexusAPI.Menu.popup({ items });
    if (result.commandId === null) return;

    if (result.commandId === CMD_TOGGLE_BOOKMARK) {
      const mutate = isBookmarked
        ? ipc.remotePlaces.removeBookmark({ profileId, path })
        : ipc.remotePlaces.addBookmark({ profileId, path });
      await mutate;
      void qc.invalidateQueries({ queryKey: ["remotePlaces:bookmarks", profileId] });
      return;
    }
    if (result.commandId >= CMD_BOOKMARK_BASE && result.commandId < CMD_RECENT_BASE) {
      const target = bookmarks[result.commandId - CMD_BOOKMARK_BASE];
      if (target) onNavigate(target.path);
      return;
    }
    const target = recents[result.commandId - CMD_RECENT_BASE];
    if (target) onNavigate(target);
  }

  // Sync path input with prop
  React.useEffect(() => {
    setPathInput(path);
  }, [path]);

  // Navigating away clears the previous directory's selection.
  React.useEffect(() => {
    setSelectedPaths(new Set());
    setLastClickedIndex(null);
  }, [path]);

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      mode === "local"
        ? ipc.local.list({ path })
        : ipc.remote.list({ sessionId, path }),
    retry: 1,
  });

  const mkdirMutation = useMutation({
    mutationFn: (name: string) => {
      const newPath = joinPath(path, name);
      return mode === "local"
        ? ipc.local.mkdir({ path: newPath })
        : ipc.remote.mkdir({ sessionId, path: newPath });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      setShowMkdir(false);
      setMkdirName("");
      toast.success("Folder created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      mode === "local"
        ? ipc.local.rename({ from, to })
        : ipc.remote.rename({ sessionId, from, to }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      setRenameTarget(null);
      toast.success("Renamed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: FsEntry) =>
      mode === "local"
        ? ipc.local.delete({ path: entry.path, isDir: entry.isDir })
        : ipc.remote.delete({ sessionId, path: entry.path, isDir: entry.isDir }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      setDeleteTarget(null);
      toast.success("Deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleRowClick(entry: FsEntry, index: number, e: React.MouseEvent) {
    const isToggle = e.metaKey || e.ctrlKey;
    const isRange = e.shiftKey;

    if (isRange && lastClickedIndex !== null) {
      const [from, to] = [Math.min(lastClickedIndex, index), Math.max(lastClickedIndex, index)];
      const rangePaths = sorted.slice(from, to + 1).map((it) => it.path);
      setSelectedPaths((prev) => new Set([...prev, ...rangePaths]));
      return;
    }

    if (isToggle) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setLastClickedIndex(index);
      return;
    }

    setSelectedPaths(new Set([entry.path]));
    setLastClickedIndex(index);
  }

  function handleDoubleClick(entry: FsEntry) {
    if (entry.isDir) {
      onNavigate(entry.path);
    } else {
      setPreviewEntry(entry);
    }
  }

  async function handleEditExternal(entry: FsEntry) {
    console.log("[FilePane:editExternal]", { path: entry.path });
    try {
      await ipc.edit.open({ sessionId, path: entry.path });
      toast.success(`Opened "${entry.name}" — changes save back to the server`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleBulkDelete(paths: string[]) {
    for (const p of paths) {
      const entry = sorted.find((it) => it.path === p);
      if (!entry) continue;
      try {
        await (mode === "local"
          ? ipc.local.delete({ path: entry.path, isDir: entry.isDir })
          : ipc.remote.delete({ sessionId, path: entry.path, isDir: entry.isDir }));
      } catch (err) {
        toast.error(`Couldn't delete "${entry.name}": ${(err as Error).message}`);
      }
    }
    void qc.invalidateQueries({ queryKey });
    setSelectedPaths(new Set());
    toast.success(`Deleted ${paths.length} items`);
  }

  async function handleBulkTransfer(paths: string[], isRemote: boolean) {
    for (const p of paths) {
      const entry = sorted.find((it) => it.path === p);
      if (!entry || entry.isDir) continue;
      if (isRemote) await onDownload(entry.path, entry.name);
      else await onUpload(entry.path, entry.name);
    }
  }

  async function handleContextMenu(entry: FsEntry, e: React.MouseEvent) {
    e.preventDefault();
    console.log("[FilePane:contextMenu]", { mode, path: entry.path });

    // Right-clicking outside the current selection resets it to just this entry
    // (standard Finder behavior); right-clicking within a multi-selection keeps it.
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
    }
    const activeSelection = selectedPaths.has(entry.path) ? selectedPaths : new Set([entry.path]);
    const multiCount = activeSelection.size;

    const CMD_PREVIEW = 1;
    const CMD_EDIT = 2;
    const CMD_TRANSFER = 3;
    const CMD_RENAME = 4;
    const CMD_DELETE = 5;
    const CMD_MKDIR = 6;
    const CMD_OPEN = 7;
    const CMD_BULK_TRANSFER = 8;
    const CMD_BULK_DELETE = 9;
    const CMD_SYNC = 10;
    const CMD_QUICK_EDIT = 11;

    const items: Array<{ label?: string; commandId?: number; type?: "separator" }> = [];

    if (multiCount > 1) {
      items.push({ label: `${isRemote ? "Download" : "Upload"} ${multiCount} items`, commandId: CMD_BULK_TRANSFER });
      items.push({ label: `Delete ${multiCount} items`, commandId: CMD_BULK_DELETE });
    } else {
      if (entry.isDir) {
        items.push({ label: "Open", commandId: CMD_OPEN });
        if (onSyncFolder) {
          items.push({ label: "Sync this folder…", commandId: CMD_SYNC });
        }
      } else {
        items.push({ label: "Quick Look", commandId: CMD_PREVIEW });
        if (isRemote) {
          items.push({ label: "Quick Edit", commandId: CMD_QUICK_EDIT });
          items.push({ label: "Edit in Default App", commandId: CMD_EDIT });
        }
        items.push({ type: "separator" });
        items.push({ label: isRemote ? "Download" : "Upload", commandId: CMD_TRANSFER });
      }
      items.push({ type: "separator" });
      items.push({ label: "Rename", commandId: CMD_RENAME });
      items.push({ label: "Delete", commandId: CMD_DELETE });
      items.push({ type: "separator" });
      items.push({ label: "New Folder", commandId: CMD_MKDIR });
    }

    const result = await window.nexusAPI.Menu.popup({ items });

    switch (result.commandId) {
      case CMD_OPEN:
        onNavigate(entry.path);
        break;
      case CMD_PREVIEW:
        setPreviewEntry(entry);
        break;
      case CMD_EDIT:
        void handleEditExternal(entry);
        break;
      case CMD_QUICK_EDIT:
        setQuickEditEntry(entry);
        break;
      case CMD_TRANSFER:
        if (isRemote) void onDownload(entry.path, entry.name);
        else void onUpload(entry.path, entry.name);
        break;
      case CMD_RENAME:
        setRenameTarget(entry);
        setRenameTo(entry.name);
        break;
      case CMD_DELETE:
        setDeleteTarget(entry);
        break;
      case CMD_MKDIR:
        setShowMkdir(true);
        break;
      case CMD_BULK_TRANSFER:
        void handleBulkTransfer(Array.from(activeSelection), isRemote);
        break;
      case CMD_BULK_DELETE:
        void handleBulkDelete(Array.from(activeSelection));
        break;
      case CMD_SYNC:
        onSyncFolder?.(entry);
        break;
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);

    // Finder -> remote pane
    if (mode === "remote" && onDropFromLocal) {
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const filePath = window.nexusAPI.webUtils.getPathForFile(file);
        if (filePath) {
          console.log("[FilePane:drop:finder->remote]", { filePath, name: file.name });
          await onDropFromLocal(filePath, file.name);
        }
      }
      return;
    }

    // Internal: remote path data -> local pane = download
    const draggedRemotePath = e.dataTransfer.getData("application/nexus-remote-path");
    const draggedName = e.dataTransfer.getData("application/nexus-file-name");
    if (mode === "local" && draggedRemotePath && onDropFromRemote) {
      console.log("[FilePane:drop:remote->local]", { draggedRemotePath, draggedName });
      await onDropFromRemote(draggedRemotePath, draggedName);
      return;
    }

    // Internal: local path data -> remote pane = upload
    const draggedLocalPath = e.dataTransfer.getData("application/nexus-local-path");
    const draggedLocalName = e.dataTransfer.getData("application/nexus-file-name");
    if (mode === "remote" && draggedLocalPath && onDropFromLocal) {
      console.log("[FilePane:drop:local->remote]", { draggedLocalPath, draggedLocalName });
      await onDropFromLocal(draggedLocalPath, draggedLocalName);
    }
  }

  function handleDragStart(e: React.DragEvent, entry: FsEntry) {
    if (mode === "local") {
      e.dataTransfer.setData("application/nexus-local-path", entry.path);
      e.dataTransfer.setData("application/nexus-file-name", entry.name);
    } else {
      e.dataTransfer.setData("application/nexus-remote-path", entry.path);
      e.dataTransfer.setData("application/nexus-file-name", entry.name);
      // Lets Chromium drag this file straight out to Finder (or any other app):
      // it fetches nexus-drag://<sessionId>/<path> only once the OS drop target
      // actually accepts it, in parallel with (not instead of) the in-app drag
      // data above, so dropping onto the local pane is unaffected.
      if (!entry.isDir) {
        e.dataTransfer.setData(
          "DownloadURL",
          `application/octet-stream:${entry.name}:nexus-drag://${sessionId}/${encodeURIComponent(entry.path)}`,
        );
      }
    }
  }

  const entries = listQuery.data?.entries ?? [];
  const sorted = [...entries].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div
      className={cn(
        "h-full flex flex-col border-r border-separator last:border-r-0 transition-colors",
        isDragOver && "bg-accent/5 ring-2 ring-inset ring-accent/30",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-separator bg-control-subtle/20">
        <div className="flex items-center gap-1 shrink-0">
          {mode === "local" ? (
            <ArrowUpIcon className="size-3.5 text-support-green" />
          ) : (
            <ArrowDownIcon className="size-3.5 text-support-blue" />
          )}
          <Text variant="small-strong" color="secondary">
            {mode === "local" ? "Local" : "Remote"}
          </Text>
        </div>
        <div className="flex-1 min-w-0 mx-1">
          <Input
            size="small"
            variant="filled"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onNavigate(pathInput);
            }}
            onBlur={() => setPathInput(path)}
            className="w-full font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {placesEnabled && (
            <Button
              variant="transparent"
              size="small"
              iconOnly
              onClick={() => void handlePlacesMenu()}
              aria-label="Bookmarks and recent locations"
            >
              <StarIcon
                className={cn(
                  "size-3.5",
                  bookmarksQuery.data?.bookmarks.some((b) => b.path === path) ? "text-support-yellow" : "text-secondary",
                )}
              />
            </Button>
          )}
          {searchable && (
            <Button
              variant="transparent"
              size="small"
              iconOnly
              onClick={() => setShowSearch(true)}
              aria-label="Search this folder"
            >
              <SearchIcon className="size-3.5 text-secondary" />
            </Button>
          )}
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => setShowMkdir(true)}
            aria-label="New folder"
          >
            <FolderPlusIcon className="size-3.5 text-secondary" />
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => void qc.invalidateQueries({ queryKey })}
            aria-label="Refresh"
          >
            <RefreshCwIcon className={cn("size-3.5 text-secondary", listQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="border-b border-separator">
        <Breadcrumbs path={path} onNavigate={onNavigate} />
      </div>

      {/* File list */}
      <ScrollArea className="flex-1 min-h-0">
        {listQuery.isPending ? (
          <div className="flex items-center justify-center h-24">
            <Loader2Icon className="size-4 animate-spin text-tertiary" />
          </div>
        ) : listQuery.isError ? (
          <div className="p-4">
            <Text color="secondary" variant="small">{listQuery.error.message}</Text>
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            title="Empty folder"
            placement="center"
          />
        ) : (
          <div className="py-1">
            {path !== "/" && (
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-control-subtle text-left transition-colors"
                onClick={() => onNavigate(parentPath(path))}
              >
                <FolderIcon className="size-4 text-tertiary shrink-0" />
                <Text variant="small" color="tertiary">..</Text>
              </button>
            )}
            {sorted.map((entry, index) => (
              <FileRow
                key={entry.path}
                entry={entry}
                selected={selectedPaths.has(entry.path)}
                onClick={(e) => handleRowClick(entry, index, e)}
                onDoubleClick={() => handleDoubleClick(entry)}
                onContextMenu={(e) => void handleContextMenu(entry, e)}
                onDragStart={(e) => handleDragStart(e, entry)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Mkdir dialog */}
      <Dialog
        open={showMkdir}
        onOpenChange={setShowMkdir}
        title="New Folder"
        size="small"
        confirmLabel="Create"
        onConfirm={() => {
          if (mkdirName.trim()) mkdirMutation.mutate(mkdirName.trim());
        }}
        confirmDisabled={!mkdirName.trim() || mkdirMutation.isPending}
      >
        <div className="px-4 py-3">
          <Input
            autoFocus
            placeholder="Folder name"
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mkdirName.trim()) mkdirMutation.mutate(mkdirName.trim());
            }}
          />
        </div>
      </Dialog>

      {/* Rename dialog */}
      {renameTarget && (
        <Dialog
          open={!!renameTarget}
          onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
          title={`Rename "${renameTarget.name}"`}
          size="small"
          confirmLabel="Rename"
          onConfirm={() => {
            if (renameTo.trim() && renameTo !== renameTarget.name) {
              renameMutation.mutate({
                from: renameTarget.path,
                to: joinPath(parentPath(renameTarget.path), renameTo.trim()),
              });
            }
          }}
          confirmDisabled={!renameTo.trim() || renameTo === renameTarget.name}
        >
          <div className="px-4 py-3">
            <Input
              autoFocus
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameTo.trim() && renameTo !== renameTarget.name) {
                  renameMutation.mutate({
                    from: renameTarget.path,
                    to: joinPath(parentPath(renameTarget.path), renameTo.trim()),
                  });
                }
              }}
            />
          </div>
        </Dialog>
      )}

      {/* File preview (Quick Look) */}
      {previewEntry && (
        <FilePreview
          mode={mode}
          sessionId={sessionId}
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
        />
      )}

      {/* Quick edit (in-app editor for small remote text files) */}
      {quickEditEntry && (
        <QuickEditDialog
          sessionId={sessionId}
          entry={quickEditEntry}
          onClose={() => setQuickEditEntry(null)}
          onEditExternal={() => {
            const entry = quickEditEntry;
            setQuickEditEntry(null);
            void handleEditExternal(entry);
          }}
        />
      )}

      {/* Remote content search */}
      {showSearch && (
        <SearchDialog
          sessionId={sessionId}
          rootPath={path}
          onClose={() => setShowSearch(false)}
          onNavigate={onNavigate}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={`Delete "${deleteTarget.name}"?`}
          description={
            deleteTarget.isDir
              ? "This folder and all its contents will be permanently deleted."
              : "This file will be permanently deleted."
          }
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={() => {
            deleteMutation.mutate(deleteTarget);
          }}
        />
      )}
    </div>
  );
}

interface FileRowProps {
  entry: FsEntry;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function FileRow({ entry, selected, onClick, onDoubleClick, onContextMenu, onDragStart }: FileRowProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-default select-none transition-colors group",
        selected ? "bg-accent/15 hover:bg-accent/20" : "hover:bg-control-subtle",
      )}
    >
      <div className="shrink-0">
        {entry.isDir ? (
          <FolderIcon className="size-4 text-support-yellow" />
        ) : entry.symlink ? (
          <LinkIcon className="size-4 text-tertiary" />
        ) : (
          <FileIcon className="size-4 text-secondary" />
        )}
      </div>
      <Text variant="small" truncate className="flex-1 min-w-0">{entry.name}</Text>
      {!entry.isDir && (
        <Text variant="small" color="tertiary" className="shrink-0 tabular-nums">
          {formatSize(entry.size)}
        </Text>
      )}
      <Text variant="small" color="tertiary" className="shrink-0 w-24 text-right tabular-nums">
        {formatDate(entry.mtime)}
      </Text>
    </div>
  );
}
