import * as React from "react";
import { PanelGroup as Rx, Panel as RxPanel, PanelResizeHandle } from "react-resizable-panels";
import { cn } from "../cn";

interface PanelGroupProps extends Omit<React.ComponentPropsWithoutRef<typeof Rx>, "direction"> {
  storageKey?: string;
  direction?: React.ComponentPropsWithoutRef<typeof Rx>["direction"];
}

/** Resizable dual-pane layout. */
export function PanelGroup({ storageKey, className, children, direction = "horizontal", ...props }: PanelGroupProps) {
  return (
    <Rx
      direction={direction}
      autoSaveId={storageKey}
      className={cn("flex", className)}
      {...props}
    >
      {React.Children.toArray(children).flatMap((child, i) =>
        i === 0 ? [child] : [<PanelResizeHandle key={`handle-${i}`} className="w-px bg-separator hover:bg-accent/50 transition-colors" />, child],
      )}
    </Rx>
  );
}

interface PanelProps extends React.ComponentPropsWithoutRef<typeof RxPanel> {
  /** Pixel-ish minimum hint from the original API; react-resizable-panels uses percentages. */
  minSize?: number;
}

export function Panel({ minSize, className, ...props }: PanelProps) {
  return <RxPanel minSize={minSize ? Math.min(40, minSize / 10) : undefined} className={cn("min-w-0", className)} {...props} />;
}
