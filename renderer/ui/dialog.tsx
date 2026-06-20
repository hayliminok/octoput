import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "./button";
import { cn } from "./utils";

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger; when given the dialog is uncontrolled. */
  trigger?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** Called when the confirm button is pressed. If it throws, the dialog stays open. */
  onConfirm?: () => void | Promise<void>;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Glaze-style controlled Dialog: title + description + body + confirm/cancel
 * footer. Use `open`/`onOpenChange` for controlled use, or `trigger` for an
 * uncontrolled trigger-driven dialog.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  onConfirm,
  children,
  className,
}: DialogProps) {
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    if (!onConfirm) {
      onOpenChange?.(false);
      return;
    }
    try {
      setBusy(true);
      await onConfirm();
      onOpenChange?.(false);
    } catch {
      // keep the dialog open so the user can retry
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
            className,
          )}
        >
          {title ? (
            <DialogPrimitive.Title className="text-title2">{title}</DialogPrimitive.Title>
          ) : null}
          {description ? (
            <DialogPrimitive.Description className="text-callout text-gray-a11">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
          <div className="flex justify-end gap-2 pt-1">
            <DialogPrimitive.Close asChild>
              <Button variant="filled" disabled={busy}>
                {cancelLabel}
              </Button>
            </DialogPrimitive.Close>
            <Button variant="accent" onClick={confirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
