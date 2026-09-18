import * as React from "react";
import { Tabs as Rx } from "radix-ui";
import { cn } from "../cn";

export const TabsRoot = Rx.Root;

interface TabsProps extends React.ComponentPropsWithoutRef<typeof Rx.List> {
  size?: "small" | "medium";
  variant?: "default" | "transparent";
}

export function Tabs({ size = "medium", variant = "default", className, ...props }: TabsProps) {
  return (
    <Rx.List
      className={cn(
        "flex items-center",
        size === "small" ? "gap-0.5" : "gap-1",
        variant === "transparent" ? "bg-transparent" : "bg-control-subtle/40 rounded-medium p-0.5",
        className,
      )}
      {...props}
    />
  );
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof Rx.Trigger>>(
  ({ className, ...props }, ref) => (
    <Rx.Trigger
      ref={ref}
      className={cn(
        "flex items-center px-3 py-2 text-sm text-secondary border-b-2 border-transparent transition-colors",
        "data-[state=active]:text-primary data-[state=active]:border-accent",
        "hover:text-primary",
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = Rx.Content;
