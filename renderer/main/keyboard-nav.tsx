import * as React from "react";
import { cn } from "@ui";

// Three panes, in left-to-right order. All three exist only on /library;
// other routes have just the sidebar.
export type PaneId = "sidebar" | "browser" | "preview";
const PANE_ORDER: PaneId[] = ["sidebar", "browser", "preview"];

// A pane-specific key handler. Return true to consume the event (the provider
// then calls preventDefault and stops). Return false to let generic handling run.
type OverrideFn = (e: KeyboardEvent) => boolean;

interface NavContextValue {
  /** The pane that currently contains focus (drives the active-pane ring). */
  activePane: PaneId | null;
  /** Move focus into a pane (its remembered item, or the first / the pane box). */
  requestPane: (pane: PaneId) => void;
  /** Register a pane-specific key override; returns an unregister fn. */
  registerOverride: (pane: PaneId, fn: OverrideFn) => () => void;
}

const NavContext = React.createContext<NavContextValue | null>(null);

export function useKeyboardNav(): NavContextValue {
  const ctx = React.useContext(NavContext);
  if (!ctx) throw new Error("useKeyboardNav must be used within a KeyboardNavProvider");
  return ctx;
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable === true
  );
}

function paneElement(pane: PaneId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-nav-pane="${pane}"]`);
}

// Panes that are mounted right now, in canonical left-to-right order.
function availablePanes(): PaneId[] {
  return PANE_ORDER.filter((p) => paneElement(p) !== null);
}

function paneOf(el: Element | null): PaneId | null {
  const host = el?.closest<HTMLElement>("[data-nav-pane]");
  return (host?.dataset.navPane as PaneId | undefined) ?? null;
}

function itemsIn(pane: PaneId): HTMLElement[] {
  const host = paneElement(pane);
  if (!host) return [];
  return Array.from(host.querySelectorAll<HTMLElement>("[data-nav-item]"));
}

export function KeyboardNavProvider({ children }: { children: React.ReactNode }) {
  const [activePane, setActivePane] = React.useState<PaneId | null>(null);
  const overridesRef = React.useRef(new Map<PaneId, OverrideFn>());
  // Last focused item index per pane, so returning to a pane restores position.
  const rememberedRef = React.useRef(new Map<PaneId, number>());

  const focusItem = React.useCallback((pane: PaneId, index: number) => {
    const items = itemsIn(pane);
    if (items.length === 0) {
      // No items (e.g. the preview/player): focus the pane container itself so
      // subsequent keys route to this pane.
      paneElement(pane)?.focus();
      return;
    }
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    items[clamped]?.focus();
    rememberedRef.current.set(pane, clamped);
  }, []);

  const requestPane = React.useCallback(
    (pane: PaneId) => {
      if (!paneElement(pane)) return;
      focusItem(pane, rememberedRef.current.get(pane) ?? 0);
      setActivePane(pane);
    },
    [focusItem],
  );

  const registerOverride = React.useCallback((pane: PaneId, fn: OverrideFn) => {
    overridesRef.current.set(pane, fn);
    return () => {
      if (overridesRef.current.get(pane) === fn) overridesRef.current.delete(pane);
    };
  }, []);

  // Keep the active-pane ring + remembered index in sync with real focus
  // (covers mouse clicks and programmatic focus alike).
  React.useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      const pane = paneOf(target);
      if (!pane) return;
      setActivePane(pane);
      const idx = itemsIn(pane).indexOf(target as HTMLElement);
      if (idx >= 0) rememberedRef.current.set(pane, idx);
    };
    window.addEventListener("focusin", onFocusIn);
    return () => window.removeEventListener("focusin", onFocusIn);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;

      // Text-input guard: typing flows normally; Escape drops back to the list.
      if (isEditable(active)) {
        if (e.key === "Escape") {
          const pane = paneOf(active) ?? "browser";
          (active as HTMLElement).blur();
          focusItem(pane, rememberedRef.current.get(pane) ?? 0);
          e.preventDefault();
        }
        return;
      }

      const pane = paneOf(active) ?? activePane;
      if (!pane) return;

      // Pane-specific override gets first crack (player media keys, Backspace-up).
      const override = overridesRef.current.get(pane);
      if (override && override(e)) {
        e.preventDefault();
        return;
      }

      const items = itemsIn(pane);
      const currentIndex = items.indexOf(active as HTMLElement);

      switch (e.key) {
        case "ArrowDown":
          if (items.length) {
            focusItem(pane, currentIndex < 0 ? 0 : currentIndex + 1);
            e.preventDefault();
          }
          break;
        case "ArrowUp":
          if (items.length) {
            focusItem(pane, currentIndex < 0 ? 0 : currentIndex - 1);
            e.preventDefault();
          }
          break;
        case "Enter":
          if (currentIndex >= 0) {
            (active as HTMLElement).click();
            e.preventDefault();
          }
          break;
        case "ArrowRight": {
          const panes = availablePanes();
          const next = panes[panes.indexOf(pane) + 1];
          if (next) {
            requestPane(next);
            e.preventDefault();
          }
          break;
        }
        case "ArrowLeft": {
          const panes = availablePanes();
          const prev = panes[panes.indexOf(pane) - 1];
          if (prev) {
            requestPane(prev);
            e.preventDefault();
          }
          break;
        }
        case "Escape":
          // From a non-video preview, Escape returns to the browser list.
          if (pane === "preview") {
            requestPane("browser");
            e.preventDefault();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, focusItem, requestPane]);

  const value = React.useMemo<NavContextValue>(
    () => ({ activePane, requestPane, registerOverride }),
    [activePane, requestPane, registerOverride],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// Register a pane-specific key override. `fn` should return true for keys it
// consumes. `deps` controls when the captured closure refreshes.
export function useKeyboardNavOverride(
  pane: PaneId,
  fn: OverrideFn,
  deps: React.DependencyList,
) {
  const { registerOverride } = useKeyboardNav();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = React.useCallback(fn, deps);
  React.useEffect(() => registerOverride(pane, stable), [pane, registerOverride, stable]);
}

// Wraps a pane's content with its identity. The box is focusable (tabIndex -1)
// so panes without items (the player) can still receive focus and route keys.
// No visual indicator here — focus is shown by the focused item's background.
export function NavPane({
  id,
  className,
  children,
}: {
  id: PaneId;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-nav-pane={id} tabIndex={-1} className={cn("h-full outline-none", className)}>
      {children}
    </div>
  );
}
