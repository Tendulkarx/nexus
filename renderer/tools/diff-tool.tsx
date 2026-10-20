/**
 * Side-by-side diff of two texts. Both sides are editable — paste into
 * either, or open a local file — and differences update as you type. Built on
 * the same @codemirror/merge MergeView and editor theme as the sync diff.
 */
import * as React from "react";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
} from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import { ArrowLeftRightIcon, FileIcon } from "lucide-react";
import { Button, toast } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import { languageExtension, nexusHighlightStyle, editorTheme } from "@renderer/workspace/files/quick-edit-dialog";
import { ToolLayout } from "./tool-layout";

interface Side {
  name: string | null;
  doc: string;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function DiffTool() {
  // Docs live in refs so typing doesn't re-render; `sides` only changes when a
  // file is opened or the sides swap, which rebuilds the view with the right language.
  const docs = React.useRef<[string, string]>(["", ""]);
  const [sides, setSides] = React.useState<[Side, Side]>([
    { name: null, doc: "" },
    { name: null, doc: "" },
  ]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const extensions = (index: 0 | 1) => [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      EditorView.lineWrapping,
      sides[index].name ? (languageExtension(sides[index].name!) ?? []) : [],
      syntaxHighlighting(nexusHighlightStyle),
      editorTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) docs.current[index] = u.state.doc.toString();
      }),
      EditorView.contentAttributes.of({ "aria-label": index === 0 ? "Left text" : "Right text" }),
    ];
    const view = new MergeView({
      a: { doc: sides[0].doc, extensions: extensions(0) },
      b: { doc: sides[1].doc, extensions: extensions(1) },
      parent: containerRef.current,
      gutter: true,
      highlightChanges: true,
    });
    view.dom.style.height = "100%";
    docs.current = [sides[0].doc, sides[1].doc];
    return () => view.destroy();
  }, [sides]);

  async function openFile(index: 0 | 1) {
    const result = await window.nexusAPI.dialog.showOpenDialog({
      title: "Open file to compare",
      properties: ["openFile"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return;
    try {
      const file = await ipc.local.readFile({ path });
      if (file.isBinary) {
        toast.error(`${basename(path)} looks like a binary file`);
        return;
      }
      if (file.truncated) toast.warning(`Only the first part of ${basename(path)} is shown (it's over the size limit)`);
      const next: [Side, Side] = [
        { name: sides[0].name, doc: docs.current[0] },
        { name: sides[1].name, doc: docs.current[1] },
      ];
      next[index] = { name: path, doc: file.text };
      setSides(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read the file");
    }
  }

  function swap() {
    setSides([
      { name: sides[1].name, doc: docs.current[1] },
      { name: sides[0].name, doc: docs.current[0] },
    ]);
  }

  function sideLabel(index: 0 | 1) {
    const name = sides[index].name;
    return name ? basename(name) : index === 0 ? "Left: paste or open a file" : "Right: paste or open a file";
  }

  return (
    <ToolLayout
      title="Diff"
      description="Paste text into each side or open local files. Both sides stay editable."
      form={
        <div className="flex w-full items-center gap-2">
          <Button variant="filled" onClick={() => void openFile(0)} className="gap-1.5">
            <FileIcon className="size-3.5" aria-hidden="true" />
            Open left…
          </Button>
          <span className="flex-1 truncate text-xs text-secondary" title={sides[0].name ?? undefined}>
            {sideLabel(0)}
          </span>
          <Button variant="transparent" iconOnly onClick={swap} aria-label="Swap sides">
            <ArrowLeftRightIcon className="size-3.5" />
          </Button>
          <span className="flex-1 truncate text-right text-xs text-secondary" title={sides[1].name ?? undefined}>
            {sideLabel(1)}
          </span>
          <Button variant="filled" onClick={() => void openFile(1)} className="gap-1.5">
            <FileIcon className="size-3.5" aria-hidden="true" />
            Open right…
          </Button>
        </div>
      }
    >
      <div ref={containerRef} className="h-full" />
    </ToolLayout>
  );
}
