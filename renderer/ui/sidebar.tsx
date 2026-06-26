import * as React from "react";
import { cn } from "./utils";

/**
 * macOS source-list sidebar. Background is transparent so the window's native
 * "sidebar" vibrancy material shows through. The top is padded to clear the
 * inset traffic lights and is a window-drag region.
 */
export function Sidebar({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <nav
      className={cn(
        "drag-region flex h-full flex-col gap-1 bg-transparent px-2.5 pb-2 [padding-top:var(--titlebar)]",
        className,
      )}
    >
      {children}
    </nav>
  );
}

/** Uppercase section label between sidebar groups (Finder/Music style). */
export function SidebarSection({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-a10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarList({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex flex-col gap-0.5", className)}>{children}</div>;
}

export interface SidebarListItemProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  /** Optional element rendered at the trailing edge (e.g. a count badge). */
  trailing?: React.ReactNode;
}

export function SidebarListItem({
  icon,
  title,
  selected,
  onClick,
  className,
  trailing,
}: SidebarListItemProps) {
  return (
    <button
      type="button"
      data-nav-item=""
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-[0.8125rem] outline-none",
        "focus-visible:ring-2 focus-visible:ring-blue-a7",
        selected ? "bg-blue-a4 text-gray-12" : "text-gray-a11 hover:bg-gray-a3",
        className,
      )}
    >
      {icon ? (
        <span className="flex shrink-0 text-blue-11 [&_svg]:size-4">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  );
}
