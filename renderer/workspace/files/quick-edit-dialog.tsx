import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, Button, Text, toast } from "@renderer/lib/ui";
import { Loader2Icon, ExternalLinkIcon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { FsEntry } from "@shared/ipc-contract";

interface QuickEditDialogProps {
  sessionId: string;
  entry: FsEntry;
  onClose: () => void;
  onEditExternal: () => void;
}

/**
 * In-app editor for small remote text files — a fast path alongside the
 * external-editor round trip (edit-manager.ts) for files that don't need a
 * whole download/watch/re-upload cycle. Reuses remote:readFile's existing
 * size cutoff (PREVIEW_MAX_BYTES) and binary sniff to decide eligibility;
 * anything too large or binary falls back to "Edit in External App".
 */
export function QuickEditDialog({ sessionId, entry, onClose, onEditExternal }: QuickEditDialogProps) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["quick-edit", sessionId, entry.path],
    queryFn: () => ipc.remote.readFile({ sessionId, path: entry.path }),
    retry: 0,
    staleTime: 0,
  });

  const [content, setContent] = React.useState<string | null>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);

  const canEdit = !!query.data && !query.data.isBinary && !query.data.truncated;

  React.useEffect(() => {
    if (canEdit && content === null) setContent(query.data!.text);
  }, [canEdit, content, query.data]);

  const saveMutation = useMutation({
    mutationFn: () => ipc.edit.quickSave({ sessionId, path: entry.path, content: content ?? "" }),
    onSuccess: () => {
      toast.success(`Saved "${entry.name}"`);
      void qc.invalidateQueries({ queryKey: ["preview", "remote", sessionId, entry.path] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const lineCount = content ? content.split("\n").length : 1;

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry.name}
      size="large"
      confirmLabel={canEdit ? (saveMutation.isPending ? "Saving…" : "Save") : undefined}
      confirmDisabled={!canEdit || content === null || saveMutation.isPending}
      onConfirm={() => saveMutation.mutate()}
    >
      <div className="h-[55vh] min-h-0 flex flex-col">
        <div className="flex items-center justify-end px-3 py-1.5 border-b border-separator shrink-0">
          <Button variant="transparent" size="small" onClick={onEditExternal}>
            <ExternalLinkIcon className="size-3.5" />
            Edit in External App
          </Button>
        </div>

        {query.isPending ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2Icon className="size-5 animate-spin text-tertiary" />
          </div>
        ) : query.isError ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Text color="secondary" variant="small">{query.error.message}</Text>
          </div>
        ) : !canEdit ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
            <Text color="secondary">
              {query.data.isBinary
                ? "This looks like a binary file and can't be edited inline."
                : "This file is too large for the inline editor (over 256 KB)."}
            </Text>
            <Text color="tertiary" variant="small">Use "Edit in External App" instead.</Text>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex m-3 mt-2 rounded-medium border border-separator overflow-hidden bg-control-subtle/40">
            <div
              ref={gutterRef}
              className="overflow-hidden select-none text-right px-2 py-2 text-xs font-mono leading-relaxed text-tertiary bg-control-subtle/60 border-r border-separator"
              style={{ minWidth: `${String(lineCount).length + 2}ch` }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={content ?? ""}
              onChange={(e) => setContent(e.target.value)}
              onScroll={handleScroll}
              spellCheck={false}
              autoFocus
              className="flex-1 min-w-0 resize-none outline-none p-2 text-xs font-mono leading-relaxed bg-transparent text-primary"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
