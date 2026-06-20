# Chromecast (Google Cast) — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Branch:** `chromecast`

## Goal

Cast the video that's open in octoput to a Chromecast / Google TV on the same
network, with the app acting as the remote: device discovery + picker, play /
pause / seek / stop, device volume, and **subtitle + audio-track selection**
(scope B). Works for any file regardless of put.io's mp4-conversion state.

## Why the Mac serves the media

put.io only exposes its `/v2/files/<id>/hls/` endpoint for files it has
converted to mp4 (the `is_mp4_available` flag), so relying on put.io's HLS alone
is unreliable. The app already transcodes any file to Chromecast-friendly HLS
(H.264/AAC) with ffmpeg — today it serves that over the private `glaze-hls://`
Electron scheme, which a Chromecast on the LAN cannot reach (an in-process
privileged scheme never exists on the network). The missing piece is exposing
that same HLS output over a **real LAN HTTP server** bound to the Mac's network
IP, then pointing the Chromecast at `http://<mac-ip>:<port>/…/media.m3u8`. This
reuses the proven transcode pipeline and works for every file/codec.

**Chosen approach (of three considered):** reuse the existing single-audio
transcode + a LAN HTTP server + Cast TEXT tracks for subtitles. Rejected:
(2) building a full multi-rendition HLS master (instant native audio switching,
but substantial new ffmpeg/playlist engineering); (3) a hybrid that casts
put.io's HLS directly when `is_mp4_available` (two code paths, limited track
control, inconsistent behavior).

## Components

All new `main/` units are pure-JS (no native modules → no electron-rebuild).

### `main/services/cast-discovery.ts`
Browses mDNS for `_googlecast._tcp.local`. Maintains a live registry of devices
`{ id, name, host, port, model }` (name from the TXT `fn` record, model from
`md`). Pushes updates to the renderer via a `cast:devices` notification. Library
lean: **`bonjour-service`** (maintained, simpler API than raw `multicast-dns`).

### `main/services/cast-server.ts`
A Node `http.createServer` bound to `0.0.0.0` on an ephemeral port. Serves:
- the transcode output directory (HLS playlist + `.ts` segments) — the same
  `ROOT` the `glaze-hls` handler reads from in `transcode.ts`;
- subtitle `.vtt` files written from put.io subtitles.

Every response carries permissive CORS headers (`Access-Control-Allow-Origin: *`)
— the Cast receiver requires CORS for HLS playlists/segments and text tracks.
Requests are scoped under an unguessable per-session path token
(`/<token>/…`); requests without a valid token get 404. Detects the Mac's LAN
IPv4 from `os.networkInterfaces()` (first non-internal IPv4). The server starts
when a cast session begins and stops on disconnect, so files are not exposed
when not casting.

### `main/services/cast-sender.ts`
The `castv2-client` controller. Connects to the device over TLS:`<port>` (8009),
launches the **Default Media Receiver** (app id `CC1AD845`), and:
- **LOAD**: `MediaInformation` with `contentId` = `http://<ip>:<port>/<token>/media.m3u8`,
  `contentType` = `application/vnd.apple.mpegurl`, `streamType` BUFFERED,
  `metadata` (title + poster = put.io screenshot URL, a public URL the TV fetches
  itself), and `tracks[]` = one TEXT track per subtitle
  (`trackId`, `trackContentId` = VTT URL, `trackContentType` `text/vtt`,
  `subtype` SUBTITLES, `language`).
- **Transport**: play, pause, seek, stop, `setVolume` (receiver volume 0–1).
- **Subtitles**: `EDIT_TRACKS_INFO` to enable/disable a text track (no reload).
- **Audio track**: call `transcode.setAudioTrack` (re-encode from the current
  position), then re-LOAD the media at the saved position.
- Relays `MEDIA_STATUS` (player state, currentTime, duration, volume) to the
  renderer via a `cast:status` notification.

### IPC
Handlers: `cast:listDevices`, `cast:start({ fileId, deviceId })`,
`cast:play`, `cast:pause`, `cast:seek({ time })`, `cast:stop`,
`cast:setVolume({ level })`, `cast:setSubtitle({ index })`,
`cast:setAudioTrack({ index })`.
Notifications: `cast:devices`, `cast:status`.

### Renderer (`renderer/main/cast/…`, integrated into `library-view.tsx`)
A **Cast button** in the `PlayerPane` control bar, shown only when at least one
device is discovered. Clicking opens a **device picker** (menu). On selecting a
device the in-app `<video>` relinquishes playback and the pane swaps to a
**"Casting to <device>"** remote: play/pause, a seek slider driven by
`cast:status`, a volume slider, a subtitle menu, an audio-track menu, and a
Stop/Disconnect button. The remote reuses the audio-track and subtitle metadata
the player already loads.

## Data flow (start → playing)

1. Renderer: Cast → pick device → `cast:start({ fileId, deviceId })`.
2. Main: `transcode.startSession(fileId)` → HLS in `ROOT` (existing pipeline).
   Start `cast-server` → base URL `http://<lan-ip>:<port>/<token>`. Fetch put.io
   subtitles and write them as `.vtt` into the served directory.
3. Main: build `MediaInformation` (HLS URL + TEXT tracks + poster + title).
4. `cast-sender` connects, launches the receiver, LOADs the media. The Chromecast
   pulls the playlist/segments/VTT from the Mac over LAN HTTP and plays.
5. Main relays `MEDIA_STATUS` → `cast:status`; the renderer shows the remote.

## Tracks & volume (scope B)

- **Subtitles** — Cast TEXT tracks (VTT over the LAN server); on/off + language
  via `EDIT_TRACKS_INFO`, rendered by the TV, no reload.
- **Audio track** — reuses `transcode.setAudioTrack` (re-encode from position);
  `cast-sender` re-LOADs at the saved position. Brief TV reload — the same
  trade-off the in-app player already has on audio switch.
- **Volume** — Cast receiver volume (0–1) via `setVolume`.

## Error handling & constraints

- The Mac must stay awake while casting → hold a `powerSaveBlocker` for the
  duration of a cast session; release on stop/disconnect.
- ffmpeg is required (casting depends on the transcode) → reuse the existing
  "Install ffmpeg" gate from the in-app player.
- Device unreachable / different subnet / connection drop / LOAD timeout →
  surface a toast and fall back to the in-app player.
- No LAN IPv4 found → clear error: "Couldn't find your Mac's network address."
- LAN exposure mitigated by the unguessable per-session token; the server stops
  on disconnect.

## Scope boundaries (YAGNI)

- **In:** single device, single video, play/pause/seek/stop, volume, subtitle +
  audio-track selection.
- **Out:** queue / up-next, resume-after-relaunch, multiple simultaneous devices,
  and the put.io-`is_mp4_available` direct-cast optimization.

## Testing

- `npm run type-check` + `npm run build` must pass.
- Locally verifiable without the TV: mDNS discovery lists the device; `curl` the
  LAN-served playlist + a segment + a VTT and confirm 200 + CORS headers.
- Manual UAT on the real device (user): device appears in the picker; casting
  starts and plays on the TV; play/pause/seek/stop/volume work; subtitle toggle
  works; audio-track switch works (with the expected brief reload).

## Files

- Create: `main/services/cast-discovery.ts`, `main/services/cast-server.ts`,
  `main/services/cast-sender.ts`.
- Modify: the main IPC registration (add `cast:*` handlers + notifications);
  `main/services/transcode.ts` (expose `ROOT` / a way to serve session output
  over HTTP, and reuse `startSession` / `setAudioTrack`).
- Create: `renderer/main/cast/` (Cast button, device picker, remote UI);
  modify `renderer/main/library-view.tsx` (`PlayerPane`) to mount the Cast
  button + remote.
- Add deps: `castv2-client`, `bonjour-service`.
