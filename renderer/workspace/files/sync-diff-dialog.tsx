import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, Text } from "@renderer/lib/ui";
import { Loader2Icon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { SyncPlanEntry } from "@shared/ipc-contract";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
} from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import { languageExtension, nexusHighlightStyle, editorTheme } from "./quick-edit-dialog";

interface SyncDiffDialogProps {
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
  entry: SyncPlanEntry;
  onClose: () => void;
}

/**
 * Line-level diff for one sync plan entry, fetched on demand (see sync:diff)
 * rather than eagerly for the whole plan. Built on @codemirror/merge's
 * MergeView so it gets a real side-by-side merge UI — with the same
 * syntax highlighting and theming as the quick editor — for free.
 */
export function SyncDiffDialog({ sessionId, localRoot, remoteRoot, entry, onClose }: SyncDiffDialogProps) {
  const query = useQuery({
    queryKey: ["sync-diff", sessionId, localRoot, remoteRoot, entry.relPath],
    queryFn: () => ipc.sync.diff({ sessionId, localRoot, remoteRoot, relPath: entry.relPath }),
    retry: 0,
    staleTime: 0,
  });

  const mergeContainerRef = React.useRef<HTMLDivElement>(null);
  const mergeViewRef = React.useRef<MergeView | null>(null);

  const canDiff =
    !!query.data && !query.data.local.isBinary && !query.data.remote.isBinary &&
    !query.data.local.truncated && !query.data.remote.truncated;

  React.useEffect(() => {
    if (!canDiff || !mergeContainerRef.current || mergeViewRef.current || !query.data) return;

    const shared = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      languageExtension(entry.relPath) ?? [],
      syntaxHighlighting(nexusHighlightStyle),
      editorTheme,
    ];
    const view = new MergeView({
      a: { doc: query.data.local.text, extensions: shared },
      b: { doc: query.data.remote.text, extensions: shared },
      parent: mergeContainerRef.current,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: {},
    });
    view.dom.style.height = "100%";
    view.dom.style.overflow = "auto";
    mergeViewRef.current = view;

    return () => {
      view.destroy();
      mergeViewRef.current = null;
    };
  }, [canDiff, query.data, entry.relPath]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Diff — ${entry.relPath}`}
      size="xlarge"
    >
      <div className="h-[65vh] min-h-0 flex flex-col">
        {canDiff && (
          <div className="grid grid-cols-2 gap-3 px-3 py-1.5 border-b border-separator shrink-0">
            <Text variant="small-strong" color="secondary">Local ({localRoot})</Text>
            <Text variant="small-strong" color="secondary">Remote ({remoteRoot})</Text>
          </div>
        )}

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
        ) : !canDiff ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
            <Text color="secondary">
              {query.data.local.isBinary || query.data.remote.isBinary
                ? "This looks like a binary file and can't be diffed inline."
                : "This file is too large for the inline diff (over 256 KB)."}
            </Text>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex m-3 mt-2 rounded-medium border border-separator overflow-hidden bg-control-subtle/40">
            <div ref={mergeContainerRef} className="flex-1 min-w-0 overflow-hidden" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
