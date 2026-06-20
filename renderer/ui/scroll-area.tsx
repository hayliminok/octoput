import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { cn } from "./utils";

function Scrollbar({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5 transition-colors",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "h-2.5 flex-col",
      )}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-gray-a6" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export interface ScrollAreaProps {
  /** Title rendered in a built-in sticky header (used when no `toolbar` is given). */
  title?: React.ReactNode;
  /** Trailing header actions (rendered alongside `title`). */
  actions?: React.ReactNode;
  /** A full custom header (e.g. a `<Toolbar>`), pinned above the scroll content. */
  toolbar?: React.ReactNode;
  /** Which scrollbars to show. */
  scrollbars?: "vertical" | "horizontal" | "both";
  className?: string;
  children?: React.ReactNode;
}

/**
 * Glaze-style ScrollArea: an optional pinned header (title/actions or a custom
 * toolbar) above a scrollable content region. The root fills its parent and is
 * positioned `relative` so `absolute inset-0` overlays (empty states) center.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ title, actions, toolbar, scrollbars = "vertical", className, children }, ref) => {
    const header =
      toolbar ??
      (title || actions ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {title ? <h1 className="min-w-0 truncate text-title1">{title}</h1> : <span />}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null);

    return (
      <div ref={ref} className={cn("relative flex h-full w-full flex-col", className)}>
        {header ? (
          <div className="drag-region shrink-0 border-b border-border bg-background/80 backdrop-blur">
            {header}
          </div>
        ) : null}
        <ScrollAreaPrimitive.Root className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollAreaPrimitive.Viewport className="h-full w-full [&>div]:!block">
            {children}
          </ScrollAreaPrimitive.Viewport>
          {(scrollbars === "vertical" || scrollbars === "both") && <Scrollbar orientation="vertical" />}
          {(scrollbars === "horizontal" || scrollbars === "both") && (
            <Scrollbar orientation="horizontal" />
          )}
          <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
      </div>
    );
  },
);
ScrollArea.displayName = "ScrollArea";
