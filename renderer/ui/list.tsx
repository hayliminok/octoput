import * as React from "react";
import { cn } from "./utils";

interface ListContextValue<T> {
  selectedKey: React.Key | undefined;
  getItemKey: (item: T) => React.Key;
  onSelect: (item: T) => void;
}

const ListContext = React.createContext<ListContextValue<unknown> | null>(null);

function useListContext<T>(): ListContextValue<T> {
  const ctx = React.useContext(ListContext) as ListContextValue<T> | null;
  if (!ctx) throw new Error("List.Item must be used within List.Root");
  return ctx;
}

export interface ListRootProps<T> {
  items: T[];
  selectedItem?: T | null;
  onSelectedItemChange?: (item: T | null) => void;
  getItemKey: (item: T) => React.Key;
  autoFocus?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function Root<T>({
  items,
  selectedItem,
  onSelectedItemChange,
  getItemKey,
  autoFocus,
  className,
  children,
}: ListRootProps<T>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const selectedKey =
    selectedItem != null ? getItemKey(selectedItem) : undefined;

  React.useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (items.length === 0) return;
    const idx = items.findIndex((it) => getItemKey(it) === selectedKey);
    const next =
      e.key === "ArrowDown"
        ? Math.min(items.length - 1, idx + 1)
        : Math.max(0, idx <= 0 ? 0 : idx - 1);
    onSelectedItemChange?.(items[next] ?? null);
  };

  const ctx: ListContextValue<T> = {
    selectedKey,
    getItemKey,
    onSelect: (item) => onSelectedItemChange?.(item),
  };

  return (
    <ListContext.Provider value={ctx as ListContextValue<unknown>}>
      <div
        ref={ref}
        role="listbox"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn("flex flex-col gap-px p-2 outline-none", className)}
      >
        {children}
      </div>
    </ListContext.Provider>
  );
}

export interface ListItemProps<T> {
  item: T;
  className?: string;
  children?: React.ReactNode;
}

function Item<T>({ item, className, children }: ListItemProps<T>) {
  const { selectedKey, getItemKey, onSelect } = useListContext<T>();
  const selected = getItemKey(item) === selectedKey;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(item)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-blue-a7",
        selected ? "bg-blue-a4 text-gray-12" : "hover:bg-gray-a3 active:bg-gray-a4",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ItemContent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}>{children}</div>;
}

function ItemTitle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("truncate text-[0.8125rem]", className)}>{children}</div>;
}

function ItemDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("truncate text-footnote text-gray-a10", className)}>{children}</div>
  );
}

function ItemAccessory({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={cn("shrink-0", className)}>{children}</div>;
}

export const List = {
  Root,
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemAccessory,
};
