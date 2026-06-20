# Keyboard Navigation — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Branch:** `keyboard-navigation`

## Goal

Drive the app entirely from the arrow keys, in a three-pane Miller-column style:

- **Left / Right** move between panes.
- **Up / Down** move between items within the focused pane (sidebar menu items, file/folder rows).
- **Enter** activates the focused item: navigate to a sidebar route, push into a folder, or load a file into the right preview/player pane.

Power-user keyboard control, layered on top of the existing mouse interactions without changing them.

## Pane model

The app is a three-pane layout, but all three panes only coexist on the **Your files** (`/library`) route:

| Pane | Component | Present when |
| --- | --- | --- |
| `sidebar` | `app-sidebar.tsx` | always (every route) |
| `browser` (middle) | `BrowserPane` in `library-view.tsx` | `LibraryView` mounted |
| `preview` (right) | `PreviewPane` / `PlayerPane` in `library-view.tsx` | `LibraryView` mounted **and** a file is selected |

On `/transfer`, `/transfers`, and `/settings` only the sidebar exists; Left/Right are no-ops there and only sidebar Up/Down/Enter apply.

**Scope decision:** arrow nav is built for **library + sidebar only**. Transfers / New transfer panes are not list-driven and are out of scope.

## Architecture — Approach A: roving tabindex on real DOM focus

Chosen over a centralized JS focus-state machine because the pane items are already
native `<button>` elements. Leaning on real browser focus gives us correct focus rings,
screen-reader behavior, and lets `Enter` reuse each row's existing `onClick` — no new
"open" code path. We add a thin coordinator only for cross-pane handoff and the player's
media-key overrides.

### `KeyboardNavProvider` (new: `renderer/main/keyboard-nav.tsx`)

Mounted in `RootView` (wrapping the `SplitView` / `Outlet`). Responsibilities:

- Holds `activePane: "sidebar" | "browser" | "preview"`.
- Lets panes **register** on mount: `register(pane, controller)` where the controller
  exposes `{ focusFirst(), focusLast(), focusRemembered() }`. Sidebar registers always;
  `browser` and `preview` register/unregister with `LibraryView` and the file selection.
- Remembers the last-focused item per pane (so returning to a pane restores position).
- Owns the single document-level `keydown` listener that routes keys (below).
- Exposes `activePane` so each pane container can render a subtle `ring` when active.

Panes consume the context via a `usePaneNavigation(pane, { itemCount, ... })` hook that
implements the roving tabindex within that pane.

### Roving tabindex within a pane

Within sidebar and the browser row list, exactly one item has `tabIndex=0`, the rest
`tabIndex=-1`. Up/Down moves real focus to the prev/next button (no wrap — stops at the
ends). Works identically for the browser pane's folder listing and its search results,
since both render the same `FileRows` buttons.

## Key routing

The provider's `keydown` handler runs this logic:

1. **Text-input guard.** If the event target is the browser's search `<input>`:
   - `Escape` → blur the input and move focus to the first/remembered file row.
   - All other keys → ignored by nav (normal text editing).
2. **Preview pane with a video focused** (`activePane === "preview"` and the player is the
   video player) — media-key overrides take precedence:
   - `ArrowLeft` / `ArrowRight` → seek −10s / +10s.
   - `ArrowUp` / `ArrowDown` → volume + / −.
   - `Space` / `Enter` → play / pause.
   - `Escape` → return focus to `browser`.
   - `ArrowLeft` **when `currentTime` is ~0** → return focus to `browser` (instead of seeking).
   - Non-video previews (image / text / pdf / audio): the pane is just a focus stop;
     `ArrowLeft` returns to `browser`, other arrows do nothing special.
3. **Pane switching** (default):
   - `ArrowRight` → next pane: `sidebar → browser → preview`, clamped; skips `preview`
     when no file is selected. Restores that pane's remembered/first item.
   - `ArrowLeft` → previous pane: the reverse.
4. **Within-pane** (`sidebar` / `browser`):
   - `ArrowUp` / `ArrowDown` → roving-focus move.
   - `Enter` → fire the focused button's existing `onClick`.
   - `Backspace` (browser pane, not typing) → go up one folder
     (`navigate({ search: { path: path.slice(0, -1), file: undefined } })`); no-op at root.

### Enter semantics (reuses existing handlers)

- **Sidebar item** → navigates to its route (existing `onClick`).
- **Folder row** → `open(folder)` pushes into the folder. After the listing changes,
  focus moves to the first row of the new listing.
- **File row** → `open(file)` sets the selection and loads the right pane. Preview/transcode
  happens **only on Enter**, never on mere Up/Down highlight (avoids spawning an ffmpeg
  session for every video scrolled past).

## Visual focus

- The active pane container gets a subtle `ring` (e.g. `ring-1 ring-blue-a6` inset) so the
  user can see which pane is live.
- The focused **item** uses the browser's native focus ring (already styled via the
  buttons' `focus-visible` treatment / Tailwind). This is distinct from the existing
  blue `bg-blue-a3` "selected/previewing" highlight on a file row, so "cursor here" and
  "this file is open in the preview" read as two different states.

## Initial focus

On entering `/library`, the active pane is `browser` with the first row focused (or the
remembered row if returning). The sidebar is reachable with Left. If the browser listing
is empty, focus stays available on the search box.

## Components touched

- **New:** `renderer/main/keyboard-nav.tsx` — provider, context, `usePaneNavigation` hook,
  key routing.
- `renderer/main/root-view.tsx` — wrap children in `KeyboardNavProvider`; active-pane ring
  plumbing on the shell.
- `renderer/main/app-sidebar.tsx` — register the `sidebar` pane; roving tabindex on items.
- `renderer/main/library-view.tsx` — register `browser` + `preview` panes; roving tabindex
  on `FileRows`; Backspace-up; Esc-from-search; expose player media-key hooks from
  `PlayerPane`.

## Out of scope

- Keyboard nav inside Transfers / New transfer / Settings panes (beyond sidebar items).
- A literal `..` row in listings (rejected in favor of Backspace).
- Live preview-on-highlight (rejected — Enter only).
- Customizable / rebindable keys.

## Testing

- Type-check (`npm run type-check`) and a dev build must pass.
- Manual UAT (user runs the app): tab through sidebar → browser → preview with arrows;
  Enter into folders and files; Backspace up; search box guard + Esc; player seek/volume/
  play; Esc / Left-at-0 exits the player to the browser.
