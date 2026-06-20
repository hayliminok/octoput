import * as React from "react";
import { cn } from "./utils";

/** A group of related fields, optionally titled. */
export function FieldSet({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <fieldset className={cn("flex flex-col gap-3", className)}>{children}</fieldset>;
}

/** Visual grouping of fields inside a `FieldSet` (card-like). */
export function FieldGroup({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col divide-y divide-border rounded-xl bg-gray-2", className)}>
      {children}
    </div>
  );
}

export interface FieldProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  children?: React.ReactNode;
}

/** A single settings row. */
export function Field({ orientation = "vertical", className, children }: FieldProps) {
  return (
    <div
      className={cn(
        "gap-3 px-4 py-3",
        orientation === "horizontal"
          ? "flex items-center justify-between"
          : "flex flex-col",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FieldContent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>{children}</div>;
}

export function FieldLabel({
  className,
  children,
  htmlFor,
}: {
  className?: string;
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("text-body text-foreground", className)}>
      {children}
    </label>
  );
}
