import * as React from "react";
import { cn } from "./utils";

interface PaneSize {
  default: number;
  min: number;
  max: number;
}

export interface SplitViewProps {
  /** Left pane content (app navigation). Alias of `list`. */
  sidebar?: React.ReactNode;
  /** Left pane content (a list column). Alias of `sidebar`. */
  list?: React.ReactNode;
  /** Sizing for the `sidebar` left pane. */
  sidebarSize?: PaneSize;
  /** Sizing for the `list` left pane. */
  listSize?: PaneSize;
  /** Persist the left pane width under this key. */
  storageKey?: string;
  className?: string;
  /** Right pane content. */
  children?: React.ReactNode;
}

const DEFAULT_SIZE: PaneSize = { default: 260, min: 180, max: 480 };

/**
 * Two-pane layout: a fixed-but-resizable left pane (`sidebar` or `list`) and a
 * flexible right pane (`children`), with a draggable divider. The left width is
 * persisted to localStorage under `storageKey`.
 */
export function SplitView({
  sidebar,
  list,
  sidebarSize,
  listSize,
  storageKey,
  className,
  children,
}: SplitViewProps) {
  const left = sidebar ?? list;
  const size = sidebarSize ?? listSize ?? DEFAULT_SIZE;
  const clamp = React.useCallback(
    (w: number) => Math.max(size.min, Math.min(size.max, w)),
    [size.min, size.max],
  );

  const [width, setWidth] = React.useState<number>(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(`octoput.split.${storageKey}`));
      if (Number.isFinite(saved) && saved > 0) return clamp(saved);
    }
    return clamp(size.default);
  });

  const containerRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setWidth(clamp(e.clientX - rect.left));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) {
        setWidth((w) => {
          localStorage.setItem(`octoput.split.${storageKey}`, String(w));
          return w;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clamp, storageKey]);

  return (
    <div ref={containerRef} className={cn("flex h-full w-full overflow-hidden", className)}>
      <div style={{ width }} className="relative h-full shrink-0 overflow-hidden">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        className="group relative z-10 w-px shrink-0 cursor-col-resize bg-border"
      >
        <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-blue-a4" />
      </div>
      <div className="relative h-full min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
