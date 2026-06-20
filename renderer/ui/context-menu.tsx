import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { Folder, Trash2 } from "lucide-react";
import { cn } from "./utils";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

const ICONS: Record<string, React.ReactNode> = {
  folder: <Folder className="size-4" />,
  trash: <Trash2 className="size-4" />,
};

export interface ContextMenuItemProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>, "color"> {
  /** Named leading icon (e.g. "folder", "trash"). */
  icon?: string;
  /** Semantic color; "red" renders a destructive item. */
  color?: "red";
}

export const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(({ className, icon, color, children, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-callout outline-none",
      "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      color === "red" && "text-red-11 focus:bg-red-a3 focus:text-red-11",
      className,
    )}
    {...props}
  >
    {icon && ICONS[icon] ? <span className="shrink-0">{ICONS[icon]}</span> : null}
    {children}
  </ContextMenuPrimitive.Item>
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
