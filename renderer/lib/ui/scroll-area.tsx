import * as React from "react";
import { ScrollArea as Rx } from "radix-ui";
import { cn } from "../cn";

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof Rx.Root> {
  /** Optional header rendered above the scrollable area (e.g. a Toolbar). */
  toolbar?: React.ReactNode;
  /** Accessible label; not rendered visually (kept for API parity). */
  title?: string;
  scrollbars?: "vertical" | "horizontal" | "both";
}

export function ScrollArea({ toolbar, title, scrollbars = "vertical", className, children, ...props }: ScrollAreaProps) {
  return (
    <div className={cn("flex h-full flex-col min-h-0", className)} aria-label={title}>
      {toolbar}
      <Rx.Root className="flex-1 min-h-0 overflow-hidden" {...props}>
        <Rx.Viewport className="h-full w-full">{children}</Rx.Viewport>
        {(scrollbars === "vertical" || scrollbars === "both") && (
          <Rx.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
            <Rx.Thumb className="relative flex-1 rounded-full bg-tertiary/40" />
          </Rx.Scrollbar>
        )}
        {(scrollbars === "horizontal" || scrollbars === "both") && (
          <Rx.Scrollbar orientation="horizontal" className="flex h-2 touch-none select-none p-0.5">
            <Rx.Thumb className="relative flex-1 rounded-full bg-tertiary/40" />
          </Rx.Scrollbar>
        )}
      </Rx.Root>
    </div>
  );
}
