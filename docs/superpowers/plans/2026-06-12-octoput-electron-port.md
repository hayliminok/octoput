# Octoput → Standalone Electron App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-host the Glaze-built `octoput` put.io streaming client as a self-contained, distributable Electron app (`.dmg`/`.app`) that needs no Glaze install and no separately-installed CLIs.

**Architecture:** Glaze's runtime API surface is deliberately Electron-shaped (`app`, `BrowserWindow`, `Menu`, `ipcMain`, `ipcRenderer`, `contextBridge`, `protocol`). We exploit that by introducing two **compatibility shim modules** (`main/platform/backend.ts`, `renderer/platform/preload.ts`) that re-export Electron APIs under the exact names the existing code imports, so backend/preload source changes are mostly a one-line import swap. The Glaze UI-component kit (no public package) is reimplemented as a local shadcn/Radix-based library. The `putio` and `chilly` CLIs are compiled to standalone binaries and bundled via `extraResources`. The build pipeline (Glaze CLI) is replaced with Vite (renderer) + esbuild (main/preload) + electron-builder (packaging).

**Tech Stack:** Electron 33, electron-builder, Vite 8, esbuild, React 19, TanStack Router/Query, Radix UI, Tailwind 4, hls.js, TypeScript 5.

---

## Scope note

This is a large migration spanning several independent subsystems. It is sequenced as phases that each leave the app in a runnable/verifiable state. **Phase 4 (UI kit) is itself large enough to warrant its own detailed sub-plan** — it is fully specified here as an inventory + procedure + representative components, but the executor should expect to read each call site for exact props as they build each component. Phases 1–3 and 5–7 contain complete code.

## Prerequisites & decisions (confirm before starting)

- [ ] **Decision — CLI binaries:** This plan assumes you will produce standalone single-file binaries of `putio-cli` (TypeScript → compile with `bun build --compile` or Node SEA) and `chilly` (Go → `go build`) for each target arch. Phase 6 includes a fallback (`ELECTRON_RUN_AS_NODE`) if a standalone `putio` binary can't be produced. Place binaries in `resources/bin/<platform>-<arch>/`.
- [ ] **Decision — platforms:** Plan targets **macOS (arm64 + x64)** first. Windows/Linux notes are flagged inline; the HLS player (Phase 5) uses hls.js so it is cross-platform regardless.
- [ ] **Decision — signing:** For sharing with friends, ad-hoc signing is assumed (`electron-builder` default identity `null` / `-` ). Notarization is out of scope for v1 and noted in Phase 7.

## File Structure

**New files:**
- `electron.vite.config.ts` *(removed — we use separate tools; see below)*
- `vite.config.ts` — renderer build (multi-page: main + settings windows)
- `scripts/build-main.mjs` — esbuild bundle for main process
- `scripts/build-preload.mjs` — esbuild bundle for preload (CJS/IIFE)
- `scripts/dev.mjs` — dev orchestrator (vite dev server + electron + watch)
- `main/platform/backend.ts` — compat shim re-exporting Electron APIs as `@glaze/core/backend`'s surface
- `main/platform/native-handlers.ts` — `ipcMain.handle` for the native bridge calls the renderer makes (`shell:openExternal`, `nativeTheme:*`)
- `renderer/platform/preload-runtime.ts` — compat shim re-exporting Electron `ipcRenderer`/`contextBridge`/`webUtils`
- `renderer/platform/ipc-types.ts` — local copies of the `@glaze/core/ipc` types used
- `renderer/ui/*` — the reimplemented component kit (one file per component, see Phase 4)
- `renderer/ui/hooks/*` — `useTheme`, `useConnection`, `useEnvironment`
- `renderer/ui/utils.ts` — `cn`, `initLogging`, `isDevelopmentFlavor`, `isDevelopmentFlavor`
- `electron-builder.yml` — packaging config
- `resources/bin/<platform>-<arch>/{putio,chilly}` — bundled CLI binaries

**Modified files:**
- `package.json` — scripts, deps, `main` entry, build config
- `tsconfig.json`, `main/tsconfig.json` — drop Glaze paths, add `@platform`/`@ui` aliases
- `main/index.ts` — import from `./platform/backend.js`; register native handlers
- `main/handlers/index.ts`, `main/services/*.ts`, `main/windows/*.ts` — swap `@glaze/core/backend` import
- `main/services/transcode.ts` — rewrite `protocol.handle` to Electron `Response` API
- `main/windows/window-paths.ts` — new build layout + `app.isPackaged` dev-server logic
- `renderer/preload.ts` — import from `./platform/preload-runtime`; local types
- `renderer/**/*.tsx` — swap `@glaze/core/{components,hooks,utils}` imports to `@ui/*`
- `main-window.html`, `settings-window.html` — move into `renderer/` for Vite multi-page

**Removed:**
- `glaze.ts` (after Phase 1 proves the new pipeline)

---

## Phase 1 — Build pipeline + Electron shell (app launches a blank window)

**Outcome:** `npm run dev` opens an Electron window loading the existing renderer HTML; `npm run build` produces `build/`. No Glaze.

### Task 1.1: Add Electron toolchain deps

**Files:** Modify `package.json`

- [ ] **Step 1: Install deps**

```bash
cd ~/code/octoput
npm pkg delete glaze
npm i -D electron@^33 electron-builder@^25 concurrently@^9 wait-on@^8
npm i hls.js@^1.5
```

- [ ] **Step 2: Set Electron entry + scripts in package.json**

Replace the `"scripts"` block and add `"main"`:

```json
{
  "main": "build/main/index.js",
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build": "node scripts/build-main.mjs && node scripts/build-preload.mjs && vite build",
    "build:main": "node scripts/build-main.mjs",
    "build:preload": "node scripts/build-preload.mjs",
    "build:renderer": "vite build",
    "start": "electron .",
    "package": "npm run build && electron-builder",
    "type-check": "tsc -p tsconfig.json --noEmit && tsc -p main/tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json && git commit -m "build: add electron toolchain, drop glaze scripts"
```

### Task 1.2: Move HTML entrypoints into renderer/ for Vite multi-page

**Files:** Move `main-window.html` → `renderer/main-window.html`; `settings-window.html` → `renderer/settings-window.html`

- [ ] **Step 1: Move files and fix script src**

```bash
git mv main-window.html renderer/main-window.html
git mv settings-window.html renderer/settings-window.html
```

In `renderer/main-window.html` change the script src from `./renderer/main/index.tsx` to `./main/index.tsx`. In `renderer/settings-window.html` change `./renderer/settings/index.tsx` to `./settings/index.tsx`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "build: relocate window HTML into renderer/ for vite multi-page"
```

### Task 1.3: Vite config (renderer, multi-page)

**Files:** Create `vite.config.ts`

- [ ] **Step 1: Write config**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "renderer",
  base: "./", // file:// loading in packaged app needs relative asset URLs
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@ui": resolve(__dirname, "renderer/ui"),
      "@platform": resolve(__dirname, "renderer/platform"),
    },
  },
  build: {
    outDir: resolve(__dirname, "build/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "main-window": resolve(__dirname, "renderer/main-window.html"),
        "settings-window": resolve(__dirname, "renderer/settings-window.html"),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
```

- [ ] **Step 2: Verify renderer builds (will fail on @glaze imports — expected)**

Run: `npx vite build`
Expected: FAIL with unresolved `@glaze/core/components` etc. This confirms Vite is wired; those imports are removed in Phase 4. Proceed.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts && git commit -m "build: add vite renderer config (multi-page)"
```

### Task 1.4: esbuild scripts for main + preload

**Files:** Create `scripts/build-main.mjs`, `scripts/build-preload.mjs`

- [ ] **Step 1: Write `scripts/build-main.mjs`**

```js
import { build } from "esbuild";

await build({
  entryPoints: ["main/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "build/main/index.js",
  // Electron + ffmpeg installers resolve real files at runtime; keep them external.
  external: ["electron", "@ffmpeg-installer/*", "@ffprobe-installer/*"],
  banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
  sourcemap: true,
});
console.log("built build/main/index.js");
```

- [ ] **Step 2: Write `scripts/build-preload.mjs`**

Preload must be CommonJS (Electron preloads are CJS by default).

```js
import { build } from "esbuild";

await build({
  entryPoints: ["renderer/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "build/preload.js",
  external: ["electron"],
  sourcemap: true,
});
console.log("built build/preload.js");
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ && git commit -m "build: esbuild bundlers for main and preload"
```

### Task 1.5: Rewrite window-paths.ts for the Electron build layout

**Files:** Modify `main/windows/window-paths.ts`

- [ ] **Step 1: Replace file contents**

```ts
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { app } from "electron";

const currentDirPath = path.dirname(fileURLToPath(import.meta.url));
// build/main/window-paths.js → build/
const BUILD_ROOT = path.resolve(currentDirPath, "..");

const DEV_SERVER = "http://localhost:5173";

export function getBuildRoot(): string {
  return BUILD_ROOT;
}

/** Absolute path to the built preload (build/preload.js). */
export function getPreloadPath(): string {
  return path.join(BUILD_ROOT, "preload.js");
}

/**
 * Resolve a window URL. In dev (not packaged) load the Vite dev server;
 * in production load the built HTML from build/renderer/.
 * `htmlFileName` is e.g. "main-window.html".
 */
export async function getWindowUrl(htmlFileName: string): Promise<string> {
  if (!app.isPackaged && process.env.OCTOPUT_DEV_SERVER === "1") {
    return `${DEV_SERVER}/${htmlFileName}`;
  }
  return pathToFileURL(path.join(BUILD_ROOT, "renderer", htmlFileName)).toString();
}
```

- [ ] **Step 2: Commit**

```bash
git add main/windows/window-paths.ts && git commit -m "build: window-paths for electron build layout + dev server"
```

### Task 1.6: Dev orchestrator

**Files:** Create `scripts/dev.mjs`

- [ ] **Step 1: Write it**

```js
import { spawn } from "node:child_process";
import { build } from "esbuild";

// One-shot build of main+preload, then run vite dev + electron together.
await Promise.all([
  build({ entryPoints: ["main/index.ts"], bundle: true, platform: "node",
    format: "esm", target: "node20", outfile: "build/main/index.js",
    external: ["electron", "@ffmpeg-installer/*", "@ffprobe-installer/*"],
    banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" } }),
  build({ entryPoints: ["renderer/preload.ts"], bundle: true, platform: "node",
    format: "cjs", target: "node20", outfile: "build/preload.js", external: ["electron"] }),
]);

const vite = spawn("npx", ["vite", "--port", "5173", "--strictPort"], { stdio: "inherit", shell: true });
const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit", shell: true,
  env: { ...process.env, OCTOPUT_DEV_SERVER: "1" },
});
const die = () => { vite.kill(); electron.kill(); process.exit(); };
electron.on("exit", die);
process.on("SIGINT", die);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/dev.mjs && git commit -m "build: dev orchestrator (vite + electron)"
```

> **Phase 1 verification is deferred** until Phase 2/3 supply a working `main/platform/backend.ts` and Phase 4 unblocks the renderer. At end of Phase 4, `npm run dev` must open the real UI.

---

## Phase 2 — Backend compat shim + protocol rewrite (Electron main runs)

### Task 2.1: Backend compat shim

**Files:** Create `main/platform/backend.ts`

This module exports every symbol the backend imports from `@glaze/core/backend`: `app, BrowserWindow, Menu, ipcMain, protocol, logger, initDevToolsButtonState`.

- [ ] **Step 1: Write the shim**

```ts
import {
  app,
  BrowserWindow as ElectronBrowserWindow,
  Menu,
  ipcMain as electronIpcMain,
  protocol,
} from "electron";
import type { BrowserWindowConstructorOptions } from "electron";

export { app, Menu, protocol };

/** Glaze passes `windowKey` (frame persistence) which Electron doesn't know. Strip it. */
type GlazeWindowOptions = BrowserWindowConstructorOptions & { windowKey?: string };

export class BrowserWindow extends ElectronBrowserWindow {
  constructor(opts: GlazeWindowOptions = {}) {
    const { windowKey: _ignored, webPreferences, ...rest } = opts;
    super({
      ...rest,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // preload uses Node-built CJS bundle; keep sandbox off
        ...webPreferences,
      },
    });
  }
}

/** Glaze logger signature: logger.info(scope, message, meta?) / logger.error(scope, message, err?) */
export const logger = {
  info: (scope: string, msg: string, meta?: unknown) =>
    console.log(`[${scope}] ${msg}`, meta ?? ""),
  debug: (scope: string, msg: string, meta?: unknown) =>
    console.debug(`[${scope}] ${msg}`, meta ?? ""),
  warn: (scope: string, msg: string, meta?: unknown) =>
    console.warn(`[${scope}] ${msg}`, meta ?? ""),
  error: (scope: string, msg: string, err?: unknown) =>
    console.error(`[${scope}] ${msg}`, err ?? ""),
};

/** Glaze's ipcMain has a `.broadcast` Electron lacks: send to every window's renderer. */
export const ipcMain = Object.assign(electronIpcMain, {
  broadcast(channel: string, payload: unknown): void {
    for (const win of ElectronBrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  },
});

/** Glaze dev-tools toggle bootstrap — no-op under Electron. */
export async function initDevToolsButtonState(): Promise<void> {
  /* no-op */
}
```

- [ ] **Step 2: Commit**

```bash
git add main/platform/backend.ts && git commit -m "feat: electron backend compat shim"
```

### Task 2.2: Swap backend imports across main/

**Files:** Modify `main/index.ts`, `main/handlers/index.ts`, `main/windows/settings-window.ts`, `main/services/{auth,chilly,putio,vlc}.ts` (transcode handled separately in 2.3)

- [ ] **Step 1: Replace the import specifier in each file**

In every listed file, change:
```ts
} from "@glaze/core/backend";
```
to (relative path depends on file depth):
- `main/index.ts`, `main/handlers/index.ts` → `from "../platform/backend.js"` / `from "./platform/backend.js"` respectively. (`main/index.ts` uses `./platform/backend.js`; `main/handlers/index.ts` uses `../platform/backend.js`.)
- `main/windows/settings-window.ts` → `from "../platform/backend.js"`
- `main/services/*.ts` → `from "../platform/backend.js"`

Run a guarded check after editing:

Run: `grep -rn "@glaze/core/backend" main/`
Expected: only `main/services/transcode.ts` remains (fixed in 2.3).

- [ ] **Step 2: Commit**

```bash
git add main/ && git commit -m "refactor: point main backend imports at electron shim"
```

### Task 2.3: Rewrite the glaze-hls protocol handler for Electron's Response API

**Files:** Modify `main/services/transcode.ts`

Electron's `protocol.handle(scheme, handler)` requires the handler to return a web `Response`. The current handler returns `{ statusCode, headers, body }` / `{ path, statusCode, headers }` objects (Glaze API). Rewrite `registerHlsProtocol`.

- [ ] **Step 1: Change the import**

```ts
import { protocol, logger } from "../platform/backend.js";
import { net } from "electron";
```

- [ ] **Step 2: Replace the body of `protocol.handle(HLS_SCHEME, ...)`**

```ts
  protocol.handle(HLS_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // glaze-hls://hls/<sessionId>/<file>
      const segments = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
      const session = sessions.get(segments[0]);
      const fileName = segments[1] ?? "";
      if (!session) {
        return new Response("No session", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (fileName === "index.m3u8") {
        // Serve the playlist file from disk.
        const res = await net.fetch(pathToFileURL(path.join(session.dir, "index.m3u8")).toString());
        return new Response(res.body, {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
        });
      }
      const match = fileName.match(/^seg(\d+)\.ts$/);
      if (match) {
        const segPath = await ensureSegment(session, Number(match[1]));
        const res = await net.fetch(pathToFileURL(segPath).toString());
        return new Response(res.body, { status: 200, headers: { "Content-Type": "video/mp2t" } });
      }
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    } catch (err) {
      logger.error("transcode", "protocol handler error", err as Error);
      return new Response("Error", { status: 500, headers: { "Content-Type": "text/plain" } });
    }
  });
```

- [ ] **Step 3: Ensure `pathToFileURL` is imported**

At the top of the file, add `pathToFileURL` to the existing `node:url` import:
```ts
import { fileURLToPath, pathToFileURL } from "url";
```

- [ ] **Step 4: Verify main bundles**

Run: `npm run build:main`
Expected: `built build/main/index.js`, no errors.

- [ ] **Step 5: Commit**

```bash
git add main/services/transcode.ts && git commit -m "fix: port glaze-hls protocol handler to electron Response api"
```

### Task 2.4: Native bridge handlers (shell + nativeTheme)

**Files:** Create `main/platform/native-handlers.ts`; modify `main/index.ts`

The renderer calls `shell.openExternal` and `nativeTheme.*` (via preload → `ipcRenderer.invoke`). Glaze's host implemented these; Electron needs explicit handlers.

- [ ] **Step 1: Write `main/platform/native-handlers.ts`**

```ts
import { shell, nativeTheme } from "electron";
import { ipcMain } from "./backend.js";

export function registerNativeHandlers(): void {
  ipcMain.handle("shell:openExternal", async (_e, url: string) => {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("nativeTheme:getInfo", async () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
  }));
  ipcMain.handle("nativeTheme:setThemeSource", async (_e, source: "system" | "light" | "dark") => {
    nativeTheme.themeSource = source;
    return true;
  });
  ipcMain.handle("nativeTheme:getShouldUseDarkColors", async () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle("nativeTheme:getThemeSource", async () => nativeTheme.themeSource);

  // Re-broadcast OS theme changes so useTheme() can react.
  nativeTheme.on("updated", () => {
    ipcMain.broadcast("nativeTheme:updated", {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      themeSource: nativeTheme.themeSource,
    });
  });
}
```

- [ ] **Step 2: Call it from `main/index.ts`**

After `registerHandlers();` (line ~24), add:
```ts
import { registerNativeHandlers } from "./platform/native-handlers.js";
// ...
registerNativeHandlers();
```

- [ ] **Step 3: Commit**

```bash
git add main/platform/native-handlers.ts main/index.ts && git commit -m "feat: native bridge handlers for shell + nativeTheme"
```

---

## Phase 3 — Preload compat shim

### Task 3.1: Preload runtime shim + local IPC types

**Files:** Create `renderer/platform/preload-runtime.ts`, `renderer/platform/ipc-types.ts`; modify `renderer/preload.ts`

- [ ] **Step 1: Write `renderer/platform/preload-runtime.ts`**

```ts
import { contextBridge, ipcRenderer as electronIpc, webUtils } from "electron";

export { contextBridge };

/** Mirror the subset of Glaze's ipcRenderer the preload uses. */
export const ipcRenderer = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    electronIpc.invoke(channel, ...args) as Promise<T>,
  onNotification: (channel: string, callback: (params: unknown) => void): (() => void) => {
    const listener = (_e: unknown, params: unknown) => callback(params);
    electronIpc.on(channel, listener);
    return () => electronIpc.off(channel, listener);
  },
  isConnected: (): boolean => true,
  waitForReady: (): Promise<void> => Promise.resolve(),
  disconnect: (): void => {
    /* no persistent socket under electron */
  },
};

/** Glaze's webUtils API; Electron exposes getPathForFile. */
export function createWebUtilsAPI() {
  return {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  };
}
```

- [ ] **Step 2: Write `renderer/platform/ipc-types.ts`**

Copy the type aliases the preload imports from `@glaze/core/ipc`. These are structural types; define them locally:

```ts
export type MediaAccessType = "microphone" | "camera" | "screen";
export type AskForMediaAccessType = "microphone" | "camera";
export type PermissionStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";
export type SystemPreferencesAuthorizationType = string;

export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "light" | "dark";
}
export interface OpenDialogOptions { [k: string]: unknown }
export interface OpenDialogResult { canceled: boolean; filePaths: string[] }
export interface SaveDialogOptions { [k: string]: unknown }
export interface SaveDialogResult { canceled: boolean; filePath?: string }
export interface MessageBoxOptions { [k: string]: unknown }
export interface MessageBoxResult { response: number; checkboxChecked: boolean }
export interface DatePickerOptions { [k: string]: unknown }
export interface DatePickerResult { canceled: boolean; date?: string }
export interface LocationPosition { latitude: number; longitude: number }
export interface LocationPositionOptions { [k: string]: unknown }
export interface PermissionDiagnostic { name: string; status: PermissionStatus }
export interface MenuItemConstructorOptions { [k: string]: unknown }
export interface PopupOptions { [k: string]: unknown }
export interface PopupResult { [k: string]: unknown }
```

- [ ] **Step 3: Repoint `renderer/preload.ts` imports**

Change line 41 from `from "@glaze/core/preload"` to `from "./platform/preload-runtime"`, and line 64's type import from `@glaze/core/ipc` to `./platform/ipc-types`. The body (the `glazeAPI` object + `contextBridge.exposeInMainWorld`) is unchanged.

> Note: the preload exposes dialog/systemPreferences/location/Menu/permissions APIs whose main-side handlers aren't implemented (renderer never calls them today). Leave them exposed; they only fail if invoked. Implementing them is out of scope.

- [ ] **Step 4: Verify preload bundles**

Run: `npm run build:preload`
Expected: `built build/preload.js`, no errors.

- [ ] **Step 5: Commit**

```bash
git add renderer/platform/ renderer/preload.ts && git commit -m "feat: electron preload compat shim + local ipc types"
```

---

## Phase 4 — Reimplement the Glaze UI kit (renderer renders)

> **This phase is the bulk of the effort and is a candidate for its own sub-plan.** It has no failing-test loop (it's visual UI); verification is "the view renders and behaves." Build components in dependency order; after each, run `npx vite build` to confirm no unresolved imports remain for finished files.

**Strategy:** Create `renderer/ui/index.ts` as a barrel exporting every symbol. Point all renderer view files at `@ui` instead of `@glaze/core/*`. Most components are standard shadcn/Radix; a handful are Glaze-custom and must be built from scratch to match how the views use them. **For each component, read its call sites (listed below) to capture the exact props before implementing — do not guess the prop surface.**

### Component inventory & source mapping

| Glaze export | Source | Call sites to read for props |
|---|---|---|
| `Button` | shadcn Button (cva variants) | connect-view, home-view, library-view, settings-view |
| `Input` | shadcn Input | home-view, library-view |
| `Label` | Radix Label | settings-view |
| `RadioGroup`, `RadioGroupItem` | Radix RadioGroup | settings-view |
| `ScrollArea` | Radix ScrollArea | home-view, library-view, settings-view |
| `Slider` | Radix Slider | library-view (player volume/scrub) |
| `Avatar`, `AvatarFallback`, `AvatarImage` | Radix Avatar | home-view |
| `Tooltip`, `TooltipProvider`, `TooltipContent`, `TooltipTrigger` | Radix Tooltip | home-view, index.tsx |
| `Toaster`, `toast` | **sonner** (add dep) | index.tsx, home-view, library-view, settings-view |
| `DropdownMenu*` (Trigger/Content/Item/CheckboxItem/Label/Separator) | Radix DropdownMenu | home-view, library-view |
| `ContextMenu*` (Trigger/Content/Item/Separator) | Radix ContextMenu | library-view |
| `Dialog` | Radix Dialog | library-view |
| `AlertDialog` | Radix AlertDialog | library-view, settings-view |
| `SplitView` | **custom** (2-pane resizable/fixed layout) | root-view, home-view, library-view |
| `Status` | **custom** (status text/spinner row) | root-view |
| `EmptyState` | **custom** (icon + title + description, `placement` prop) | pane-empty-state, library-view |
| `Sidebar`, `SidebarList`, `SidebarListItem` | **custom** (nav list) | app-sidebar |
| `Toolbar`, `ToolbarContent`, `ToolbarTitle`, `ToolbarActions`, `ToolbarDescription`, `ToolbarRow` | **custom** (header bar) | home-view, library-view, settings-view |
| `Field`, `FieldContent`, `FieldGroup`, `FieldLabel`, `FieldSet` | **custom** (settings form rows) | settings-view |
| `List` | **custom** (virtualizable list wrapper) | home-view |
| `ErrorBoundaryView` | **custom** (router error fallback) | router.tsx |

| Hook | Reimplementation |
|---|---|
| `useTheme` | subscribe to `nativeTheme:updated`, read `nativeTheme.getInfo()`, toggle `document.documentElement.classList` dark |
| `useConnection` | return `{ connected: true }` (or wrap `ipc.waitForReady()`); Electron IPC is always available |
| `useEnvironment` | return `{ flavor: window.glazeAPI.buildFlavor, isDevelopment: import.meta.env.DEV }` |

| Util | Reimplementation |
|---|---|
| `cn` | `twMerge(clsx(...inputs))` (deps already present) |
| `initLogging` | no-op or thin `console` setup |
| `isDevelopmentFlavor` | `(flavor) => flavor !== "Production"` |

### Task 4.0: Add sonner + scaffold ui dir

- [ ] **Step 1:** `npm i sonner@^1.5`
- [ ] **Step 2:** Create `renderer/ui/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
export function initLogging(): void {
  /* electron renderer logs to console already */
}
export function isDevelopmentFlavor(flavor: string | undefined): boolean {
  return flavor !== undefined && flavor !== "Production";
}
```

- [ ] **Step 3:** Commit: `git add renderer/ui package.json && git commit -m "feat(ui): scaffold ui utils + sonner"`

### Task 4.1: Standard shadcn/Radix components

Build each as its own file under `renderer/ui/`, then export from `renderer/ui/index.ts`. Use the official shadcn implementation for: `button.tsx`, `input.tsx`, `label.tsx`, `radio-group.tsx`, `scroll-area.tsx`, `slider.tsx`, `avatar.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `dialog.tsx`, `alert-dialog.tsx`. For `Toaster`/`toast`, re-export from sonner:

```ts
// renderer/ui/toast.ts
export { Toaster } from "sonner";
export { toast } from "sonner";
```

- [ ] **Representative full component — `renderer/ui/button.tsx`:**

```tsx
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-input bg-transparent hover:bg-accent",
        ghost: "hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 px-3", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";
```

> **Per-component procedure:** (1) read the call sites in the table; (2) copy the shadcn baseline; (3) reconcile prop names/variants with actual usage; (4) export from the barrel; (5) `npx vite build` and confirm that file's imports resolve.

- [ ] **Step (repeat per component):** build, export, build-check.
- [ ] **Commit** in small batches (e.g. "feat(ui): button, input, label", "feat(ui): overlays — dialog, dropdown, context-menu", ...).

### Task 4.2: Custom Glaze components

Build from scratch to match call-site usage. Read each listed call site first.

- [ ] **Representative full component — `renderer/ui/split-view.tsx`** (read root-view/home-view/library-view for the exact prop names; the shape below matches a two-pane left/right layout):

```tsx
import * as React from "react";
import { cn } from "./utils";

export interface SplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** initial left width in px */
  initialLeftWidth?: number;
  className?: string;
}

export function SplitView({ left, right, initialLeftWidth = 260, className }: SplitViewProps) {
  const [leftWidth, setLeftWidth] = React.useState(initialLeftWidth);
  const dragging = React.useRef(false);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) setLeftWidth(Math.max(180, Math.min(480, e.clientX)));
    };
    const onUp = () => (dragging.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className={cn("flex h-full w-full overflow-hidden", className)}>
      <div style={{ width: leftWidth }} className="shrink-0 overflow-auto border-r border-border">
        {left}
      </div>
      <div onMouseDown={() => (dragging.current = true)} className="w-px cursor-col-resize bg-border hover:bg-primary/40" />
      <div className="flex-1 overflow-auto">{right}</div>
    </div>
  );
}
```

> ⚠️ **Verify the SplitView API against root-view.tsx before finalizing** — it may use children/`slot` props rather than `left`/`right`. Adjust to match.

- [ ] Build the remaining customs against their call sites: `status.tsx`, `empty-state.tsx` (honor the `placement` prop noted in pane-empty-state.tsx), `sidebar.tsx` (Sidebar/SidebarList/SidebarListItem), `toolbar.tsx` (Toolbar + 5 sub-parts), `field.tsx` (Field + 4 sub-parts), `list.tsx`, `error-boundary-view.tsx`.
- [ ] **Commit** per component or small group.

### Task 4.3: Hooks

**Files:** `renderer/ui/hooks/use-theme.ts`, `use-connection.ts`, `use-environment.ts`

- [ ] **`use-theme.ts`:**

```ts
import { useEffect, useState } from "react";
import type { NativeThemeInfo } from "@platform/ipc-types";

export function useTheme() {
  const [info, setInfo] = useState<NativeThemeInfo | null>(null);
  useEffect(() => {
    window.glazeAPI.nativeTheme.getInfo().then(setInfo);
    return window.glazeAPI.glaze.ipc.onNotification("nativeTheme:updated", (p) =>
      setInfo(p as NativeThemeInfo),
    );
  }, []);
  useEffect(() => {
    if (info) document.documentElement.classList.toggle("dark", info.shouldUseDarkColors);
  }, [info]);
  return {
    theme: info?.shouldUseDarkColors ? "dark" : "light",
    setThemeSource: (s: "system" | "light" | "dark") => window.glazeAPI.nativeTheme.setThemeSource(s),
  };
}
```

- [ ] **`use-connection.ts`:** `export function useConnection() { return { connected: true }; }`
- [ ] **`use-environment.ts`:**

```ts
export function useEnvironment() {
  const flavor = (window.glazeAPI as { buildFlavor?: string }).buildFlavor ?? "Production";
  return { flavor, isDevelopment: import.meta.env.DEV };
}
```

> Reconcile the returned shape with `root-view.tsx`'s usage (`useTheme`, `useConnection`, `useEnvironment`) before finalizing.

- [ ] **Commit:** `feat(ui): theme/connection/environment hooks`

### Task 4.4: Barrel + repoint renderer imports

**Files:** Create `renderer/ui/index.ts`; modify all renderer `*.tsx` that import `@glaze/core/*`

- [ ] **Step 1:** Export everything from `renderer/ui/index.ts` (all components + `toast`/`Toaster`; hooks + utils can be re-exported here too, or imported from subpaths).
- [ ] **Step 2:** In each renderer file, replace:
  - `from "@glaze/core/components"` → `from "@ui"`
  - `from "@glaze/core/hooks"` → `from "@ui/hooks/use-theme"` etc. (or barrel)
  - `from "@glaze/core/utils"` → `from "@ui/utils"`
  - `from "@glaze/core/ipc"` (type `NativeThemeInfo` in settings-view) → `from "@platform/ipc-types"`

Run: `grep -rn "@glaze/core" renderer/`
Expected: no matches.

- [ ] **Step 3: Verify renderer builds**

Run: `npx vite build`
Expected: SUCCESS, outputs to `build/renderer/`.

- [ ] **Step 4: Commit:** `refactor(renderer): consume local @ui kit instead of @glaze`

### Task 4.5: Update tsconfig paths

**Files:** Modify `tsconfig.json`, `main/tsconfig.json`

- [ ] **Step 1:** In `tsconfig.json` remove all `@glaze/core/*` path entries and the Glaze `include` entries (`../glaze-core/global.d.ts`, the SDK path). Add:
```json
"paths": {
  "@ui": ["./renderer/ui/index.ts"],
  "@ui/*": ["./renderer/ui/*"],
  "@platform/*": ["./renderer/platform/*"]
}
```
- [ ] **Step 2:** In `main/tsconfig.json` remove all `@glaze/core/*` path entries (main now imports via relative `./platform/backend.js`).
- [ ] **Step 3: Verify types**

Run: `npm run type-check`
Expected: PASS (fix any residual type mismatches surfaced here).

- [ ] **Step 4: Commit:** `build: drop glaze tsconfig paths`

### Task 4.6: First full launch

- [ ] **Step 1:** Run `npm run dev`. Expected: Electron window opens, shows the Connect view (put.io not yet linked). Theme matches system. No console errors about missing `glazeAPI` or unresolved modules.
- [ ] **Step 2:** Open Settings (Cmd+,). Expected: settings window opens and renders.
- [ ] If broken, debug against the specific failing component/handler before proceeding.

---

## Phase 5 — In-app HLS player via hls.js (Chromium can't play HLS natively)

The renderer plays the `glaze-hls://…/index.m3u8` URL in a `<video>` element. WKWebView played HLS natively; Chromium does not. Attach hls.js where the player `<video>` lives (in `library-view.tsx`, the player component).

### Task 5.1: Wire hls.js into the player

**Files:** Modify the player component in `renderer/main/library-view.tsx` (locate the `<video>` whose `src` is the HLS url from `transcode:start`)

- [ ] **Step 1:** Read library-view.tsx to find the `<video>` element and the state holding the HLS url (the result of `invoke("transcode:start", …)`).

- [ ] **Step 2:** Replace direct `src=` assignment with an hls.js attach effect:

```tsx
import Hls from "hls.js";
import { useEffect, useRef } from "react";

function useHlsSource(videoRef: React.RefObject<HTMLVideoElement>, src: string | null) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    // Native HLS (Safari/WKWebView) — not Chromium, but kept for portability.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
  }, [videoRef, src]);
}
```

Apply `useHlsSource(videoRef, hlsUrl)` in the player and remove the old `src` binding.

- [ ] **Step 3:** Verify the custom `glaze-hls://` scheme is fetchable by hls.js. The scheme is registered with `supportFetchAPI: true` and `stream: true` (transcode.ts) — hls.js uses `fetch`/XHR, which works with privileged custom schemes. Confirm at runtime in Phase 5.4.

- [ ] **Step 4: Commit:** `feat(player): play HLS via hls.js (chromium has no native HLS)`

### Task 5.2: Runtime playback test

- [ ] **Step 1:** With put.io linked (run `putio auth login` once in Terminal for now), `npm run dev`, navigate to a video file, press play.
- [ ] **Step 2:** Expected: playlist loads, first segment transcodes (ffmpeg via videotoolbox), video plays and is seekable. Check the main-process console for `transcode` logs and absence of protocol 404/500s.
- [ ] If segments 404: verify the `net.fetch(pathToFileURL(...))` path in Task 2.3 resolves the temp seg files.

---

## Phase 6 — Bundle the CLIs (no Homebrew/install for friends)

### Task 6.1: Produce standalone CLI binaries

**Files:** Create `resources/bin/<platform>-<arch>/{putio,chilly}`

- [ ] **Step 1 — chilly (Go):** build static binaries:
```bash
# from the chilly source repo
GOOS=darwin GOARCH=arm64 go build -o chilly-darwin-arm64 .
GOOS=darwin GOARCH=amd64 go build -o chilly-darwin-x64 .
```
Copy to `resources/bin/darwin-arm64/chilly` and `resources/bin/darwin-x64/chilly`.

- [ ] **Step 2 — putio (TypeScript):** compile to a single binary:
```bash
# from putio-cli source, with bun:
bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile putio-darwin-arm64
bun build ./src/index.ts --compile --target=bun-darwin-x64  --outfile putio-darwin-x64
```
Copy to `resources/bin/darwin-arm64/putio` and `resources/bin/darwin-x64/putio`. (Fallback if no standalone build is possible: ship the CLI's built JS under `resources/cli/putio/` and invoke via `ELECTRON_RUN_AS_NODE` — see Task 6.2 Step 3.)

- [ ] **Step 3:** `chmod +x resources/bin/*/*` and commit the binaries (or document fetching them in CI). Commit: `chore: bundle putio + chilly cli binaries`

### Task 6.2: Resolve bundled CLI paths at runtime

**Files:** Create `main/services/cli-paths.ts`; modify `main/services/{putio,chilly,auth}.ts`

- [ ] **Step 1: Write `main/services/cli-paths.ts`**

```ts
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";

const PLATFORM_DIR = `${process.platform}-${process.arch}`;

/** Absolute path to a bundled CLI binary, falling back to PATH lookup by name. */
export function resolveCli(name: "putio" | "chilly"): string {
  // Packaged: resources/bin/<plat-arch>/<name> ; dev: repo resources/...
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "bin", PLATFORM_DIR)
    : path.join(app.getAppPath(), "resources", "bin", PLATFORM_DIR);
  const bundled = path.join(base, name + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(bundled)) return bundled;
  return name; // fall back to PATH (dev machines with brew install)
}
```

- [ ] **Step 2: Use it in the three services**

In `putio.ts`, `chilly.ts`, `auth.ts`, replace the literal command `"putio"` / `"chilly"` passed to `execFile`/`spawn` with `resolveCli("putio")` / `resolveCli("chilly")`. Example in `putio.ts`'s `runPutio`:
```ts
import { resolveCli } from "./cli-paths.js";
// ...
({ stdout } = await execFileAsync(resolveCli("putio"), [...args, "--output", "json"], EXEC_OPTS));
```
And the `ENOENT` message can stay (now only triggers if the bundled binary is missing).

Also update `auth.ts`'s `startFlow("putio", …)` / `startFlow("chilly", …)` calls to `startFlow(resolveCli("putio"), …)` etc., and the logout `execFileAsync` calls.

- [ ] **Step 3 (only if putio standalone binary unavailable):** make `resolveCli` return the Electron exe and prepend the JS entry, invoked through Node mode. Document: set `execFile(process.execPath, [cliJsPath, ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" } })`. This reuses Electron's embedded Node. (Skip if Step 2 of 6.1 produced a real binary.)

- [ ] **Step 4: Verify** main bundles and, in `npm run dev`, that `auth:status` works with the bundled binary (temporarily move your Homebrew `putio` off PATH to prove the bundled one is used).

- [ ] **Step 5: Commit:** `feat: resolve + use bundled putio/chilly binaries`

---

## Phase 7 — Package a distributable (.dmg/.app)

### Task 7.1: electron-builder config

**Files:** Create `electron-builder.yml`

- [ ] **Step 1: Write it**

```yaml
appId: io.put.octoput
productName: Octoput
directories:
  output: dist
files:
  - build/**/*
  - package.json
extraResources:
  - from: resources/bin
    to: bin
asar: true
mac:
  category: public.app-category.entertainment
  target:
    - dmg
    - zip
  identity: null         # ad-hoc; set to your Developer ID for notarized builds
  hardenedRuntime: false
  gatekeeperAssess: false
```

> `extraResources` puts `resources/bin/*` at `process.resourcesPath/bin/*` — matching `cli-paths.ts`. ffmpeg/ffprobe are resolved by the installer packages inside the asar at runtime; if asar causes binary-exec issues, add `@ffmpeg-installer/**` and `@ffprobe-installer/**` to an `asarUnpack` list.

- [ ] **Step 2: Add asarUnpack for native binaries**

Append to `electron-builder.yml`:
```yaml
asarUnpack:
  - "**/node_modules/@ffmpeg-installer/**"
  - "**/node_modules/@ffprobe-installer/**"
```

- [ ] **Step 3: Commit:** `build: electron-builder config`

### Task 7.2: Build and smoke-test the packaged app

- [ ] **Step 1:** `npm run package`
- [ ] **Step 2:** Expected: `dist/Octoput-1.0.0-arm64.dmg` (and zip) produced.
- [ ] **Step 3:** Open the `.app` from the dmg on a clean account (or after removing the Homebrew CLIs from PATH). Expected: app launches, links put.io, browses files, plays a video — **with no Glaze, no Homebrew CLIs installed**.
- [ ] **Step 4:** ffmpeg: confirm transcoding works using the bundled `@ffmpeg-installer` binary (the `resolveBinary` fallback in transcode.ts already prefers the bundled one). VLC/`installFfmpeg` Homebrew paths remain optional convenience features — note in README that the in-app player needs no Homebrew.
- [ ] **Step 5: Commit** any config fixes: `fix(package): <whatever surfaced>`

### Task 7.3: README for friends

**Files:** Create/replace `README.md`

- [ ] **Step 1:** Write install instructions: download the dmg, drag to Applications, on first launch right-click → Open (ad-hoc signed). One line on linking put.io. Note nothing else needs installing.
- [ ] **Step 2: Commit:** `docs: standalone install readme`

---

## Self-Review

**Spec coverage:**
- Re-host without Glaze → Phases 1–4 (build pipeline, backend shim, preload shim, UI kit). ✓
- Standalone executable → Phase 7 (electron-builder dmg). ✓
- No CLI install for friends → Phase 6 (bundled binaries + `resolveCli`). ✓
- HLS playback (the Chromium gotcha) → Phase 5 (hls.js). ✓
- `protocol.handle` API difference → Task 2.3. ✓
- `ipcMain.broadcast`, `windowKey`, `logger`, `initDevToolsButtonState` divergences → Task 2.1. ✓
- Native bridge calls the renderer makes (`shell.openExternal`, `nativeTheme.*`) → Task 2.4. ✓
- ffmpeg/ffprobe still work packaged → Task 7.2 Step 4 + asarUnpack. ✓

**Known gaps to confirm during execution (not placeholders — flagged unknowns):**
- Exact prop surface of every Glaze component (Phase 4) — must be read from call sites; representative components given for the two hardest cases (cva Button, custom SplitView).
- Whether `putio-cli` can produce a true standalone binary (Task 6.1 Step 2) — fallback path provided (Task 6.2 Step 3).
- `radix-ui` unified package import paths (e.g. `Slot.Root`) vs individual `@radix-ui/react-*` — confirm against the installed `radix-ui@1.4.3` API when building Task 4.1.

**Type consistency:** `resolveCli(name)` signature consistent across putio/chilly/auth; `NativeThemeInfo` shape identical in `native-handlers.ts`, `ipc-types.ts`, and `use-theme.ts`; `getWindowUrl(htmlFileName)`/`getPreloadPath()` names unchanged from original so callers in `main/index.ts` and `settings-window.ts` still resolve.
