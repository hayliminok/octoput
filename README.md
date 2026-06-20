# Octoput

A desktop streaming client for [put.io](https://put.io). Browse and search your
put.io files, search torrents and add them as transfers, and stream video right
in the app.

- Browse and search your put.io cloud storage
- Stream video in-app — any container/codec, transcoded on the fly (HLS via a
  bundled ffmpeg; nothing extra to install), with subtitle and audio-track
  selection
- Search torrents across multiple indexers (a bundled
  [Jackett](https://github.com/Jackett/Jackett) server) and add results as put.io
  transfers
- Add transfers by magnet link, URL, or by uploading a `.torrent` file (private
  trackers included)
- Watch download progress on the Transfers page

## Install (macOS)

Apple Silicon (arm64) only for now.

1. Download `Octoput-<version>-arm64.dmg` from the latest release.
2. Open the DMG and drag **Octoput** into your **Applications** folder.
3. Octoput is ad-hoc signed but **not notarized by Apple**, so macOS Gatekeeper
   blocks the first launch. Getting past it is a one-time, Terminal-free step —
   the exact path depends on your macOS version:

   - **macOS 15 (Sequoia) or later:** double-click Octoput, then click **Done**
     on the "Apple could not verify…" dialog. Open **System Settings → Privacy &
     Security**, scroll to the **Security** section, and next to *"Octoput" was
     blocked…* click **Open Anyway** → authenticate → **Open Anyway** again.
   - **macOS 14 (Sonoma) or earlier:** right-click (or Control-click) Octoput in
     Applications → **Open**, then click **Open** in the dialog.

   You only need to do this once; afterwards Octoput opens normally.

> [!NOTE]
> The "Open Anyway" step is inherent to any app that isn't notarized through a
> paid Apple Developer account — it isn't specific to Octoput.

## Linking your account

On first launch, Octoput shows a **Connect** screen that authorizes the app with
your **put.io** account through a browser sign-in. Once connected, your files and
torrent search are ready to go.

## Playback

In-app playback works out of the box — `ffmpeg`/`ffprobe` are bundled, so any
container/codec is transcoded to HLS and played in the window. Pick subtitle and
audio tracks from the player controls.

## Torrent search

Search runs through a bundled Jackett server, started automatically on demand. A
curated set of public indexers is configured out of the box; choose which ones
are searched in **Settings → Torrent search**, or open Jackett's own web UI from
there for advanced configuration. Adding a result always creates a put.io
transfer.

## Build from source

Requires Node.js 24+.

```sh
npm install      # install dependencies
npm run dev      # run the app in development
npm run package  # build a distributable (DMG/ZIP) in dist/
```

### Bundled binaries

Octoput bundles platform-specific binaries that are **not committed to git**.
Drop them in before `npm run package`:

- **put.io CLI** — `resources/bin/<platform>-<arch>/putio` (for example
  `resources/bin/darwin-arm64/putio`). See
  [`resources/bin/README.md`](resources/bin/README.md). If absent, Octoput falls
  back to resolving `putio` from your `PATH`.
- **Jackett** — the Jackett release for your platform, in
  `resources/jackett/<platform>-<arch>/`.
