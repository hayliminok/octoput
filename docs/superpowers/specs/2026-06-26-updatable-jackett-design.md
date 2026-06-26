# Updatable Jackett — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Problem

Octoput bundles a self-contained Jackett build inside the signed `.app`
(`resources/jackett/darwin-arm64/`, ~372 files), spawned with `--NoUpdates`.
That binary can never be updated in place: the bundle is ad-hoc-signed and
usually lives in a read-only location, so writing to it breaks the code
signature and Gatekeeper marks the app "damaged." Jackett's own auto-updater is
off for the same reason. Users are stuck on whatever Jackett shipped with the
app until they reinstall.

## Goal

Let users update Jackett from **Settings**: auto-detect when a newer Jackett
release exists and offer an **Update Jackett** button, without touching the
signed bundle.

## Non-Goals

- No sidebar/global "update available" nudge — **Settings-only**.
- No platform support beyond the shipped build (**darwin-arm64 only**).
- No re-enabling of Jackett's built-in self-updater.
- No checksum/signature verification of the download (Jackett publishes none
  convenient for macOS; see Trust Model).

## Approach — userData override

Run Jackett from a writable per-user directory when an updated copy exists;
otherwise fall back to the version shipped in the bundle. The bundle is never
modified, so it always remains a safe fallback.

- **Downloaded location:** `<userData>/jackett-bin/darwin-arm64/`
- **Bundled location (fallback):** `resources/jackett/darwin-arm64/`

## Components

### 1. Binary resolution (`main/services/jackett.ts`)

`exePath()` returns the downloaded binary if it exists and is executable, else
the bundled one. A helper `activeSource(): "bundled" | "downloaded"` reports
which is in use (for the Settings label and the revert affordance).

### 2. Version detection

- **Current (running):** `GET http://127.0.0.1:9117/api/v2.0/server/config`
  (admin cookie) → `app_version`. If Jackett isn't running/parseable, current
  version is `unknown` and no update badge is shown.
- **Latest:** `GET https://api.github.com/repos/Jackett/Jackett/releases/latest`
  → `tag_name` (e.g. `v0.22.2228`).
- **Compare:** strip a leading `v`, split on `.`, compare as a numeric tuple.
  `latest > current` ⇒ update available. Unparseable ⇒ treat as no update.

### 3. Update service (`main/services/jackett-update.ts`, new)

- `checkForUpdate(): Promise<{ current: string | null; latest: string | null;
  updateAvailable: boolean; source: "bundled" | "downloaded" }>`
- `update(): Promise<{ version: string }>`
  1. Fetch the latest release; select the asset whose name contains
     `macOSARM64` (robust to exact naming).
  2. Download the `.tar.gz` to a temp file (request timeout; reject if the
     response is not gzip or is implausibly small).
  3. Extract with system `tar -xzf … -C <tmpdir>` (preserves exec bits and
     symlinks).
  4. **Strip quarantine:** `xattr -cr <tmpdir>` — without this macOS blocks the
     unsigned downloaded binary from executing.
  5. Validate the extracted tree contains an executable `jackett`.
  6. Swap into place: extract under `jackett-bin/darwin-arm64.tmp`, then
     `stop()` the sidecar, remove any existing `jackett-bin/darwin-arm64`,
     `rename` the temp dir into place, and `start()` again. (POSIX `rename`
     can't replace a non-empty dir, so the old override is removed first; the
     bundled copy is untouched throughout, so a crash mid-swap still leaves a
     working fallback.)
- `revertToBundled(): Promise<void>` → `stop()`, delete `jackett-bin/`,
  `start()` (now resolves to the bundle).

### 4. IPC (`main/handlers/index.ts`)

New handlers: `jackett:checkUpdate`, `jackett:update`, `jackett:revert`.
Existing `jackett:status` / indexer handlers unchanged.

### 5. Settings UI (`renderer/settings/settings-view.tsx`)

Within the existing **Torrent search** group:

- A row showing `Jackett v0.22.xxxx` and a source tag (`bundled` / `updated`).
- Auto-check on mount via React Query (`staleTime` long,
  `refetchOnWindowFocus: false`) — mirrors octoput's own update notifier.
- If `updateAvailable`: an inline notice **"Update available — vX.Y.Z"** plus an
  **Update Jackett** button. The button steps through
  Checking → Downloading → Restarting → Done; on success it re-queries status.
- If `source === "downloaded"`: a subtle **Revert to bundled** link.
- On any non-arm64 arch (not shipped today): the update affordance is hidden.

## Data Flow

1. Settings mounts → `jackett:checkUpdate` → main ensures Jackett is running,
   reads `app_version`, fetches GitHub latest, compares → returns status.
2. User clicks **Update Jackett** → `jackett:update` → download → extract →
   de-quarantine → atomic swap → restart sidecar → returns new version →
   renderer refreshes status.
3. User clicks **Revert to bundled** → `jackett:revert` → delete override →
   restart → renderer refreshes status.

## Error Handling

- **Check failure** (offline, GitHub rate limit, parse error): fail silent — no
  badge, logged at info. Never blocks Settings.
- **Download/extract/validate failure:** clean up the temp dir, leave the
  current install untouched, surface a toast (`Couldn't update Jackett: …`).
- **Restart failure after swap:** the bundled fallback still exists; surface the
  error and suggest **Revert to bundled**.

## Trust Model

The download comes over HTTPS from the official `Jackett/Jackett` GitHub
releases — the same source and trust level as the binary already bundled in the
app. No separate checksum/signature is verified because Jackett does not publish
a convenient signed manifest for macOS. The downloaded binary is unsigned;
stripping the quarantine xattr is what allows it to run (consistent with the
app's own ad-hoc/unsigned distribution posture).

## Testing

- **Unit (pure functions):** version comparison (`v0.22.2228` vs `v0.22.999`,
  equal, malformed) and release-asset selection (picks `macOSARM64`, ignores
  Linux/Windows/x64 assets, handles missing asset).
- **Manual (integration):** click **Update Jackett** against a real release,
  confirm the new version runs and search still works; click **Revert to
  bundled**, confirm it returns to the shipped version. (Network + native
  `tar`/`xattr` make this path unsuitable for automated tests.)

## Out of the bundle / packaging

No `electron-builder.yml` change: the bundle still ships the baseline Jackett.
The override directory is created at runtime in userData and is never packaged.
