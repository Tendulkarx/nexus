import * as React from "react";
import { RadioGroup as Rx } from "radix-ui";
import { cn } from "../cn";

interface RadioGroupProps extends React.ComponentPropsWithoutRef<typeof Rx.Root> {
  orientation?: "horizontal" | "vertical";
}

export function RadioGroup({ orientation = "vertical", className, ...props }: RadioGroupProps) {
  return (
    <Rx.Root
      className={cn("flex gap-3", orientation === "horizontal" ? "flex-row items-center" : "flex-col", className)}
      {...props}
    />
  );
}

export const RadioGroupItem = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof Rx.Item>>(
  ({ className, ...props }, ref) => (
    <Rx.Item
      ref={ref}
      className={cn(
        "flex size-4 items-center justify-center rounded-full border border-field outline-none",
        "data-[state=checked]:border-accent",
        className,
      )}
      {...props}
    >
      <Rx.Indicator className="size-2 rounded-full bg-accent" />
    </Rx.Item>
  ),
);
RadioGroupItem.displayName = "RadioGroupItem";
