import * as React from "react";
import { FolderOpenIcon } from "lucide-react";
import { cn } from "@renderer/lib/cn";
import { Button, Input } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { FolderCompareResult, FolderCompareSide, FolderCompareStatus } from "@shared/ipc-contract";
import { ToolLayout, Field, ResultsTable, EmptyResults } from "./tool-layout";
import { cleanIpcError } from "./use-scan";

const STATUS_LABEL: Record<FolderCompareStatus, string> = {
  different: "Different",
  "left-only": "Only left",
  "right-only": "Only right",
  same: "Same",
};

const STATUS_CLASS: Record<FolderCompareStatus, string> = {
  different: "bg-support-yellow/15 text-primary",
  "left-only": "bg-support-blue/15 text-primary",
  "right-only": "bg-support-red/15 text-primary",
  same: "bg-control-subtle text-secondary",
};

const FILTERS: FolderCompareStatus[] = ["different", "left-only", "right-only", "same"];

function formatSide(side?: FolderCompareSide): string {
  if (!side) return "—";
  const size =
    side.size < 1024
      ? `${side.size} B`
      : side.size < 1024 ** 2
        ? `${(side.size / 1024).toFixed(1)} KB`
        : `${(side.size / 1024 ** 2).toFixed(1)} MB`;
  const date = new Date(side.mtime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${size} · ${date}`;
}

async function chooseFolder(): Promise<string | null> {
  const result = await window.nexusAPI.dialog.showOpenDialog({
    title: "Choose a folder",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function FolderCompareTool() {
  const [left, setLeft] = React.useState("");
  const [right, setRight] = React.useState("");
  const [result, setResult] = React.useState<FolderCompareResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  // "Same" is hidden by default: the interesting rows are the differences.
  const [shown, setShown] = React.useState<Set<FolderCompareStatus>>(new Set(["different", "left-only", "right-only"]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      setResult(await ipc.tools.compareFolders({ left, right }));
    } catch (err) {
      setResult(null);
      setError(cleanIpcError(err instanceof Error ? err.message : String(err)));
    } finally {
      setRunning(false);
    }
  }

  function toggle(status: FolderCompareStatus) {
    const next = new Set(shown);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setShown(next);
  }

  const counts = Object.fromEntries(FILTERS.map((f) => [f, 0])) as Record<FolderCompareStatus, number>;
  for (const entry of result?.entries ?? []) counts[entry.status]++;
  const rows = result?.entries.filter((e) => shown.has(e.status)) ?? [];

  const folderField = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label} className="flex-1 min-w-56">
      <div className="flex gap-1">
        <Input value={value} onChange={(e) => set(e.target.value)} placeholder="/Users/you/folder" required />
        <Button
          type="button"
          variant="filled"
          iconOnly
          aria-label={`Choose ${label.toLowerCase()}`}
          onClick={() => void chooseFolder().then((p) => p && set(p))}
        >
          <FolderOpenIcon className="size-3.5" />
        </Button>
      </div>
    </Field>
  );

  return (
    <ToolLayout
      title="Folder compare"
      description="Compares two local folders by file name, size and modified time. File contents aren't read."
      status={
        error ? (
          <span className="text-support-red">{error}</span>
        ) : result ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={shown.has(f)}
                onClick={() => toggle(f)}
                className={cn(
                  "rounded-pill border px-2.5 py-0.5 text-xs transition-colors",
                  shown.has(f) ? "border-accent text-primary bg-accent/10" : "border-separator text-secondary",
                )}
              >
                {STATUS_LABEL[f]} {counts[f]}
              </button>
            ))}
            {result.truncated && <span>Partial: stopped at 20,000 files per side.</span>}
          </div>
        ) : null
      }
      form={
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2 w-full">
          {folderField("Left folder", left, setLeft)}
          {folderField("Right folder", right, setRight)}
          <Button type="submit" variant="accent" disabled={running} className="w-24">
            {running ? "Comparing…" : "Compare"}
          </Button>
        </form>
      }
    >
      {!result ? (
        <EmptyResults>{running ? "Reading both folders…" : "Choose two folders to compare."}</EmptyResults>
      ) : rows.length === 0 ? (
        <EmptyResults>
          {result.entries.length === 0 ? "Both folders are empty." : "Nothing matches the selected filters."}
        </EmptyResults>
      ) : (
        <ResultsTable columns={["Status", "File", "Left", "Right"]}>
          {rows.map((entry) => (
            <tr key={entry.relPath} className="border-b border-separator/50">
              <td className="px-5 py-1.5">
                <span className={cn("rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap", STATUS_CLASS[entry.status])}>
                  {STATUS_LABEL[entry.status]}
                </span>
              </td>
              <td className="px-5 py-1.5 font-mono text-xs break-all">{entry.relPath}</td>
              <td className="px-5 py-1.5 text-xs text-secondary whitespace-nowrap">{formatSide(entry.left)}</td>
              <td className="px-5 py-1.5 text-xs text-secondary whitespace-nowrap">{formatSide(entry.right)}</td>
            </tr>
          ))}
        </ResultsTable>
      )}
    </ToolLayout>
  );
}
