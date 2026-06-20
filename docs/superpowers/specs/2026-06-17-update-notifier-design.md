# Update Notifier — Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Branch:** `update-notifier`

## Goal

Let the app tell the user when a newer release exists and send them to the
download. Notify-only: no in-app download, no auto-relaunch. This deliberately
avoids the Squirrel.Mac / Developer-ID requirement that true "install &
relaunch" auto-update needs — the app is ad-hoc signed (`mac.identity: null`),
which Squirrel's signature-match check rejects.

## Components

### `main/services/updates.ts`
- Fetches `https://api.github.com/repos/hayliminok/octoput/releases/latest`
  (unauthenticated; the `/latest` endpoint excludes drafts and prereleases).
  Reads `tag_name` (e.g. `v1.0.4`) and `html_url` (the release page).
- Compares the latest tag (leading `v` stripped) against `app.getVersion()` using
  a small numeric semver compare (split on `.`, compare numeric parts) — no new
  dependency.
- Returns `{ updateAvailable: boolean, currentVersion: string, latestVersion: string, releaseUrl: string }`.
- Any failure (offline, API error, GitHub rate limit — 60/hr unauthenticated is
  ample for a launch check) resolves to `updateAvailable: false` with the current
  version; it never throws into the UI.

### IPC (in `main/handlers/index.ts`)
- `updates:check` → returns the object above.
- `updates:open` → `shell.openExternal(releaseUrl)`, opening the GitHub release
  page in the default browser. Validates the URL is an `https://github.com/…`
  link before opening.

### Renderer — `renderer/main/app-sidebar.tsx`
- On mount, calls `updates:check` via a react-query query (consistent with the
  existing sidebar queries).
- When `updateAvailable`, renders a **persistent** clickable notice **directly
  below the username/account row** (the bottom-most element of the sidebar):
  a small download icon + the text **"Octoput v1.0.4 available"** (the actual
  `latestVersion`), in a blue accent. Clicking it calls `updates:open`.
- The notice has no dismiss — it is a standing notice for the session, not a
  toast. It simply isn't rendered when no update is available.

## Behavior

- Check **once on launch** (sidebar mount). No periodic polling.
- The notice text is `Octoput ${latestVersion} available` (tag as returned,
  including its `v` prefix, e.g. `Octoput v1.0.4 available`).
- Clicking opens the release page; the user downloads the DMG and installs it
  manually (the release page already documents the "Open Anyway" first-launch
  step).

## Error handling

- Offline / API error / rate-limited → `updateAvailable: false`; nothing renders.
- `updates:open` is a no-op if the URL is missing or not a github.com https URL.

## Scope (YAGNI)

- **In:** launch-time check, persistent sidebar notice under the username,
  click-to-open-release-page.
- **Out:** in-app download, auto-relaunch / Squirrel, periodic re-checks, a manual
  "Check now" button, and signing/notarization changes.

## Testing

- `npm run type-check` + `npm run build`.
- Locally verifiable: the numeric version-compare logic; `curl` the GitHub
  releases/latest endpoint to confirm the shape (`tag_name`, `html_url`).
- Manual UAT (user): run the app — with the current version equal to the latest
  release, no notice shows; temporarily forcing the compare against a higher
  version makes the **"Octoput vX.Y.Z available"** notice appear under the
  username, and clicking it opens the release page in the browser.

## Files

- Create: `main/services/updates.ts`.
- Modify: `main/handlers/index.ts` (register `updates:check`, `updates:open`).
- Modify: `renderer/main/app-sidebar.tsx` (query on mount + the notice row below
  the account row).
