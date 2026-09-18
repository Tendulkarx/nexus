import * as React from "react";
import { Button, Text, ScrollArea } from "@renderer/lib/ui";
import {
  XIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  Loader2Icon,
  ClockIcon,
  BanIcon,
} from "lucide-react";
import type { TransferItem, TransferStatus } from "@shared/ipc-contract";

interface TransferQueuePanelProps {
  transfers: TransferItem[];
  onCancel: (transferId: string) => Promise<void>;
  onClose: () => void;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_ICONS: Record<TransferStatus, React.ReactNode> = {
  queued: <ClockIcon className="size-4 text-tertiary" />,
  active: <Loader2Icon className="size-4 text-accent animate-spin" />,
  done: <CheckCircle2Icon className="size-4 text-support-green" />,
  error: <AlertCircleIcon className="size-4 text-support-red" />,
  canceled: <BanIcon className="size-4 text-tertiary" />,
};

function TransferRow({ transfer, onCancel }: { transfer: TransferItem; onCancel: (id: string) => void }) {
  const progress =
    transfer.total > 0 ? Math.min(1, transfer.transferred / transfer.total) : 0;
  const isActive = transfer.status === "active" || transfer.status === "queued";

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 border-b border-separator last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="shrink-0">
          {transfer.direction === "upload" ? (
            <ArrowUpIcon className="size-3.5 text-support-green" />
          ) : (
            <ArrowDownIcon className="size-3.5 text-support-blue" />
          )}
        </div>
        <Text variant="small" truncate className="flex-1 min-w-0">{transfer.name}</Text>
        <div className="shrink-0">{STATUS_ICONS[transfer.status]}</div>
        {isActive && (
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => onCancel(transfer.transferId)}
            aria-label="Cancel"
          >
            <XIcon className="size-3.5 text-secondary" />
          </Button>
        )}
      </div>

      {transfer.status === "active" && (
        <>
          <div className="h-1 rounded-pill bg-control overflow-hidden">
            <div
              className="h-full bg-accent rounded-pill transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Text variant="small" color="tertiary" className="tabular-nums">
              {formatSize(transfer.transferred)} / {formatSize(transfer.total)}
            </Text>
            <Text variant="small" color="tertiary" className="tabular-nums">
              {formatSpeed(transfer.bytesPerSec)}
            </Text>
          </div>
        </>
      )}

      {transfer.status === "error" && transfer.error && (
        <Text variant="small" color="tertiary" truncate>{transfer.error}</Text>
      )}
    </div>
  );
}

export function TransferQueuePanel({ transfers, onCancel, onClose }: TransferQueuePanelProps) {
  const active = transfers.filter((t) => t.status === "active" || t.status === "queued");
  const rest = transfers.filter((t) => t.status !== "active" && t.status !== "queued");

  return (
    <div className="border-t border-separator bg-popover shrink-0 max-h-60 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-separator shrink-0">
        <Text variant="small-strong" className="flex-1">
          Transfers
          {active.length > 0 && (
            <span className="ml-1.5 text-tertiary font-normal">({active.length} active)</span>
          )}
        </Text>
        <Button variant="transparent" size="small" iconOnly onClick={onClose} aria-label="Close">
          <XIcon className="size-3.5 text-secondary" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0" scrollbars="vertical">
        {transfers.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <Text variant="small" color="tertiary">No transfers</Text>
          </div>
        ) : (
          <>
            {[...active, ...rest].map((t) => (
              <TransferRow key={t.transferId} transfer={t} onCancel={onCancel} />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
