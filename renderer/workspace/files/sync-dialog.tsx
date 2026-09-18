import * as React from "react";
import {
  Dialog,
  RadioGroup,
  RadioGroupItem,
  Checkbox,
  Text,
  Label,
  Button,
  toast,
} from "@renderer/lib/ui";
import { ArrowUpIcon, ArrowDownIcon, Trash2Icon, AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import type { SyncActionType, SyncMode, SyncPlanEntry } from "@shared/ipc-contract";
import { cn } from "@renderer/lib/cn";

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
}

const MODE_OPTIONS: Array<{ value: SyncMode; label: string; description: string }> = [
  { value: "upload", label: "Upload only", description: "Mirror local → remote" },
  { value: "download", label: "Download only", description: "Mirror remote → local" },
  { value: "two-way", label: "Two-way", description: "Propagate unambiguous changes both ways" },
];

const ACTION_META: Record<SyncActionType, { icon: React.ReactNode; label: string; color: string }> = {
  upload: { icon: <ArrowUpIcon className="size-3.5" />, label: "Upload", color: "text-support-green" },
  download: { icon: <ArrowDownIcon className="size-3.5" />, label: "Download", color: "text-support-blue" },
  "delete-local": { icon: <Trash2Icon className="size-3.5" />, label: "Delete local", color: "text-support-red" },
  "delete-remote": { icon: <Trash2Icon className="size-3.5" />, label: "Delete remote", color: "text-support-red" },
  conflict: { icon: <AlertTriangleIcon className="size-3.5" />, label: "Conflict", color: "text-support-yellow" },
};

function planKey(mode: SyncMode, deleteOrphans: boolean): string {
  return `${mode}|${deleteOrphans}`;
}

export function SyncDialog({ open, onOpenChange, sessionId, localRoot, remoteRoot }: SyncDialogProps) {
  const [mode, setMode] = React.useState<SyncMode>("upload");
  const [deleteOrphans, setDeleteOrphans] = React.useState(false);
  const [entries, setEntries] = React.useState<SyncPlanEntry[] | null>(null);
  const [previewedKey, setPreviewedKey] = React.useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [progress, setProgress] = React.useState<{ completed: number; total: number } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setEntries(null);
      setPreviewedKey(null);
      setProgress(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (mode === "two-way" && deleteOrphans) setDeleteOrphans(false);
  }, [mode, deleteOrphans]);

  React.useEffect(() => {
    if (!isExecuting) return;
    return ipc.sync.onProgress((payload) => {
      setProgress({ completed: payload.completed, total: payload.total });
    });
  }, [isExecuting]);

  async function handlePreview() {
    setIsPreviewing(true);
    try {
      const result = await ipc.sync.plan({ sessionId, localRoot, remoteRoot, mode, deleteOrphans });
      setEntries(result.entries);
      setPreviewedKey(planKey(mode, deleteOrphans));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!entries) return;
    const actionable = entries.filter((e) => e.action !== "conflict");
    setIsExecuting(true);
    setProgress({ completed: 0, total: actionable.length });
    try {
      const result = await ipc.sync.execute({ sessionId, localRoot, remoteRoot, entries: actionable });
      if (result.failed.length === 0) {
        toast.success(`Sync complete — ${result.completed} of ${result.total} actions`);
      } else {
        toast.error(`Sync finished with ${result.failed.length} error(s) — see "${result.failed[0].relPath}"`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsExecuting(false);
    }
  }

  const isStale = previewedKey !== planKey(mode, deleteOrphans);
  const actionableCount = entries?.filter((e) => e.action !== "conflict").length ?? 0;
  const conflictCount = entries?.filter((e) => e.action === "conflict").length ?? 0;
  const confirmDisabled = !entries || isStale || isExecuting || actionableCount === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isExecuting) onOpenChange(next);
      }}
      title="Synchronize Folder"
      size="large"
      confirmLabel={isExecuting ? "Syncing…" : `Sync ${actionableCount || ""}`.trim()}
      confirmDisabled={confirmDisabled}
      onConfirm={() => void handleConfirm()}
    >
      <div className="px-4 py-3 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <Text variant="small-strong" color="secondary">Local</Text>
            <Text variant="small" className="font-mono break-all">{localRoot}</Text>
          </div>
          <div>
            <Text variant="small-strong" color="secondary">Remote</Text>
            <Text variant="small" className="font-mono break-all">{remoteRoot}</Text>
          </div>
        </div>

        <div>
          <Text variant="small-strong" color="secondary" className="block mb-2">Mode</Text>
          <RadioGroup
            value={mode}
            onValueChange={(value) => {
              setMode(value as SyncMode);
              setEntries(null);
            }}
          >
            {MODE_OPTIONS.map((option) => (
              <Label key={option.value} className="items-start gap-2 cursor-pointer">
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span className="flex flex-col">
                  <Text variant="small-strong">{option.label}</Text>
                  <Text variant="small" color="tertiary">{option.description}</Text>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <Label className="cursor-pointer">
          <Checkbox
            checked={deleteOrphans}
            disabled={mode === "two-way"}
            onCheckedChange={(checked) => {
              setDeleteOrphans(checked === true);
              setEntries(null);
            }}
          />
          <span>
            Delete files that only exist on the other side (mirror completely)
            {mode === "two-way" && " — not available for two-way sync"}
          </span>
        </Label>

        <div className="flex items-center gap-2">
          <Button variant="filled" onClick={() => void handlePreview()} disabled={isPreviewing || isExecuting}>
            {isPreviewing ? "Comparing…" : "Preview changes"}
          </Button>
          {entries && !isStale && (
            <Text variant="small" color="tertiary">
              {actionableCount} action{actionableCount === 1 ? "" : "s"}
              {conflictCount > 0 && `, ${conflictCount} conflict${conflictCount === 1 ? "" : "s"} (skipped)`}
            </Text>
          )}
        </div>

        <div className="border border-separator rounded-medium max-h-64 overflow-y-auto">
          {!entries ? (
            <div className="flex items-center justify-center h-24">
              <Text variant="small" color="tertiary">Preview a plan to see what would change.</Text>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <Text variant="small" color="tertiary">Nothing to do — both sides already match.</Text>
            </div>
          ) : (
            entries.map((entry) => {
              const meta = ACTION_META[entry.action];
              return (
                <div
                  key={entry.relPath}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-separator last:border-b-0"
                >
                  <span className={cn("shrink-0", meta.color)}>{meta.icon}</span>
                  <Text variant="small" className={cn("shrink-0 w-24", meta.color)}>{meta.label}</Text>
                  <Text variant="small" truncate className="flex-1 min-w-0 font-mono">{entry.relPath}</Text>
                  <Text variant="small" color="tertiary" className="shrink-0">{entry.detail}</Text>
                </div>
              );
            })
          )}
        </div>

        {isExecuting && progress && (
          <div className="flex items-center gap-2">
            <Loader2Icon className="size-3.5 animate-spin text-accent" />
            <Text variant="small" color="tertiary">
              Syncing {progress.completed} / {progress.total}
            </Text>
          </div>
        )}
      </div>
    </Dialog>
  );
}
