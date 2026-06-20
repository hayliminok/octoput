# Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the put.io desktop app entirely from the arrow keys in a three-pane layout — Left/Right switch panes (sidebar → browser → preview), Up/Down move within a pane, Enter activates, Backspace goes up a folder, and the video player gets media-key control when focused.

**Architecture:** A single `KeyboardNavProvider` (mounted in `RootView`) owns one document `keydown` listener and the active-pane ring state. Panes are identified in the DOM by `data-nav-pane` and their items by `data-nav-item`; the provider does generic Up/Down/Enter/Left/Right by querying the DOM (real `<button>` focus + native `.click()`). Two pane-specific behaviors register imperative overrides through the context: the browser's Backspace-up and the player's media keys. No central focus state machine — the browser's own focus system is the source of truth.

**Tech Stack:** React 18 + TypeScript, TanStack Router (search-param routing), Tailwind (Radix color tokens), Electron renderer. Verification is `npm run type-check` + a dev run for manual UAT (the project has no unit-test runner; do not add one).

**Spec:** `docs/superpowers/specs/2026-06-14-keyboard-navigation-design.md`

**Conventions for every commit in this plan:**
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Work happens on branch `keyboard-navigation` (already created).

---

## File Structure

- **Create** `renderer/main/keyboard-nav.tsx` — `KeyboardNavProvider`, `useKeyboardNav`, `useKeyboardNavOverride`, and the `NavPane` wrapper. Single responsibility: keyboard routing + pane identification.
- **Modify** `renderer/main/root-view.tsx` — mount `KeyboardNavProvider` around the app shell.
- **Modify** `renderer/ui/sidebar.tsx` — mark each `SidebarListItem` button with `data-nav-item` (every sidebar item is a nav target).
- **Modify** `renderer/main/app-sidebar.tsx` — wrap the item list in a `data-nav-pane="sidebar"` container with the active-pane ring.
- **Modify** `renderer/main/library-view.tsx` — wrap the browser + preview panes in `NavPane`; mark file rows with `data-nav-item`; add the initial/drill-in focus effect and the Backspace-up override; add the player media-key override inside `PlayerPane`.

---

## Task 1: KeyboardNavProvider, context, and NavPane

**Files:**
- Create: `renderer/main/keyboard-nav.tsx`
- Modify: `renderer/main/root-view.tsx`

- [ ] **Step 1: Create `renderer/main/keyboard-nav.tsx`**

Create the file with exactly this content:

```tsx
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

// Wraps a pane's content with its identity + the active-pane ring. The box is
// focusable (tabIndex -1) so panes without items (the player) can still receive
// focus and route keys.
export function NavPane({
  id,
  className,
  children,
}: {
  id: PaneId;
  className?: string;
  children: React.ReactNode;
}) {
  const { activePane } = useKeyboardNav();
  return (
    <div
      data-nav-pane={id}
      tabIndex={-1}
      className={cn(
        "h-full outline-none",
        activePane === id && "ring-1 ring-inset ring-blue-a7",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify `cn` is exported from `@ui`**

Run: `grep -n "cn" renderer/ui/index.ts`
Expected: a line that re-exports `cn` (e.g. `export ... cn ...` or `export * from "./utils"`). It is already imported this way in `library-view.tsx`, so this should pass. If `cn` is NOT exported from the index, import it directly instead: change the import line to `import { cn } from "@ui/utils";` — but only if the grep shows no `cn` export.

- [ ] **Step 3: Mount the provider in `RootView`**

In `renderer/main/root-view.tsx`, add the import after the existing imports (line 8 area):

```tsx
import { KeyboardNavProvider } from "./keyboard-nav";
```

Then wrap the outermost returned `<div>` so the whole shell is inside the provider. Change:

```tsx
  return (
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
```

to:

```tsx
  return (
    <KeyboardNavProvider>
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
```

and change the matching closing `</div>` at the end of the return (the last line before the final `);`) to:

```tsx
    </div>
    </KeyboardNavProvider>
  );
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS (exit 0, no errors). The provider is mounted but no pane is wired yet, so behavior is inert.

- [ ] **Step 5: Commit**

```bash
git add renderer/main/keyboard-nav.tsx renderer/main/root-view.tsx
git commit -m "$(printf 'feat: keyboard nav provider + context\n\nSingle keydown router, DOM-based pane/item detection, NavPane wrapper.\nInert until panes are wired.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Sidebar pane wiring

**Files:**
- Modify: `renderer/ui/sidebar.tsx:44-58` (the `SidebarListItem` button)
- Modify: `renderer/main/app-sidebar.tsx`

- [ ] **Step 1: Mark every sidebar item as a nav item**

In `renderer/ui/sidebar.tsx`, add the `data-nav-item` attribute to the `SidebarListItem` button. Change the opening `<button` tag (currently lines 45-54):

```tsx
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
```

to:

```tsx
    <button
      type="button"
      data-nav-item=""
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
```

Rationale: every `SidebarListItem` is a navigation target, and it renders an intrinsic `<button>`, so the literal `data-*` attribute type-checks without changing the props interface. The bottom Settings button is a raw `<button>` (not a `SidebarListItem`), so it stays out of the rotation.

- [ ] **Step 2: Wrap the sidebar list in a nav pane with the active ring**

In `renderer/main/app-sidebar.tsx`:

First, update the imports. Change line 3:

```tsx
import { Sidebar, SidebarList, SidebarListItem } from "@ui";
```

to:

```tsx
import { Sidebar, SidebarList, SidebarListItem, cn } from "@ui";
```

and add after the existing local imports (after line 6):

```tsx
import { useKeyboardNav } from "./keyboard-nav";
```

Then, inside `AppSidebar`, after `const openSettings = ...` (line 35), add:

```tsx
  const { activePane } = useKeyboardNav();
```

Finally, wrap the `<SidebarList>...</SidebarList>` block (lines 50-76) in a `data-nav-pane="sidebar"` div. Change:

```tsx
      <SidebarList>
        <SidebarListItem
          icon={<Plus className="size-4" />}
          title="New transfer"
          selected={pathname === "/transfer"}
          onClick={() => navigate({ to: "/transfer" })}
        />
        <SidebarListItem
          icon={<FolderOpen className="size-4" />}
          title="Your files"
          selected={pathname.startsWith("/library")}
          onClick={() => navigate({ to: "/library", search: { path: [], file: undefined } })}
        />
        <SidebarListItem
          icon={<ArrowDownToLine className="size-4" />}
          title="Transfers"
          selected={pathname.startsWith("/transfers")}
          onClick={() => navigate({ to: "/transfers" })}
          trailing={
            activeCount > 0 ? (
              <span className="rounded-full bg-blue-9 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {activeCount}
              </span>
            ) : undefined
          }
        />
      </SidebarList>
```

to:

```tsx
      <div
        data-nav-pane="sidebar"
        className={cn(
          "rounded-md",
          activePane === "sidebar" && "ring-1 ring-inset ring-blue-a7",
        )}
      >
        <SidebarList>
          <SidebarListItem
            icon={<Plus className="size-4" />}
            title="New transfer"
            selected={pathname === "/transfer"}
            onClick={() => navigate({ to: "/transfer" })}
          />
          <SidebarListItem
            icon={<FolderOpen className="size-4" />}
            title="Your files"
            selected={pathname.startsWith("/library")}
            onClick={() => navigate({ to: "/library", search: { path: [], file: undefined } })}
          />
          <SidebarListItem
            icon={<ArrowDownToLine className="size-4" />}
            title="Transfers"
            selected={pathname.startsWith("/transfers")}
            onClick={() => navigate({ to: "/transfers" })}
            trailing={
              activeCount > 0 ? (
                <span className="rounded-full bg-blue-9 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                  {activeCount}
                </span>
              ) : undefined
            }
          />
        </SidebarList>
      </div>
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Manual UAT (user runs the app)**

Run: `npm run dev`
Verify in the running app:
- Click a sidebar item, then press **Down/Up** — focus ring moves between the three sidebar items, stopping at the ends (no wrap).
- Press **Enter** on an item — it navigates to that route (same as clicking).
- A subtle blue ring appears around the sidebar item list while a sidebar item is focused.

- [ ] **Step 5: Commit**

```bash
git add renderer/ui/sidebar.tsx renderer/main/app-sidebar.tsx
git commit -m "$(printf 'feat: arrow-key navigation in the sidebar\n\nUp/Down rove the sidebar items, Enter activates, active-pane ring.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Browser + preview panes, drill focus, Backspace-up

**Files:**
- Modify: `renderer/main/library-view.tsx` (imports, `FileRows` button, `LibraryView` effects + overrides + `NavPane` wrappers)

- [ ] **Step 1: Import the nav helpers**

In `renderer/main/library-view.tsx`, add after the existing local imports (after line 48, the `useHlsSource` import):

```tsx
import { NavPane, useKeyboardNav, useKeyboardNavOverride } from "./keyboard-nav";
```

- [ ] **Step 2: Mark file rows as nav items**

In the `FileRows` component, add `data-nav-item` to the row button. Change the opening `<button` of the row (currently lines 224-225):

```tsx
              <button
                onClick={() => onOpen(file)}
```

to:

```tsx
              <button
                data-nav-item=""
                onClick={() => onOpen(file)}
```

This covers both folder browsing and search results, since both render `FileRows`.

- [ ] **Step 3: Wrap the browser + preview panes in `NavPane`**

In `LibraryView`, change the `SplitView` block (currently lines 1067-1078):

```tsx
      <SplitView storageKey="library" listSize={{ default: 360, min: 300, max: 460 }} list={browser}>
        {selected ? (
          <PreviewPane key={selected.id} file={selected} />
        ) : (
          <PaneEmptyState
            title="Your put.io library"
            description="Pick a file on the left to preview it here."
          />
        )}
      </SplitView>
```

to:

```tsx
      <SplitView
        storageKey="library"
        listSize={{ default: 360, min: 300, max: 460 }}
        list={<NavPane id="browser">{browser}</NavPane>}
      >
        {selected ? (
          <NavPane id="preview">
            <PreviewPane key={selected.id} file={selected} />
          </NavPane>
        ) : (
          <PaneEmptyState
            title="Your put.io library"
            description="Pick a file on the left to preview it here."
          />
        )}
      </SplitView>
```

Note: `NavPane` wraps the preview only when a file is `selected`, so `availablePanes()` correctly excludes `preview` when nothing is open (Right from the browser then does nothing).

- [ ] **Step 4: Add the Backspace-up override + initial/drill focus effect**

In `LibraryView`, add the focus effect after `const files = ...`, and add the Backspace override after the `openSearch` function. (`LibraryView` itself does not call `useKeyboardNav` — only `NavPane` and the `useKeyboardNavOverride` hook are used here; `useKeyboardNav` is consumed inside `PlayerPane` in Task 4.)

After the `listing` query is defined and `const files = ...` (after line 1010), add:

```tsx
  // Keyboard focus: land on the first row on initial load, and after drilling
  // into a folder (when the user is navigating with the keyboard). Never steals
  // focus from another pane or an input.
  React.useEffect(() => {
    if (listing.isLoading) return;
    const active = document.activeElement;
    const inBrowser = !!active?.closest('[data-nav-pane="browser"]');
    const onBody = !active || active === document.body;
    if (!inBrowser && !onBody) return;
    const id = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-nav-pane="browser"] [data-nav-item]')
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [parent, listing.isLoading]);
```

Then, after the `openSearch` function (after line 1039), add the Backspace-up override:

```tsx
  // Backspace goes up one folder when not typing (Left is reserved for panes).
  useKeyboardNavOverride(
    "browser",
    (e) => {
      if (e.key === "Backspace" && path.length > 0) {
        navigate({ search: { path: path.slice(0, -1), file: undefined } });
        return true;
      }
      return false;
    },
    [path, navigate],
  );
```

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Manual UAT (user runs the app)**

Run: `npm run dev`, go to **Your files**. Verify:
- On entry, the first file row is focused (ring on the browser pane, focus ring on the first row).
- **Down/Up** move between rows; **Left** jumps to the sidebar; **Right** returns to the browser.
- **Enter** on a folder drills in and focus lands on the first row of the new folder.
- **Enter** on a file loads it into the right pane (and only then — scrolling past videos with Up/Down does NOT start a transcode).
- **Backspace** goes up one folder; at the root it does nothing.
- Type in the search box: arrows/Backspace edit text normally; **Esc** drops focus back onto the file list.
- With a file open, **Right** moves into the preview pane (ring appears there); for a non-video preview, **Left** or **Esc** returns to the browser.

- [ ] **Step 7: Commit**

```bash
git add renderer/main/library-view.tsx
git commit -m "$(printf 'feat: arrow-key navigation across browser + preview panes\n\nRoving rows, Left/Right pane switching, Enter to open/drill, drill-in\nfocus, search Esc-to-list, Backspace up a folder.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Player media-key override

**Files:**
- Modify: `renderer/main/library-view.tsx` (inside `PlayerPane`)

- [ ] **Step 1: Add the media-key override in `PlayerPane`**

`PlayerPane` already defines `videoRef`, `seek`, `togglePlay`, `changeVolume`, and `duration`. Add the override hook so that while the preview pane is focused on a video, the arrow keys act as media controls. Insert this immediately after the `goFullscreen` function definition (after line 573, before the `// ── Custom control bar state ──` comment):

```tsx
  // When the preview pane holds focus on a video, arrows act as media controls.
  // Left at the very start (or Esc) hands focus back to the browser list.
  const { requestPane } = useKeyboardNav();
  useKeyboardNavOverride(
    "preview",
    (e) => {
      const v = videoRef.current;
      switch (e.key) {
        case "ArrowRight":
          if (v) seek(Math.min((v.currentTime || 0) + 10, duration || v.duration || 0));
          return true;
        case "ArrowLeft":
          if ((v?.currentTime ?? 0) <= 0.5) {
            requestPane("browser");
            return true;
          }
          if (v) seek(Math.max((v.currentTime || 0) - 10, 0));
          return true;
        case "ArrowUp":
          changeVolume(Math.min((v?.volume ?? 1) + 0.1, 1));
          return true;
        case "ArrowDown":
          changeVolume(Math.max((v?.volume ?? 0) - 0.1, 0));
          return true;
        case " ":
        case "Spacebar":
        case "Enter":
          togglePlay();
          return true;
        case "Escape":
          requestPane("browser");
          return true;
        default:
          return false;
      }
    },
    [duration, requestPane],
  );
```

Note: the override only registers while `PlayerPane` is mounted (i.e. a video is selected). Non-video previews (`AudioPane`, `ImagePane`, `PdfPane`, `TextPane`, `UnsupportedPane`) register nothing, so the provider's generic Left/Esc returns them to the browser.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS. `seek`, `togglePlay`, `changeVolume`, `duration`, and `videoRef` are all already defined in `PlayerPane`'s scope (lines 552-622).

- [ ] **Step 3: Manual UAT (user runs the app)**

Run: `npm run dev`. Open a video in **Your files**, press **Right** to focus the preview pane. Verify:
- **Left/Right** seek ∓10s; **Up/Down** change volume; **Space** and **Enter** toggle play/pause (and Space does not scroll the page).
- **Left** while at the very start (≈0:00), or **Esc** at any time, returns focus to the browser list.
- Mouse playback controls still work unchanged.

- [ ] **Step 4: Commit**

```bash
git add renderer/main/library-view.tsx
git commit -m "$(printf 'feat: player media keys when the preview pane is focused\n\nArrows seek/volume, Space/Enter play-pause, Esc or Left@0 exits to browser.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npm run type-check`
Expected: PASS (both `tsconfig.json` and `main/tsconfig.json`).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: completes with no errors (main + preload esbuild + `vite build`).

- [ ] **Step 3: End-to-end manual UAT (user runs the app)**

Run: `npm run dev`. Walk the full flow once:
sidebar Up/Down/Enter → Right into browser → Down to a folder → Enter (drills in, first row focused) → Backspace (up) → Down to a video → Enter (loads, no transcode while scrolling earlier) → Right into player → seek/volume/play → Esc back to browser → search box, type, Esc back to list → Left to sidebar.

- [ ] **Step 4: Confirm no regressions to mouse interactions**

Verify clicking rows, the refresh button, context-menu (right-click) Move/Delete, and the player's on-screen controls all behave exactly as before.

---

## Notes / deviations from the skill defaults

- **No TDD / unit tests.** The repo has no test runner and its verification norm is `npm run type-check` + build + manual UAT. Adding a test framework for one feature would be an unrequested restructuring, so each task uses type-check + a scripted manual UAT checkpoint instead. The key-routing logic is concentrated in `keyboard-nav.tsx` and kept inspectable.
- **One `@ui` change** (`data-nav-item` on `SidebarListItem`) is the minimum needed to mark sidebar items; it is a backward-compatible literal attribute on an intrinsic button.
