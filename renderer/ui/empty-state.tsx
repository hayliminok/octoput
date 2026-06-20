import * as React from "react";
import { cn } from "./utils";

export interface EmptyStateProps {
  /** "center" pins to the nearest positioned ancestor; "inline" flows in place. */
  placement?: "center" | "inline";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Icon + title + description + actions, centered. */
export function EmptyState({
  placement = "center",
  icon,
  title,
  description,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        placement === "center"
          ? "absolute inset-0 flex items-center justify-center p-6"
          : "flex items-center justify-center",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {icon ? <div className="text-gray-a8">{icon}</div> : null}
        {title ? <h2 className="text-bodyEmphasized text-foreground">{title}</h2> : null}
        {description ? <p className="text-callout text-gray-a10">{description}</p> : null}
        {actions ? <div className="mt-1 flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
