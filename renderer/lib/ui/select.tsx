import * as React from "react";
import { Select as Rx } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "../cn";

export const Select = Rx.Root;

interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof Rx.Trigger> {
  variant?: "default" | "filled";
  size?: "small" | "default";
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ variant = "default", size = "default", className, children, ...props }, ref) => (
    <Rx.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-between gap-1.5 rounded-medium border border-field bg-transparent outline-none",
        "focus:border-accent focus:ring-1 focus:ring-accent/40",
        variant === "filled" && "bg-control border-transparent",
        size === "small" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-sm",
        className,
      )}
      {...props}
    >
      {children}
      <Rx.Icon asChild>
        <ChevronDownIcon className="size-3.5 text-tertiary" />
      </Rx.Icon>
    </Rx.Trigger>
  ),
);
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = Rx.Value;

export function SelectContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof Rx.Content>) {
  return (
    <Rx.Portal>
      <Rx.Content
        className={cn(
          "z-50 overflow-hidden rounded-medium border border-field bg-popover shadow-lg",
          className,
        )}
        {...props}
      >
        <Rx.Viewport className="p-1">{children}</Rx.Viewport>
      </Rx.Content>
    </Rx.Portal>
  );
}

export const SelectItem = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Rx.Item>>(
  ({ className, children, ...props }, ref) => (
    <Rx.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-medium py-1.5 pl-6 pr-2 text-sm outline-none",
        "data-[highlighted]:bg-control-subtle",
        className,
      )}
      {...props}
    >
      <span className="absolute left-1.5 flex size-3.5 items-center justify-center">
        <Rx.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </Rx.ItemIndicator>
      </span>
      <Rx.ItemText>{children}</Rx.ItemText>
    </Rx.Item>
  ),
);
SelectItem.displayName = "SelectItem";
