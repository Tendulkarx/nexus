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
} from "@glaze/core/components";
import {
  FolderIcon,
  FileIcon,
  RefreshCwIcon,
  FolderPlusIcon,
  Loader2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  LinkIcon,
} from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { FsEntry } from "@shared/ipc-contract";
import { Breadcrumbs } from "./breadcrumbs";
import { cn } from "@glaze/core/utils";
import { toast } from "@glaze/core/components";

interface FilePaneProps {
  mode: "local" | "remote";
  path: string;
  onNavigate: (path: string) => void;
  onUpload: (localPath: string, name: string) => Promise<void>;
  onDownload: (remotePath: string, name: string) => Promise<void>;
  sessionId: string;
  onDropFromLocal?: (localPath: string, name: string) => Promise<void>;
  onDropFromRemote?: (remotePath: string, name: string) => Promise<void>;
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
  onDropFromLocal,
  onDropFromRemote,
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

  // Sync path input with prop
  React.useEffect(() => {
    setPathInput(path);
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

  function handleDoubleClick(entry: FsEntry) {
    if (entry.isDir) {
      onNavigate(entry.path);
    }
  }

  async function handleContextMenu(entry: FsEntry, e: React.MouseEvent) {
    e.preventDefault();
    console.log("[FilePane:contextMenu]", { mode, path: entry.path });

    const isRemote = mode === "remote";

    const CMD_TRANSFER = 1;
    const CMD_RENAME = 2;
    const CMD_DELETE = 3;
    const CMD_MKDIR = 4;

    const result = await window.glazeAPI.Menu.popup({
      items: [
        { label: isRemote ? "Download" : "Upload", commandId: CMD_TRANSFER },
        { type: "separator" },
        { label: "Rename", commandId: CMD_RENAME },
        { label: "Delete", commandId: CMD_DELETE },
        { type: "separator" },
        { label: "New Folder", commandId: CMD_MKDIR },
      ],
    });

    switch (result.commandId) {
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
        const filePath = window.glazeAPI.webUtils.getPathForFile(file);
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
            {sorted.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
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
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function FileRow({ entry, onDoubleClick, onContextMenu, onDragStart }: FileRowProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-control-subtle cursor-default select-none transition-colors group"
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
