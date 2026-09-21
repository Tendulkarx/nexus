import * as React from "react";
import { Dialog as RxDialog, AlertDialog as RxAlertDialog } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "../cn";
import { Button } from "./primitives";

const SIZE_CLASSES = {
  small: "max-w-sm",
  medium: "max-w-lg",
  large: "max-w-2xl",
  xlarge: "max-w-5xl",
} as const;

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: keyof typeof SIZE_CLASSES;
  confirmLabel?: string;
  confirmVariant?: "accent" | "destructive" | "filled";
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  children: React.ReactNode;
}

/**
 * Higher-level modal dialog: a titled panel with body content and an
 * optional confirm action (callers pass `children` as the body, not as
 * `Dialog.Content` composition).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  size = "medium",
  confirmLabel,
  confirmVariant = "accent",
  confirmDisabled,
  onConfirm,
  children,
}: DialogProps) {
  return (
    <RxDialog.Root open={open} onOpenChange={onOpenChange}>
      <RxDialog.Portal>
        <RxDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RxDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-field bg-popover shadow-xl outline-none",
            SIZE_CLASSES[size],
          )}
        >
          <div className="flex items-center justify-between border-b border-separator px-4 py-3">
            <RxDialog.Title className="text-sm font-semibold text-primary">{title}</RxDialog.Title>
            <RxDialog.Close asChild>
              <Button variant="transparent" size="small" iconOnly aria-label="Close">
                <XIcon className="size-3.5" />
              </Button>
            </RxDialog.Close>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">{children}</div>

          {confirmLabel && (
            <div className="flex items-center justify-end gap-2 border-t border-separator px-4 py-3">
              <RxDialog.Close asChild>
                <Button variant="filled">Cancel</Button>
              </RxDialog.Close>
              <Button
                variant={confirmVariant === "destructive" ? "destructive" : "accent"}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          )}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}

interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: "accent" | "destructive";
  onConfirm: () => void;
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "accent",
  onConfirm,
}: AlertDialogProps) {
  return (
    <RxAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RxAlertDialog.Portal>
        <RxAlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RxAlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card border border-field bg-popover p-4 shadow-xl outline-none">
          <RxAlertDialog.Title className="text-sm font-semibold text-primary">{title}</RxAlertDialog.Title>
          {description && (
            <RxAlertDialog.Description className="mt-2 text-sm text-secondary">
              {description}
            </RxAlertDialog.Description>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <RxAlertDialog.Cancel asChild>
              <Button variant="filled">Cancel</Button>
            </RxAlertDialog.Cancel>
            <RxAlertDialog.Action asChild>
              <Button variant={confirmVariant === "destructive" ? "destructive" : "accent"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </RxAlertDialog.Action>
          </div>
        </RxAlertDialog.Content>
      </RxAlertDialog.Portal>
    </RxAlertDialog.Root>
  );
}
