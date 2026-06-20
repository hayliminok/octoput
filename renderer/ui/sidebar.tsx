import * as React from "react";
import { cn } from "./utils";

export function Sidebar({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <nav className={cn("flex h-full flex-col gap-2 bg-gray-2 p-2 pt-3", className)}>{children}</nav>
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
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-callout outline-none transition-colors focus:bg-blue-a3 focus:text-blue-11",
        selected ? "bg-blue-a3 text-blue-11" : "text-gray-a11 hover:bg-gray-a3",
        className,
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  );
}
