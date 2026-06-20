import * as React from "react";
import { cn } from "./utils";

/** Header bar pinned at the top of a pane. Multiple `ToolbarRow`s stack. */
export function Toolbar({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-toolbar="" className={cn("flex flex-col gap-2 px-4 py-3", className)}>
      {children}
    </div>
  );
}

export function ToolbarRow({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex min-h-7 items-center gap-3", className)}>{children}</div>;
}

export function ToolbarContent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}>{children}</div>;
}

export function ToolbarTitle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <h1 className={cn("truncate text-title2", className)}>{children}</h1>;
}

export function ToolbarDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <p className={cn("truncate text-footnote text-gray-a10", className)}>{children}</p>;
}

export function ToolbarActions({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>{children}</div>
  );
}
