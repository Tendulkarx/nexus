import { useQuery } from "@tanstack/react-query";
import { ipc } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/cn";

/** A per-profile TCP reachability probe, checked lazily as each card/row mounts (not a sweep of every profile). */
export function useReachability(host: string, port: number) {
  return useQuery({
    queryKey: ["reachability", host, port],
    queryFn: () => ipc.connections.checkReachability({ host, port }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

const DOT_COLOR = {
  reachable: "bg-support-green",
  unreachable: "bg-red-500",
  unknown: "bg-tertiary/40",
} as const;

const DOT_LABEL = {
  reachable: "Reachable",
  unreachable: "Unreachable",
  unknown: "Not checked yet",
} as const;

interface HealthDotProps {
  host: string;
  port: number;
  className?: string;
}

export function HealthDot({ host, port, className }: HealthDotProps) {
  const { data } = useReachability(host, port);
  const status = data === undefined ? "unknown" : data.reachable ? "reachable" : "unreachable";
  return (
    <span
      className={cn("inline-block size-2 rounded-full shrink-0", DOT_COLOR[status], className)}
      title={DOT_LABEL[status]}
    />
  );
}

/** Relative "last connected" label, matching this repo's plain Date-based formatting (no date library). */
export function formatLastConnected(lastConnectedAt?: number | null): string {
  if (!lastConnectedAt) return "Never";
  const minutes = Math.floor((Date.now() - lastConnectedAt) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(lastConnectedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
