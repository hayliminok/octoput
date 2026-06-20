# Update Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a persistent "Octoput vX.Y.Z available" notice under the username in the sidebar when a newer GitHub release exists, opening the release page on click. Notify-only — no download, no relaunch.

**Architecture:** A main-process `updatesService.check()` queries GitHub's `releases/latest`, numerically compares the tag to `app.getVersion()`, and returns a status object (silent on any failure). A `updates:check` IPC handler exposes it. The sidebar queries it once on mount and, when an update exists, renders a clickable notice below the account row that opens the release page via the EXISTING `shell:openExternal` IPC.

**Tech Stack:** Electron main (Node, TS, ESM `.js` import specifiers; global `fetch`), React 18 + react-query renderer. Verification: `npm run type-check` + `npm run build`; a throwaway Node script for the version-compare logic; manual UAT for the sidebar notice. (No unit-test runner in this repo — do not add one.)

**Spec:** `docs/superpowers/specs/2026-06-17-update-notifier-design.md`

**Deviation from spec (intentional, DRY):** the spec proposed an `updates:open` IPC. The repo already has a generic `shell:openExternal` handler (`main/platform/native-handlers.ts`), so the renderer opens the release URL through that instead. No new open-handler is added.

**Conventions:** main imports use `.js` specifiers; services export an `xxxService` object; `app` and `logger` come from `../platform/backend.js`; IPC handlers live in `main/handlers/index.ts`; the renderer invokes `window.glazeAPI.glaze.ipc.invoke(channel, params)`. Every commit ends with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Work on branch `update-notifier` (already created).

---

## File Structure

- **Create** `main/services/updates.ts` — `updatesService.check()` + the numeric version comparison. One responsibility: "is there a newer release, and where."
- **Modify** `main/handlers/index.ts` — register `updates:check`.
- **Modify** `renderer/main/app-sidebar.tsx` — query on mount + render the notice below the account row.

---

## Task 1: Update-check service

**Files:** Create `main/services/updates.ts`

- [ ] **Step 1: Create `main/services/updates.ts`**

```ts
/**
 * Notify-only update check: ask GitHub for the latest release and compare it to
 * the running version. Never throws into the UI — any failure (offline, API
 * error, rate limit) resolves to "no update available".
 */
import { app, logger } from "../platform/backend.js";

const RELEASES_LATEST = "https://api.github.com/repos/hayliminok/octoput/releases/latest";

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string; // raw tag, e.g. "v1.0.4" ("" if unknown)
  releaseUrl: string; // GitHub release page ("" if unknown)
}

/** True if `latest` is a higher dotted-numeric version than `current` (ignores a leading "v"). */
export function isNewer(latest: string, current: string): boolean {
  const norm = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = norm(latest);
  const b = norm(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const updatesService = {
  async check(): Promise<UpdateStatus> {
    const currentVersion = app.getVersion();
    try {
      const res = await fetch(RELEASES_LATEST, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "octoput" },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latestVersion = typeof data.tag_name === "string" ? data.tag_name : "";
      const releaseUrl = typeof data.html_url === "string" ? data.html_url : "";
      const updateAvailable = latestVersion !== "" && isNewer(latestVersion, currentVersion);
      return { updateAvailable, currentVersion, latestVersion, releaseUrl };
    } catch (err) {
      logger.info("updates", "check failed (treating as up-to-date)", {
        error: (err as Error).message,
      });
      return { updateAvailable: false, currentVersion, latestVersion: "", releaseUrl: "" };
    }
  },
};
```

Notes: GitHub's API returns 403 without a `User-Agent` header — it's required. `fetch` is a global in Electron's main process (used already in `main/services/putio.ts`). `app.getVersion()` returns the `package.json` version without a `v` prefix (e.g. `1.0.3`); `isNewer` strips the tag's `v`, so `v1.0.4` vs `1.0.3` compares correctly.

- [ ] **Step 2: Verify the version-compare logic with a throwaway Node script**

Create `/tmp/isnewer-check.mjs`:
```js
const norm = (v) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
function isNewer(latest, current) {
  const a = norm(latest), b = norm(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return false;
}
const cases = [
  ["v1.0.4", "1.0.3", true],
  ["v1.0.3", "1.0.3", false],
  ["v1.0.2", "1.0.3", false],
  ["v1.1.0", "1.0.9", true],
  ["v2.0.0", "1.9.9", true],
  ["1.0.10", "1.0.9", true],   // numeric, not lexical
  ["v1.0.3", "1.0.3.1", false],
];
let ok = true;
for (const [l, c, want] of cases) {
  const got = isNewer(l, c);
  if (got !== want) { ok = false; console.error(`FAIL isNewer(${l}, ${c}) = ${got}, want ${want}`); }
  else console.log(`ok isNewer(${l}, ${c}) = ${got}`);
}
process.exit(ok ? 0 : 1);
```
Run: `node /tmp/isnewer-check.mjs && rm /tmp/isnewer-check.mjs`
Expected: all `ok …` lines, exit 0. (This mirrors the `isNewer` logic in the service — especially the numeric `1.0.10 > 1.0.9` case that a string compare would get wrong.)

- [ ] **Step 3: Confirm the GitHub endpoint shape (optional sanity, needs network)**

Run: `curl -sS -H "User-Agent: octoput" https://api.github.com/repos/hayliminok/octoput/releases/latest | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('tag_name=',j.tag_name,'| html_url=',j.html_url)})"`
Expected: prints `tag_name= v1.0.3 | html_url= https://github.com/hayliminok/octoput/releases/tag/v1.0.3` (or whatever the latest is). If offline/rate-limited, skip — the service handles failure gracefully.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add main/services/updates.ts
git commit -m "$(printf 'feat: update-check service (GitHub releases, silent on failure)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: IPC handler

**Files:** Modify `main/handlers/index.ts`

- [ ] **Step 1: Import the service**

In `main/handlers/index.ts`, add alongside the other service imports (near `import { transcodeService } from "../services/transcode.js";`):
```ts
import { updatesService } from "../services/updates.js";
```

- [ ] **Step 2: Register the handler**

Inside `registerHandlers()`, add (e.g. after the transcode handlers):
```ts
  // ── App updates (notify-only) ─────────────────────────────────────────
  ipcMain.handle("updates:check", async () => updatesService.check());
```
(The release page is opened via the existing `shell:openExternal` handler in `main/platform/native-handlers.ts` — no new open handler is needed.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add main/handlers/index.ts
git commit -m "$(printf 'feat: updates:check IPC handler\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Sidebar notice

**Files:** Modify `renderer/main/app-sidebar.tsx`

- [ ] **Step 1: Add the lucide icon + a local type, and query the check**

In `renderer/main/app-sidebar.tsx`:

(a) Add `Download` to the existing `lucide-react` import. The current line is:
```tsx
import { ArrowDownToLine, FolderOpen, Plus, Settings } from "lucide-react";
```
Change it to:
```tsx
import { ArrowDownToLine, Download, FolderOpen, Plus, Settings } from "lucide-react";
```

(b) Add a local type near the existing `PutioAuthStatus` interface (top of the file):
```tsx
interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}
```

(c) Inside `AppSidebar`, after the existing `transfersData` query (and before `const activeCount = …`), add the update query:
```tsx
  // Check for a newer release once per session; render a notice if found.
  const { data: update } = useQuery({
    queryKey: ["updates", "check"],
    queryFn: () => window.glazeAPI.glaze.ipc.invoke<UpdateStatus>("updates:check"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
```

- [ ] **Step 2: Render the notice below the account row**

The account row is the last block before `</Sidebar>`:
```tsx
      <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-callout text-gray-a11">
          {auth?.username ?? (auth?.authenticated ? "Your account" : "put.io")}
        </span>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Settings"
          title="Settings"
          className="shrink-0 rounded-md p-1.5 text-gray-a10 transition-colors hover:bg-gray-a3 hover:text-gray-a12"
        >
          <Settings className="size-4" />
        </button>
      </div>
    </Sidebar>
```
Insert the notice between the account-row `</div>` and `</Sidebar>`:
```tsx
      <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-callout text-gray-a11">
          {auth?.username ?? (auth?.authenticated ? "Your account" : "put.io")}
        </span>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Settings"
          title="Settings"
          className="shrink-0 rounded-md p-1.5 text-gray-a10 transition-colors hover:bg-gray-a3 hover:text-gray-a12"
        >
          <Settings className="size-4" />
        </button>
      </div>

      {update?.updateAvailable && update.releaseUrl ? (
        <button
          type="button"
          onClick={() => window.glazeAPI.glaze.ipc.invoke("shell:openExternal", update.releaseUrl)}
          title="Open the release page"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-footnote text-blue-11 transition-colors hover:bg-blue-a3"
        >
          <Download className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Octoput {update.latestVersion} available</span>
        </button>
      ) : null}
    </Sidebar>
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (exit 0). If `shell:openExternal`'s invoke signature complains about the unused return, it won't — `invoke` is generic and the promise is fire-and-forget here (matches how `openSettings`-style actions ignore returns elsewhere).

- [ ] **Step 4: Manual UAT (user) — force the notice**

Because the live release equals the current version (no update), temporarily force it to confirm the UI. Run `npm run dev`, then in the renderer devtools console:
```js
await window.glazeAPI.glaze.ipc.invoke("updates:check")
```
Expected: an object like `{ updateAvailable:false, currentVersion:"1.0.3", latestVersion:"v1.0.3", releaseUrl:"…" }`.
To see the notice, temporarily lower the app version (e.g. set `"version": "1.0.0"` in `package.json`, restart `npm run dev`): the **"Octoput v1.0.3 available"** notice should appear directly under the username, and clicking it opens the release page in the browser. **Revert `package.json` to `1.0.3` afterward.**

- [ ] **Step 5: Commit**

```bash
git add renderer/main/app-sidebar.tsx
git commit -m "$(printf 'feat: sidebar update notice under the username\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build**

Run: `npm run type-check && npm run build`
Expected: both PASS.

- [ ] **Step 2: Final UAT (user)**

Run `npm run dev` with `package.json` back at the real version (`1.0.3`): confirm **no** notice shows when up to date. (The forced-version check in Task 3 already confirmed the positive case.) Confirm the rest of the sidebar (nav items, account row, Settings) is unchanged.

---

## Notes / deviations from skill defaults

- **No TDD / unit tests** — the repo has no runner; the version-compare logic is verified with a throwaway Node script, and the rest via type-check + build + manual UAT, per project norms.
- **Reuses `shell:openExternal`** instead of adding `updates:open` (the spec's suggestion) — the generic handler already exists.
