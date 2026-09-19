import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, Button, Text, toast } from "@renderer/lib/ui";
import { Loader2Icon, ExternalLinkIcon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { FsEntry } from "@shared/ipc-contract";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";

interface QuickEditDialogProps {
  sessionId: string;
  entry: FsEntry;
  onClose: () => void;
  onEditExternal: () => void;
}

/**
 * Picks a CodeMirror language extension from the file name alone (quick edit
 * never has a chance to sniff shebangs/MIME types server-side). Covers the
 * common sysadmin/dev file types rather than every possible language; falls
 * back to plain text (no extension) for anything unrecognized.
 */
function languageExtension(filename: string): Extension | null {
  const name = filename.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  if (name === "dockerfile" || name.startsWith("dockerfile.")) return StreamLanguage.define(dockerFile);
  if (name.includes("nginx") && ext === "conf") return StreamLanguage.define(nginx);

  switch (ext) {
    case "sh":
    case "bash":
    case "zsh":
    case "bashrc":
    case "zshrc":
    case "profile":
      return StreamLanguage.define(shell);
    case "py":
    case "pyw":
      return python();
    case "json":
    case "jsonc":
      return json();
    case "yml":
    case "yaml":
      return yaml();
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "md":
    case "markdown":
      return markdown();
    case "sql":
      return sql();
    case "xml":
    case "xsl":
    case "xsd":
    case "svg":
    case "plist":
      return xml();
    case "html":
    case "htm":
      return html();
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
    case "cfg":
    case "properties":
    case "env":
    case "conf":
      return StreamLanguage.define(properties);
    default:
      return null;
  }
}

const nexusHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.self], color: "var(--cm-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cm-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--cm-number)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)],
    color: "var(--cm-function)",
  },
  { tag: [t.propertyName, t.attributeName], color: "var(--cm-property)" },
  { tag: [t.className, t.typeName], color: "var(--cm-type)" },
  { tag: t.tagName, color: "var(--cm-tag)" },
  { tag: [t.punctuation, t.bracket, t.angleBracket, t.operator], color: "var(--color-tertiary)" },
  { tag: t.heading, color: "var(--cm-function)", fontWeight: "600" },
  { tag: t.link, color: "var(--cm-tag)", textDecoration: "underline" },
  { tag: [t.meta, t.processingInstruction], color: "var(--color-quaternary)" },
  { tag: t.invalid, color: "var(--color-support-red)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    color: "var(--color-primary)",
    backgroundColor: "transparent",
    height: "100%",
    fontSize: "0.75rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    padding: "8px 0",
    caretColor: "var(--color-primary)",
  },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.625" },
  ".cm-gutters": {
    backgroundColor: "var(--color-control-subtle)",
    color: "var(--color-tertiary)",
    border: "none",
    borderRight: "1px solid var(--color-separator)",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-control)" },
  ".cm-activeLine": { backgroundColor: "var(--color-control-subtle)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 30%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--color-primary)" },
});

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
  const contentRef = React.useRef("");
  const editorContainerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);

  const canEdit = !!query.data && !query.data.isBinary && !query.data.truncated;

  React.useEffect(() => {
    if (canEdit && content === null) setContent(query.data!.text);
  }, [canEdit, content, query.data]);

  React.useEffect(() => {
    if (content === null || !editorContainerRef.current || viewRef.current) return;

    contentRef.current = content;
    const view = new EditorView({
      parent: editorContainerRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          languageExtension(entry.name) ?? [],
          syntaxHighlighting(nexusHighlightStyle),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) contentRef.current = update.state.doc.toString();
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [content, entry.name]);

  const saveMutation = useMutation({
    mutationFn: () => ipc.edit.quickSave({ sessionId, path: entry.path, content: contentRef.current }),
    onSuccess: () => {
      toast.success(`Saved "${entry.name}"`);
      void qc.invalidateQueries({ queryKey: ["preview", "remote", sessionId, entry.path] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
            <Text color="secondary" variant="small">
              {query.error.message}
            </Text>
          </div>
        ) : !canEdit ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
            <Text color="secondary">
              {query.data.isBinary
                ? "This looks like a binary file and can't be edited inline."
                : "This file is too large for the inline editor (over 256 KB)."}
            </Text>
            <Text color="tertiary" variant="small">
              Use "Edit in External App" instead.
            </Text>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex m-3 mt-2 rounded-medium border border-separator overflow-hidden bg-control-subtle/40">
            <div ref={editorContainerRef} className="flex-1 min-w-0 overflow-hidden" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
