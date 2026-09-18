import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, ScrollArea, Text } from "@renderer/lib/ui";
import { Loader2Icon, FileIcon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { FsEntry } from "@shared/ipc-contract";

interface FilePreviewProps {
  mode: "local" | "remote";
  sessionId: string;
  entry: FsEntry;
  onClose: () => void;
}

/** Quick Look-style read-only preview of a text file's contents. */
export function FilePreview({ mode, sessionId, entry, onClose }: FilePreviewProps) {
  const query = useQuery({
    queryKey: ["preview", mode, sessionId, entry.path],
    queryFn: () =>
      mode === "local"
        ? ipc.local.readFile({ path: entry.path })
        : ipc.remote.readFile({ sessionId, path: entry.path }),
    retry: 0,
    staleTime: 0,
  });

  React.useEffect(() => {
    console.log("[FilePreview:open]", { mode, path: entry.path });
  }, [mode, entry.path]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry.name}
      size="large"
      confirmLabel="Done"
      onConfirm={onClose}
    >
      <div className="h-[55vh] min-h-0 flex flex-col">
        {query.isPending ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2Icon className="size-5 animate-spin text-tertiary" />
          </div>
        ) : query.isError ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Text color="secondary" variant="small">
              {query.error.message}
            </Text>
          </div>
        ) : query.data.isBinary ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
            <FileIcon className="size-8 text-tertiary" />
            <Text color="secondary">This looks like a binary file and can't be previewed as text.</Text>
          </div>
        ) : query.data.text.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Text color="secondary">Empty file.</Text>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 rounded-medium bg-control-subtle/40 border border-separator">
            <pre className="p-3 text-xs font-mono leading-relaxed whitespace-pre text-primary">
              {query.data.text}
            </pre>
          </ScrollArea>
        )}
        {query.data?.truncated && (
          <Text color="tertiary" variant="small" className="pt-2">
            Preview truncated — showing the first part of a large file.
          </Text>
        )}
      </div>
    </Dialog>
  );
}
