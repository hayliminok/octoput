# Chromecast (Google Cast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cast the open video to a Chromecast / Google TV with the app as the remote — discovery + picker, play/pause/seek/stop, device volume, and subtitle + audio-track selection — by serving the existing ffmpeg→HLS transcode over a real LAN HTTP server the Chromecast can reach.

**Architecture:** Reuse `transcode.ts` (on-demand HLS). A new LAN HTTP server (`cast-server.ts`) exposes a session's playlist/segments/VTT over `http://<mac-lan-ip>:<port>/<token>/<sessionId>/…` with CORS. `cast-discovery.ts` browses mDNS for Chromecasts. `cast-sender.ts` drives the device via `castv2-client` (LOAD an HLS URL, transport, text tracks). IPC handlers + renderer Cast button/remote tie it together.

**Tech Stack:** Electron main (Node, TS, ESM `.js` import specifiers), React 18 renderer, `castv2-client` + `bonjour-service` (both pure-JS, no native modules). Verification: `npm run type-check` + `npm run build`; locally `curl` the LAN server; final cast playback is manual UAT on the user's real device.

**Spec:** `docs/superpowers/specs/2026-06-14-chromecast-design.md`

**Conventions:** main-side imports use `.js` specifiers (ESM); services export an `xxxService`/`castX` object; IPC handlers live in `main/handlers/index.ts` as `ipcMain.handle("chan", async (_event, params: unknown) => …)`; main→renderer push is `ipcMain.broadcast(channel, payload)`; renderer calls `window.glazeAPI.glaze.ipc.invoke(channel, params)` and `…onNotification(channel, cb)` (preload is pass-through — no channel allowlist). Every commit ends with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Work on branch `chromecast` (already created).

> **Reading the device-dependent gates:** Tasks 1–4 are fully verifiable on the dev Mac (type-check, install check, `curl`, real mDNS). Tasks 5–8 need the physical device and are gated on the user's manual UAT — do NOT mark them complete on type-check alone.

---

## File Structure

- **Modify** `main/services/transcode.ts` — extract a shared `serveHls(sessionId, fileName)` used by both the `glaze-hls` protocol handler and the LAN server; add `addSubtitle(sessionId, idx, vtt)`. One responsibility unchanged (on-demand HLS), now reusable over HTTP.
- **Create** `main/services/cast-server.ts` — LAN HTTP server + LAN-IPv4 detection. Serves a session via `serveHls`. Token-guarded, CORS, start/stop.
- **Create** `main/services/cast-discovery.ts` — mDNS browse, device registry, `cast:devices` broadcast.
- **Create** `main/services/cast-sender.ts` — `castv2-client` controller: connect/launch/LOAD/transport/volume/text-tracks/status; orchestrates transcode + cast-server + put.io subtitles.
- **Modify** `main/handlers/index.ts` — register `cast:*` handlers.
- **Modify** `main/index.ts` — start discovery after app ready; stop sessions on quit.
- **Create** `renderer/main/cast/cast-controls.tsx` — Cast button, device picker, and the remote UI.
- **Modify** `renderer/main/library-view.tsx` — mount the Cast controls in `PlayerPane`.

---

## Task 1: Add dependencies

**Files:** `package.json` (via npm)

- [ ] **Step 1: Install the two pure-JS deps**

Run:
```bash
npm install castv2-client bonjour-service
```
Expected: both resolve and install with no native build step (no node-gyp/electron-rebuild output). If npm prints peer/engine warnings only, that's fine.

- [ ] **Step 2: Confirm they're pure-JS (no native addon)**

Run:
```bash
ls node_modules/castv2-client node_modules/bonjour-service >/dev/null && \
find node_modules/castv2 node_modules/castv2-client node_modules/bonjour-service -name "*.node" 2>/dev/null | head
```
Expected: the two dirs exist and the `find` prints nothing (no `.node` binaries). If any `.node` appears, STOP and report — the bundling story changes.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS. (`castv2-client` ships no types; that's handled in Task 5 with a local declaration. It's unused so far, so this passes now.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(printf 'build: add castv2-client + bonjour-service for cast\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Refactor transcode for HTTP reuse + subtitle storage

**Files:** Modify `main/services/transcode.ts`

- [ ] **Step 1: Add a shared `serveHls` export and refactor the protocol handler to use it**

The protocol handler currently inlines playlist/segment serving. Extract it so the LAN server can reuse the exact on-demand logic. Add this exported function just above `registerHlsProtocol` (after `ensureSegment`):

```ts
/**
 * Resolve one HLS file for a session, transcoding the segment on demand.
 * Shared by the in-app `glaze-hls` protocol handler and the LAN cast server.
 * Returns null when the session or file is unknown (caller sends 404).
 */
export async function serveHls(
  sessionId: string,
  fileName: string,
): Promise<{ contentType: string; body: Buffer | string } | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (fileName === "index.m3u8") {
    const content = await fs.promises.readFile(path.join(session.dir, "index.m3u8"), "utf-8");
    return { contentType: "application/vnd.apple.mpegurl", body: content };
  }
  const seg = fileName.match(/^seg(\d+)\.ts$/);
  if (seg) {
    const segPath = await ensureSegment(session, Number(seg[1]));
    return { contentType: "video/mp2t", body: await fs.promises.readFile(segPath) };
  }
  const sub = fileName.match(/^sub\d+\.vtt$/);
  if (sub) {
    const subPath = path.join(session.dir, fileName);
    if (!fs.existsSync(subPath)) return null;
    return { contentType: "text/vtt", body: await fs.promises.readFile(subPath, "utf-8") };
  }
  return null;
}
```

Then replace the body of the `protocol.handle(HLS_SCHEME, …)` callback so it delegates to `serveHls`:

```ts
  protocol.handle(HLS_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const segments = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
      const out = await serveHls(segments[0], segments[1] ?? "");
      if (!out) {
        return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      return new Response(out.body, {
        status: 200,
        headers: { "Content-Type": out.contentType, "Cache-Control": "no-store" },
      });
    } catch (err) {
      logger.error("transcode", "protocol handler error", err as Error);
      return new Response("Error", { status: 500, headers: { "Content-Type": "text/plain" } });
    }
  });
```

- [ ] **Step 2: Add `addSubtitle` to `transcodeService`**

Add this method to the `transcodeService` object (e.g. after `setAudioTrack`):

```ts
  /** Store a WebVTT subtitle for a session so it can be served as sub<idx>.vtt. */
  async addSubtitle(sessionId: string, index: number, vtt: string): Promise<boolean> {
    const session = sessions.get(sessionId);
    if (!session) return false;
    await fs.promises.writeFile(path.join(session.dir, `sub${index}.vtt`), vtt, "utf-8");
    return true;
  },
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Verify in-app playback still works (manual UAT — user)**

Run `npm run dev`, open a video in Your Files, confirm it still plays and that audio-track switching still works (this exercises the refactored `serveHls` path via the `glaze-hls` scheme). This is a regression check for the refactor.

- [ ] **Step 5: Commit**

```bash
git add main/services/transcode.ts
git commit -m "$(printf 'refactor: extract transcode serveHls; add subtitle storage\n\nShared by the glaze-hls protocol handler and the upcoming LAN cast\nserver; addSubtitle writes sub<idx>.vtt into the session dir.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: LAN HTTP media server

**Files:** Create `main/services/cast-server.ts`

- [ ] **Step 1: Create `main/services/cast-server.ts`**

```ts
/**
 * A real LAN HTTP server that exposes a transcode session's HLS (playlist,
 * on-demand segments, subtitle VTTs) so a Chromecast on the network can fetch
 * it — the in-app `glaze-hls://` scheme only exists inside Electron.
 *
 * URLs: http://<lan-ip>:<port>/<token>/<sessionId>/<file>
 *   <file> ∈ { index.m3u8, seg<n>.ts, sub<n>.vtt }
 * The unguessable token scopes access; the server runs only while casting.
 */
import * as http from "http";
import * as os from "os";
import { randomUUID } from "crypto";

import { logger } from "../platform/backend.js";
import { serveHls } from "./transcode.js";

function lanIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

let server: http.Server | null = null;
let token = "";
let baseUrl = "";

export const castServer = {
  /** Start (or reuse) the server and return the base URL for `sessionId`. */
  async start(sessionId: string): Promise<string> {
    const ip = lanIPv4();
    if (!ip) throw new Error("Couldn't find your Mac's network address.");
    token = randomUUID();

    if (!server) {
      server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        void (async () => {
          try {
            const url = new URL(req.url ?? "/", "http://localhost");
            const parts = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
            if (parts[0] !== token) {
              res.writeHead(404);
              res.end();
              return;
            }
            const out = await serveHls(parts[1] ?? "", parts[2] ?? "");
            if (!out) {
              res.writeHead(404);
              res.end();
              return;
            }
            res.writeHead(200, { "Content-Type": out.contentType, "Cache-Control": "no-store" });
            res.end(out.body);
          } catch (err) {
            logger.error("cast-server", "serve error", err as Error);
            res.writeHead(500);
            res.end();
          }
        })();
      });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "0.0.0.0", resolve);
      });
    }

    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://${ip}:${port}/${token}/${sessionId}`;
    logger.info("cast-server", "started", { baseUrl });
    return baseUrl;
  },

  /** Current session base URL (e.g. to build sub<idx>.vtt URLs). */
  url(): string {
    return baseUrl;
  },

  stop(): void {
    if (server) {
      server.close();
      server = null;
    }
    token = "";
    baseUrl = "";
    logger.info("cast-server", "stopped");
  },
};
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Verify locally with curl (no device needed)**

Write a throwaway script `/tmp/cast-server-check.mjs` that starts a transcode session for a real put.io file id and the cast server, then curl the playlist + a segment + confirm CORS. Because the services are ESM under `main/` and depend on Electron's `protocol`, the simplest check is: run `npm run dev`, then in the app open a video (this creates a transcode session), and separately confirm the LAN server independently. Since the cast server is not yet wired to start in dev, instead verify the building blocks directly:

Run:
```bash
node -e "const os=require('os');const i=os.networkInterfaces();let ip=null;for(const n of Object.keys(i))for(const x of i[n]||[])if(x.family==='IPv4'&&!x.internal)ip=ip||x.address;console.log('LAN IPv4:',ip)"
```
Expected: prints a real `192.168.x.x`/`10.x.x.x` address (proves `lanIPv4()` will resolve on this machine). Full end-to-end `curl` of the served playlist happens in Task 6 once `cast:start` wires the server to a live session.

- [ ] **Step 4: Commit**

```bash
git add main/services/cast-server.ts
git commit -m "$(printf 'feat: LAN HTTP server for cast (serves transcode HLS + VTT)\n\nToken-guarded, CORS, on-demand via serveHls, LAN IPv4 detection.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: mDNS device discovery

**Files:** Create `main/services/cast-discovery.ts`

- [ ] **Step 1: Create `main/services/cast-discovery.ts`**

```ts
/**
 * Discovers Chromecast / Google TV devices on the LAN via mDNS
 * (_googlecast._tcp) and keeps a live registry, broadcasting changes to the
 * renderer as `cast:devices`.
 */
import { Bonjour, type Service } from "bonjour-service";

import { ipcMain, logger } from "../platform/backend.js";

export interface CastDevice {
  id: string;
  name: string;
  host: string; // IPv4 to connect castv2 to
  port: number; // usually 8009
  model?: string;
}

const devices = new Map<string, CastDevice>();
let bonjour: Bonjour | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null;

function ipv4Of(svc: Service): string | undefined {
  const addrs = (svc.addresses ?? []) as string[];
  return addrs.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
}

function toDevice(svc: Service): CastDevice | null {
  const ip = ipv4Of(svc);
  if (!ip) return null;
  const txt = (svc.txt ?? {}) as Record<string, string>;
  const id = txt.id || svc.fqdn || svc.name;
  return {
    id,
    name: txt.fn || svc.name || "Chromecast",
    host: ip,
    port: svc.port || 8009,
    model: txt.md,
  };
}

function broadcast(): void {
  ipcMain.broadcast("cast:devices", { devices: [...devices.values()] });
}

export const castDiscovery = {
  start(): void {
    if (bonjour) return;
    bonjour = new Bonjour();
    browser = bonjour.find({ type: "googlecast" });
    browser.on("up", (svc: Service) => {
      const d = toDevice(svc);
      if (!d) return;
      devices.set(d.id, d);
      logger.info("cast-discovery", "device up", { name: d.name, host: d.host });
      broadcast();
    });
    browser.on("down", (svc: Service) => {
      const d = toDevice(svc);
      if (d) devices.delete(d.id);
      broadcast();
    });
    logger.info("cast-discovery", "browsing _googlecast._tcp");
  },

  list(): CastDevice[] {
    return [...devices.values()];
  },

  get(id: string): CastDevice | undefined {
    return devices.get(id);
  },

  stop(): void {
    try {
      browser?.stop();
      bonjour?.destroy();
    } catch {
      // ignore teardown errors
    }
    browser = null;
    bonjour = null;
    devices.clear();
  },
};
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS. If `bonjour-service` type names differ (e.g. the class is exported as `default` or the service type is `Service` vs `BrowserService`), adjust the import to match the installed package's `.d.ts` — read `node_modules/bonjour-service/dist/*.d.ts` and use the exact exported names. Keep the `CastDevice` shape unchanged.

- [ ] **Step 3: Verify real discovery (user — Mac on same LAN as the device)**

Confirm the bundled CLI-free discovery sees the real device. Run:
```bash
node -e "const {Bonjour}=require('bonjour-service');const b=new Bonjour();b.find({type:'googlecast'},s=>{console.log('FOUND',s.name,(s.addresses||[]).join(','),s.txt&&s.txt.fn)});setTimeout(()=>process.exit(0),6000)"
```
Expected: within ~6s it prints the user's Chromecast/Google TV with an IPv4 and friendly name. If nothing prints, the device isn't reachable via mDNS from this machine (subnet/Wi-Fi isolation) — STOP and resolve before continuing, since the rest depends on it.

- [ ] **Step 4: Commit**

```bash
git add main/services/cast-discovery.ts
git commit -m "$(printf 'feat: mDNS chromecast discovery\n\nBrowses _googlecast._tcp, keeps a device registry, broadcasts cast:devices.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Cast sender (castv2-client controller)

**Files:** Create `main/services/cast-sender.ts`; create `main/services/castv2-client.d.ts`

> **Device-dependent.** The `castv2-client` API below is the documented surface, but the exact `EDIT_TRACKS_INFO` call and event payloads must be confirmed against the installed package and the real device during Task 8 UAT. Read `node_modules/castv2-client/lib/**` if a method/signature differs.

- [ ] **Step 1: Add a minimal type declaration for the untyped lib**

Create `main/services/castv2-client.d.ts`:

```ts
declare module "castv2-client" {
  import { EventEmitter } from "events";
  export class Client extends EventEmitter {
    connect(host: string | { host: string; port?: number }, cb: () => void): void;
    launch(app: unknown, cb: (err: Error | null, player: MediaController) => void): void;
    setVolume(opts: { level?: number; muted?: boolean }, cb?: (err: Error | null, v: unknown) => void): void;
    getVolume(cb: (err: Error | null, v: { level: number; muted: boolean }) => void): void;
    close(): void;
  }
  export interface MediaController extends EventEmitter {
    load(media: unknown, options: unknown, cb: (err: Error | null, status: MediaStatus) => void): void;
    play(cb?: (err: Error | null) => void): void;
    pause(cb?: (err: Error | null) => void): void;
    stop(cb?: (err: Error | null) => void): void;
    seek(seconds: number, cb?: (err: Error | null) => void): void;
    getStatus(cb: (err: Error | null, status: MediaStatus) => void): void;
    // EDIT_TRACKS_INFO — present on the MediaController in castv2-client.
    sessionRequest?(data: unknown, cb?: (err: Error | null, res: unknown) => void): void;
  }
  export interface MediaStatus {
    playerState?: string;
    currentTime?: number;
    media?: { duration?: number };
    volume?: { level?: number; muted?: boolean };
    activeTrackIds?: number[];
  }
  export const DefaultMediaReceiver: unknown;
}
```

- [ ] **Step 2: Create `main/services/cast-sender.ts`**

```ts
/**
 * Drives a Chromecast via castv2-client: connect, launch the Default Media
 * Receiver, LOAD the LAN-served HLS, and relay transport + status. Audio-track
 * switches re-encode (via transcode) and re-LOAD; subtitles are Cast text tracks.
 */
import { Client, DefaultMediaReceiver, type MediaController, type MediaStatus } from "castv2-client";

import { ipcMain, logger } from "../platform/backend.js";
import { transcodeService } from "./transcode.js";
import { putioService } from "./putio.js";
import { castServer } from "./cast-server.js";
import { castDiscovery } from "./cast-discovery.js";

interface SubTrack {
  trackId: number;
  language: string;
  name: string;
  url: string;
}

interface Active {
  client: Client;
  player: MediaController;
  deviceName: string;
  fileId: number;
  sessionId: string;
  subs: SubTrack[];
  audioIndex: number;
  poster?: string;
}

let active: Active | null = null;

function pushStatus(status: MediaStatus): void {
  if (!active) return;
  ipcMain.broadcast("cast:status", {
    device: active.deviceName,
    playerState: status.playerState ?? "IDLE",
    currentTime: status.currentTime ?? 0,
    duration: status.media?.duration ?? 0,
    volume: status.volume?.level ?? 1,
    activeTrackIds: status.activeTrackIds ?? [],
  });
}

function connect(host: string, port: number): Promise<{ client: Client; player: MediaController }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("error", (err: Error) => {
      reject(err);
      try {
        client.close();
      } catch {
        /* ignore */
      }
    });
    client.connect({ host, port }, () => {
      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err || !player) return reject(err ?? new Error("launch failed"));
        resolve({ client, player });
      });
    });
  });
}

function buildMedia(active: Active, title: string) {
  return {
    contentId: `${castServer.url()}/index.m3u8`,
    contentType: "application/vnd.apple.mpegurl",
    streamType: "BUFFERED",
    metadata: {
      type: 0,
      metadataType: 0,
      title,
      images: active.poster ? [{ url: active.poster }] : [],
    },
    tracks: active.subs.map((s) => ({
      trackId: s.trackId,
      type: "TEXT",
      trackContentId: s.url,
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
      language: s.language,
      name: s.name,
    })),
  };
}

function loadMedia(active: Active, title: string, startTime: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const media = buildMedia(active, title);
    active.player.load(media, { autoplay: true, currentTime: startTime }, (err, status) => {
      if (err) return reject(err);
      active.player.on("status", pushStatus);
      pushStatus(status);
      resolve();
    });
  });
}

export const castSender = {
  isActive(): boolean {
    return active !== null;
  },

  async start(fileId: number, deviceId: string, poster?: string): Promise<void> {
    const device = castDiscovery.get(deviceId);
    if (!device) throw new Error("That device is no longer available.");
    await castSender.stop();

    // Reuse the in-app transcode pipeline (also gates ffmpeg).
    const { sessionId, audioTracks } = await transcodeService.start(fileId);
    await castServer.start(sessionId);

    // Fetch put.io subtitles → VTT → store on the session → Cast text tracks.
    const subs: SubTrack[] = [];
    try {
      const { subtitles } = await putioService.subtitles(fileId);
      for (let i = 0; i < Math.min(subtitles.length, 8); i++) {
        const sub = subtitles[i];
        try {
          const { vtt } = await putioService.subtitleVtt(fileId, sub.key);
          await transcodeService.addSubtitle(sessionId, i, vtt);
          subs.push({
            trackId: 100 + i, // keep subtitle ids clear of any future audio ids
            language: sub.language || "und",
            name: sub.label || `Subtitle ${i + 1}`,
            url: `${castServer.url()}/sub${i}.vtt`,
          });
        } catch {
          // skip a subtitle that fails to convert
        }
      }
    } catch {
      // no subtitles available
    }

    const { client, player } = await connect(device.host, device.port);

    active = {
      client,
      player,
      deviceName: device.name,
      fileId,
      sessionId,
      subs,
      audioIndex: 0,
      poster,
    };

    await loadMedia(active, `File ${fileId}`, 0);
    logger.info("cast-sender", "casting", { fileId, device: device.name, subs: subs.length });
  },

  play(): void {
    active?.player.play();
  },
  pause(): void {
    active?.player.pause();
  },
  seek(time: number): void {
    active?.player.seek(time);
  },
  setVolume(level: number): void {
    active?.client.setVolume({ level: Math.max(0, Math.min(1, level)) });
  },

  /** Enable one subtitle track (by index into `subs`) or disable all (index < 0). */
  setSubtitle(index: number): void {
    if (!active) return;
    const ids = index >= 0 && active.subs[index] ? [active.subs[index].trackId] : [];
    active.player.sessionRequest?.({ type: "EDIT_TRACKS_INFO", activeTrackIds: ids });
  },

  /** Switch audio track: re-encode from the current position and re-LOAD. */
  async setAudioTrack(index: number): Promise<void> {
    if (!active || index === active.audioIndex) return;
    const at = active;
    const status = await new Promise<MediaStatus>((resolve) =>
      at.player.getStatus((_e, s) => resolve(s ?? {})),
    );
    const position = status.currentTime ?? 0;
    await transcodeService.setAudioTrack(at.sessionId, index);
    at.audioIndex = index;
    await loadMedia(at, `File ${at.fileId}`, position);
  },

  async stop(): Promise<void> {
    const a = active;
    active = null;
    if (!a) return;
    try {
      a.player.stop();
      a.client.close();
    } catch {
      /* ignore */
    }
    castServer.stop();
    await transcodeService.stop(a.sessionId).catch(() => {});
    ipcMain.broadcast("cast:status", { device: a.deviceName, playerState: "STOPPED", currentTime: 0, duration: 0, volume: 1, activeTrackIds: [] });
    logger.info("cast-sender", "stopped");
  },
};
```

- [ ] **Step 3: Confirm `putioService.subtitles` / `subtitleVtt` signatures**

Run: `grep -n "subtitles\|subtitleVtt" main/services/putio.ts`
Expected: `subtitles(fileId)` returns `{ subtitles: { key; label; language }[] }` and `subtitleVtt(fileId, key)` returns `{ vtt: string }` (the renderer uses these via `putio:subtitles`/`putio:subtitleVtt`). If the property names differ, adjust the field access in `start()` to match.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main/services/cast-sender.ts main/services/castv2-client.d.ts
git commit -m "$(printf 'feat: cast sender (castv2-client) — load/transport/tracks\n\nConnect + Default Media Receiver, LOAD LAN HLS, play/pause/seek/volume,\nCast text-track subtitles, audio switch via re-encode + re-LOAD.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: IPC wiring + lifecycle

**Files:** Modify `main/handlers/index.ts`, `main/index.ts`

- [ ] **Step 1: Register cast IPC handlers**

In `main/handlers/index.ts`, add the imports alongside the existing service imports:

```ts
import { castDiscovery } from "../services/cast-discovery.js";
import { castSender } from "../services/cast-sender.js";
```

Then inside `registerHandlers()`, add (next to the other groups):

```ts
  // ── Google Cast ───────────────────────────────────────────────────────
  ipcMain.handle("cast:listDevices", async () => ({ devices: castDiscovery.list() }));

  ipcMain.handle("cast:start", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      fileId?: unknown;
      deviceId?: unknown;
      poster?: unknown;
    };
    if (typeof p.fileId !== "number" || typeof p.deviceId !== "string") {
      throw new Error("cast:start requires fileId (number) and deviceId (string)");
    }
    await castSender.start(p.fileId, p.deviceId, typeof p.poster === "string" ? p.poster : undefined);
    return { ok: true };
  });

  ipcMain.handle("cast:play", async () => {
    castSender.play();
    return { ok: true };
  });
  ipcMain.handle("cast:pause", async () => {
    castSender.pause();
    return { ok: true };
  });
  ipcMain.handle("cast:stop", async () => {
    await castSender.stop();
    return { ok: true };
  });
  ipcMain.handle("cast:seek", async (_event, params: unknown) => {
    const time = typeof params === "object" && params !== null ? (params as { time?: unknown }).time : undefined;
    if (typeof time !== "number") throw new Error("cast:seek requires time (number)");
    castSender.seek(time);
    return { ok: true };
  });
  ipcMain.handle("cast:setVolume", async (_event, params: unknown) => {
    const level = typeof params === "object" && params !== null ? (params as { level?: unknown }).level : undefined;
    if (typeof level !== "number") throw new Error("cast:setVolume requires level (number)");
    castSender.setVolume(level);
    return { ok: true };
  });
  ipcMain.handle("cast:setSubtitle", async (_event, params: unknown) => {
    const index = typeof params === "object" && params !== null ? (params as { index?: unknown }).index : undefined;
    if (typeof index !== "number") throw new Error("cast:setSubtitle requires index (number)");
    castSender.setSubtitle(index);
    return { ok: true };
  });
  ipcMain.handle("cast:setAudioTrack", async (_event, params: unknown) => {
    const index = typeof params === "object" && params !== null ? (params as { index?: unknown }).index : undefined;
    if (typeof index !== "number") throw new Error("cast:setAudioTrack requires index (number)");
    await castSender.setAudioTrack(index);
    return { ok: true };
  });
```

- [ ] **Step 2: Start discovery after app ready; stop cast on quit**

In `main/index.ts`, find where the app finishes initializing (where `registerHlsProtocol()` / `registerHandlers()` are called after `app.whenReady()`). Add the discovery start there:

```ts
  castDiscovery.start();
```

and add the import at the top:

```ts
import { castDiscovery } from "./services/cast-discovery.js";
import { castSender } from "./services/cast-sender.js";
```

Then in the existing app-quit / `before-quit` / `will-quit` cleanup (wherever `transcodeService.stopAll()` or window teardown happens — search `before-quit` / `stopAll`), add:

```ts
  void castSender.stop();
  castDiscovery.stop();
```

If no such quit hook exists, add one:

```ts
app.on("before-quit", () => {
  void castSender.stop();
  castDiscovery.stop();
});
```

- [ ] **Step 3: Hold a powerSaveBlocker while casting**

In `main/services/cast-sender.ts`, import `powerSaveBlocker` from Electron and hold it for the session. Add to the imports:

```ts
import { powerSaveBlocker } from "electron";
```

Add a module-level `let blockerId: number | null = null;`, start it at the end of `start()` after a successful `loadMedia`:

```ts
    if (blockerId === null) blockerId = powerSaveBlocker.start("prevent-app-suspension");
```

and release it in `stop()` (before/after teardown):

```ts
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
```

(If `electron` is not directly importable in main services here, use the same import path other services use for Electron APIs — check `main/platform/backend.ts` for how `protocol` is sourced and follow that pattern.)

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 5: End-to-end LAN-server curl (user, with the app running)**

Run `npm run dev`, sign in, open a video, and trigger `cast:start` once the renderer Cast button exists (Task 7) — OR, to verify now, temporarily call `cast:start` from the devtools console:
```js
await window.glazeAPI.glaze.ipc.invoke("cast:listDevices")        // shows your device
```
Then after Task 7 wires the button, confirm the served playlist responds:
```bash
curl -is "http://<lan-ip>:<port>/<token>/<sessionId>/index.m3u8" | head
```
Expected: `200`, `Access-Control-Allow-Origin: *`, and an `#EXTM3U` body. (The exact URL is logged by `cast-server` as `started { baseUrl }`.)

- [ ] **Step 6: Commit**

```bash
git add main/handlers/index.ts main/index.ts main/services/cast-sender.ts
git commit -m "$(printf 'feat: cast IPC handlers + discovery lifecycle + powerSaveBlocker\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: Renderer — Cast button, device picker, remote

**Files:** Create `renderer/main/cast/cast-controls.tsx`; modify `renderer/main/library-view.tsx`

- [ ] **Step 1: Create `renderer/main/cast/cast-controls.tsx`**

A self-contained component that (a) tracks discovered devices, (b) renders a Cast button + device-picker menu, and (c) when casting, renders the remote (play/pause, seek, volume, subtitle menu, audio menu, stop). It receives the file plus its audio/subtitle metadata from `PlayerPane`.

```tsx
import * as React from "react";
import { Cast, Pause, Play, Volume2, Captions, AudioLines, X } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, Slider, toast, cn } from "@ui";

const invoke = window.glazeAPI.glaze.ipc.invoke;
const onNotification = window.glazeAPI.glaze.ipc.onNotification;

interface CastDevice { id: string; name: string; model?: string }
interface CastStatus {
  device: string;
  playerState: string;
  currentTime: number;
  duration: number;
  volume: number;
  activeTrackIds: number[];
}

interface AudioTrackMeta { index: number; label: string }
interface SubMeta { index: number; label: string }

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function CastControls({
  fileId,
  poster,
  audioTracks,
  subtitles,
}: {
  fileId: number;
  poster?: string;
  audioTracks: AudioTrackMeta[];
  subtitles: SubMeta[];
}) {
  const [devices, setDevices] = React.useState<CastDevice[]>([]);
  const [status, setStatus] = React.useState<CastStatus | null>(null);
  const [subIndex, setSubIndex] = React.useState(-1);
  const [audioIndex, setAudioIndex] = React.useState(0);

  React.useEffect(() => {
    invoke<{ devices: CastDevice[] }>("cast:listDevices").then((r) => setDevices(r.devices)).catch(() => {});
    const offDevices = onNotification("cast:devices", (p) => setDevices((p as { devices: CastDevice[] }).devices));
    const offStatus = onNotification("cast:status", (p) => {
      const s = p as CastStatus;
      setStatus(s.playerState === "STOPPED" ? null : s);
    });
    return () => {
      offDevices();
      offStatus();
    };
  }, []);

  const startCast = async (deviceId: string) => {
    try {
      await invoke("cast:start", { fileId, deviceId, poster });
      setSubIndex(-1);
      setAudioIndex(0);
    } catch (e) {
      toast.error(`Couldn't cast: ${(e as Error).message}`);
    }
  };

  // Not casting → just the Cast button (only when devices exist).
  if (!status) {
    if (devices.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Cast" className="shrink-0 transition-opacity hover:opacity-80">
            <Cast className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          {devices.map((d) => (
            <DropdownMenuCheckboxItem key={d.id} checked={false} onCheckedChange={() => startCast(d.id)}>
              {d.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Casting → remote.
  const playing = status.playerState === "PLAYING";
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-gray-2 p-4">
      <div className="flex items-center gap-2 text-callout text-gray-a11">
        <Cast className="size-4 text-blue-9" />
        <span className="truncate">Casting to {status.device}</span>
        <button
          aria-label="Stop casting"
          onClick={() => invoke("cast:stop").catch(() => {})}
          className="ml-auto rounded-md p-1.5 hover:bg-gray-a3"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => invoke(playing ? "cast:pause" : "cast:play").catch(() => {})}
          className="shrink-0"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
        <span className="shrink-0 text-footnote tabular-nums">{fmt(status.currentTime)}</span>
        <Slider
          className="flex-1"
          value={[Math.min(status.currentTime, status.duration || 0)]}
          min={0}
          max={status.duration > 0 ? status.duration : 1}
          step={1}
          onValueChange={([v]) => invoke("cast:seek", { time: v }).catch(() => {})}
        />
        <span className="shrink-0 text-footnote tabular-nums">{fmt(status.duration)}</span>
        <Volume2 className="size-5 shrink-0" />
        <Slider
          className="w-20 shrink-0"
          value={[status.volume]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => invoke("cast:setVolume", { level: v }).catch(() => {})}
        />
        {subtitles.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Subtitles" className="shrink-0">
                <Captions className={cn("size-5", subIndex >= 0 && "text-blue-9")} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuCheckboxItem
                checked={subIndex === -1}
                onCheckedChange={() => {
                  setSubIndex(-1);
                  invoke("cast:setSubtitle", { index: -1 }).catch(() => {});
                }}
              >
                Off
              </DropdownMenuCheckboxItem>
              {subtitles.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s.index}
                  checked={subIndex === s.index}
                  onCheckedChange={() => {
                    setSubIndex(s.index);
                    invoke("cast:setSubtitle", { index: s.index }).catch(() => {});
                  }}
                >
                  {s.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {audioTracks.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Audio track" className="shrink-0">
                <AudioLines className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              {audioTracks.map((t) => (
                <DropdownMenuCheckboxItem
                  key={t.index}
                  checked={audioIndex === t.index}
                  onCheckedChange={() => {
                    setAudioIndex(t.index);
                    invoke("cast:setAudioTrack", { index: t.index }).catch(() => {});
                  }}
                >
                  {t.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `PlayerPane`**

In `renderer/main/library-view.tsx`, import the component near the top:

```tsx
import { CastControls } from "./cast/cast-controls";
```

`PlayerPane` already has `audioTracks` (state, `AudioTrack[]` with `index` + an `audioLabel(t, i)` helper) and `tracks` (state, the loaded subtitle list `{ label, lang, url }`). Render `CastControls` inside the `PlayerPane` return, right below the video container `<div>` (after the control-bar `</div>` that closes the gradient bar, still inside the outer `<div className="p-4">`). Map the existing metadata to the component's props:

```tsx
        <CastControls
          fileId={file.id}
          poster={file.screenshot}
          audioTracks={audioTracks.map((t, i) => ({ index: i, label: audioLabel(t, i) }))}
          subtitles={tracks.map((t, i) => ({ index: i, label: t.label }))}
        />
```

(`audioLabel` and `tracks`/`audioTracks` are already defined in `PlayerPane` — confirm the names while editing.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS. Confirm `Cast` and `AudioLines` are valid `lucide-react` icons (they are); if `cn`, `Slider`, `DropdownMenu*`, `toast` aren't all exported from `@ui`, check `renderer/ui/index.ts` and import from the matching path (library-view already imports all of these).

- [ ] **Step 4: Commit**

```bash
git add renderer/main/cast/cast-controls.tsx renderer/main/library-view.tsx
git commit -m "$(printf 'feat: cast button, device picker, and remote UI in the player\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: Full verification + device UAT

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build**

Run: `npm run type-check && npm run build`
Expected: both PASS.

- [ ] **Step 2: Device UAT (user, with the real Chromecast/Google TV)**

Run `npm run dev`, open a video, and verify end to end:
1. The Cast button appears (device discovered) and the picker lists the device.
2. Selecting it starts playback **on the TV** within a few seconds.
3. Play/pause, seek, and volume from the remote affect the TV.
4. Subtitle menu toggles subtitles on the TV (on/off + language), no reload.
5. Audio-track switch changes the audio on the TV (brief reload + resume near position).
6. Stop/disconnect ends the cast and the LAN server stops (check logs: `cast-server stopped`).
7. A non-mp4-converted file (one where put.io has no `/hls/`) still casts (proves Mac-served path).

- [ ] **Step 3: Confirm the castv2 specifics that needed the device**

During Step 2, if subtitle toggling or audio switching misbehaves, inspect `node_modules/castv2-client/lib/controllers/media.js` for the actual `EDIT_TRACKS_INFO` / `load` option names and adjust `cast-sender.ts` (`setSubtitle`, `loadMedia` options) accordingly, then re-verify. This is the one area the plan could not validate without the device.

---

## Notes / deviations from skill defaults

- **No TDD / unit tests** — the repo has no runner; verification is type-check + build + `curl` + manual UAT, per project norms. Logic is concentrated in small, named units.
- **Device-dependent tasks (5–8)** are explicitly gated on the user's hardware; type-check passing is necessary but NOT sufficient to mark them done.
- **`castv2-client` is untyped** — a local `.d.ts` (Task 5) covers the surface used; the real API is confirmed against the device in Task 8.
- The in-app playlist file is `index.m3u8` (not `media.m3u8` as the spec wrote generically); the plan uses the real name.
