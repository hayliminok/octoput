import type * as React from "react";
import { EmptyState } from "@ui";

/**
 * EmptyState centered within its own pane.
 *
 * EmptyState's default `placement="center"` is absolutely positioned against the
 * nearest positioned ancestor (often the whole window), so it drifts off-center
 * inside a panel. Wrapping it in a full-size flex box centers it within the pane
 * regardless of the surrounding positioning context.
 */
export function PaneEmptyState(props: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <EmptyState placement="inline" {...props} />
    </div>
  );
}

/**
 * EmptyState centered inside a `ScrollArea`'s content.
 *
 * ScrollArea wraps content in an auto-height div, so `h-full` collapses. Its root
 * is `position: relative` and fills the pane, so we center against it with
 * `absolute inset-0` instead.
 */
export function ScrollEmptyState(props: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <EmptyState placement="inline" {...props} />
    </div>
  );
}
