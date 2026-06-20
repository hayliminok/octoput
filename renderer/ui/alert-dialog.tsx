import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button, type ButtonProps } from "./button";
import { cn } from "./utils";

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger; when given the dialog is uncontrolled. */
  trigger?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  confirmVariant?: ButtonProps["variant"];
  /** Called on confirm. If it throws, the dialog stays open for retry. */
  onConfirm?: () => void | Promise<void>;
  className?: string;
}

/**
 * Glaze-style confirmation AlertDialog. Supports controlled use
 * (`open`/`onOpenChange`) or uncontrolled via a `trigger`.
 */
export function AlertDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "default",
  onConfirm,
  className,
}: AlertDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const confirm = async (e: Event) => {
    if (!onConfirm) return;
    e.preventDefault(); // close manually only on success
    try {
      setBusy(true);
      await onConfirm();
      setOpen(false);
    } catch {
      // keep open for retry
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root open={actualOpen} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      ) : null}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in-0" />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
            className,
          )}
        >
          {title ? (
            <AlertDialogPrimitive.Title className="text-title2">{title}</AlertDialogPrimitive.Title>
          ) : null}
          {description ? (
            <AlertDialogPrimitive.Description className="text-callout text-gray-a11">
              {description}
            </AlertDialogPrimitive.Description>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="filled" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild onClick={(e) => e.preventDefault()}>
              <Button variant={confirmVariant} disabled={busy} onClick={(e) => confirm(e.nativeEvent)}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
