import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** No-op: the Electron renderer logs to the console already. */
export function initLogging(): void {
  /* intentionally empty */
}

/** True for any non-production build flavor. */
export function isDevelopmentFlavor(flavor?: string): boolean {
  const f =
    flavor ?? (window as { glazeAPI?: { buildFlavor?: string } }).glazeAPI?.buildFlavor;
  return f !== undefined && f !== "Production";
}
