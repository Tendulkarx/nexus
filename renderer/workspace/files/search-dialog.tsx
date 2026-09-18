import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, Button, Input, Text, ScrollArea, toast } from "@renderer/lib/ui";
import { SearchIcon, Loader2Icon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { SearchMatch } from "@shared/ipc-contract";

interface SearchDialogProps {
  sessionId: string;
  rootPath: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

function parentDir(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx <= 0 ? "/" : filePath.slice(0, idx);
}

/** Recursive content search within the current remote directory — sftp/ssh sessions only (see remote-search.ts). */
export function SearchDialog({ sessionId, rootPath, onClose, onNavigate }: SearchDialogProps) {
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<{ matches: SearchMatch[]; truncated: boolean } | null>(null);

  const searchMutation = useMutation({
    mutationFn: (q: string) => ipc.remote.search({ sessionId, path: rootPath, query: q }),
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => toast.error(err.message),
  });

  function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setResult(null);
    searchMutation.mutate(trimmed);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Search in ${rootPath}`}
      size="large"
      confirmLabel="Done"
      onConfirm={onClose}
    >
      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            placeholder="Text to search for…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            className="font-mono text-xs"
          />
          <Button variant="accent" onClick={runSearch} disabled={!query.trim() || searchMutation.isPending}>
            <SearchIcon className="size-3.5" />
            Search
          </Button>
        </div>

        <div className="border border-separator rounded-medium h-72 overflow-hidden">
          {searchMutation.isPending ? (
            <div className="flex items-center justify-center h-full">
              <Loader2Icon className="size-5 animate-spin text-tertiary" />
            </div>
          ) : result === null ? (
            <div className="flex items-center justify-center h-full p-6 text-center">
              <Text variant="small" color="tertiary">
                Searches file contents recursively within this folder.
              </Text>
            </div>
          ) : result.matches.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Text variant="small" color="tertiary">No matches found.</Text>
            </div>
          ) : (
            <ScrollArea className="h-full">
              {result.matches.map((m, i) => (
                <button
                  key={`${m.path}:${m.line}:${i}`}
                  className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 hover:bg-control-subtle text-left border-b border-separator last:border-b-0"
                  onClick={() => {
                    onNavigate(parentDir(m.path));
                    onClose();
                  }}
                >
                  <Text variant="small-strong" truncate className="w-full font-mono">
                    {m.path}:{m.line}
                  </Text>
                  <Text variant="small" color="tertiary" truncate className="w-full font-mono">
                    {m.snippet}
                  </Text>
                </button>
              ))}
            </ScrollArea>
          )}
        </div>

        {result?.truncated && (
          <Text variant="small" color="tertiary">
            Showing the first {result.matches.length} matches — narrow your search for a complete picture.
          </Text>
        )}
      </div>
    </Dialog>
  );
}
