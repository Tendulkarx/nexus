import { cn } from "@renderer/lib/cn";
import { statusAppearance, useSessionStatus } from "@renderer/lib/session-status";

/** Coloured connection dot for an open session, labelled for VoiceOver and on hover. */
export function SessionDot({ sessionId, className }: { sessionId: string; className?: string }) {
  const { dotClass, label } = statusAppearance(useSessionStatus(sessionId));
  return (
    <span role="img" aria-label={label} title={label} className={cn("shrink-0 rounded-full", dotClass, className)} />
  );
}
