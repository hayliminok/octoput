import * as React from "react";
import { cn } from "./utils";

export interface StatusProps {
  variant?: "default" | "error" | "success" | "warning";
  className?: string;
  children?: React.ReactNode;
}

const VARIANTS: Record<NonNullable<StatusProps["variant"]>, string> = {
  default: "bg-gray-a3 text-gray-a11",
  error: "bg-red-a3 text-red-11",
  success: "bg-green-a3 text-green-11",
  warning: "bg-gray-a3 text-gray-a11",
};

/** Small status pill (e.g. a transient backend/dev-server warning). */
export function Status({ variant = "default", className, children }: StatusProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-footnote font-medium shadow-sm",
        VARIANTS[variant],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </div>
  );
}
