/**
 * Reusable command-snippet library: add/edit/delete named commands (stored
 * via main/services/snippet-store.ts), and — when opened with an `onRun`
 * callback from an active terminal — run one by sending its text straight to
 * the backend PTY, the same path terminal-pane.tsx uses for user keystrokes.
 * Recorded macros (snippets with `macro` steps, made with a terminal's record
 * button) live in the same list; only their name and tags are editable here.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, PencilIcon, TrashIcon, PlayIcon } from "lucide-react";
import { Badge, Dialog, Button, Input, Field, FieldSet, Text, toast } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { CommandSnippet } from "@shared/ipc-contract";

interface SnippetLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, each row gets a Run button that calls this with the snippet (or macro) to run. */
  onRun?: (snippet: CommandSnippet) => void;
}

interface EditState {
  /** null means "creating a new snippet" rather than editing an existing one. */
  id: string | null;
  name: string;
  command: string;
  tags: string;
  /** Editing a recorded macro: its keystrokes aren't editable, so the command field is hidden. */
  isMacro: boolean;
}

const EMPTY_EDIT: EditState = { id: null, name: "", command: "", tags: "", isMacro: false };

export function SnippetLibraryDialog({ open, onOpenChange, onRun }: SnippetLibraryDialogProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<EditState | null>(null);

  const snippetsQuery = useQuery({
    queryKey: ["snippets"],
    queryFn: () => ipc.snippet.list(),
    enabled: open,
  });
  const snippets = snippetsQuery.data?.snippets ?? [];

  const saveMutation = useMutation({
    mutationFn: async (edit: EditState) => {
      const input = {
        name: edit.name.trim(),
        command: edit.command,
        tags: edit.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (edit.id) return ipc.snippet.update({ id: edit.id, patch: input });
      return ipc.snippet.create({ input });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["snippets"] });
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ipc.snippet.delete({ id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["snippets"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  function startEdit(snippet: CommandSnippet) {
    setEditing({
      id: snippet.id,
      name: snippet.name,
      command: snippet.command,
      tags: snippet.tags.join(", "),
      isMacro: Boolean(snippet.macro),
    });
  }

  const isValid = Boolean(editing?.name.trim() && editing?.command.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setEditing(null);
      }}
      title="Snippets & Macros"
      size="medium"
    >
      {editing ? (
        <div className="flex flex-col px-4 py-3 gap-1">
          <FieldSet title={editing.id ? "Edit Snippet" : "New Snippet"} className="border-b-0 pb-0 mb-0">
            <Field label="Name" orientation="horizontal">
              <Input
                autoFocus
                placeholder="Restart nginx"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            {!editing.isMacro && (
              <Field label="Command" orientation="horizontal">
                <textarea
                  placeholder="sudo systemctl restart nginx"
                  value={editing.command}
                  onChange={(e) => setEditing({ ...editing, command: e.target.value })}
                  rows={3}
                  className="w-full rounded-medium border border-field bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/40 placeholder:text-tertiary font-mono"
                />
              </Field>
            )}
            <Field label="Tags" description="Comma-separated" orientation="horizontal">
              <Input
                placeholder="ops, nginx"
                value={editing.tags}
                onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
              />
            </Field>
          </FieldSet>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="filled" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={!isValid || saveMutation.isPending}
              onClick={() => saveMutation.mutate(editing)}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-center justify-end px-4 py-2 border-b border-separator">
            <Button variant="filled" size="small" onClick={() => setEditing(EMPTY_EDIT)}>
              <PlusIcon className="size-3.5 mr-1" />
              New Snippet
            </Button>
          </div>
          {snippets.length === 0 ? (
            <div className="p-4">
              <Text color="secondary">
                No snippets yet. Add one to reuse it across terminals, or record a macro with a terminal&apos;s ●
                button.
              </Text>
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="flex items-center gap-2.5 px-4 py-2.5 border-b border-separator last:border-b-0"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Text variant="strong" truncate>
                      {snippet.name}
                    </Text>
                    {snippet.macro && <Badge color="purple">Macro</Badge>}
                  </div>
                  <Text variant="small" color="tertiary" truncate className="font-mono">
                    {snippet.command}
                  </Text>
                </div>
                {onRun && (
                  <Button
                    variant="filled"
                    size="small"
                    iconOnly
                    onClick={() => {
                      onRun(snippet);
                      onOpenChange(false);
                    }}
                    aria-label={`Run ${snippet.name}`}
                  >
                    <PlayIcon className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="transparent"
                  size="small"
                  iconOnly
                  onClick={() => startEdit(snippet)}
                  aria-label={`Edit ${snippet.name}`}
                >
                  <PencilIcon className="size-3.5 text-secondary" />
                </Button>
                <Button
                  variant="transparent"
                  size="small"
                  iconOnly
                  onClick={() => deleteMutation.mutate(snippet.id)}
                  aria-label={`Delete ${snippet.name}`}
                >
                  <TrashIcon className="size-3.5 text-secondary" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </Dialog>
  );
}
