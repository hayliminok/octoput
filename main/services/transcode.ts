/**
 * On-demand segment transcoding for in-app playback of any format.
 *
 * Instead of transcoding the whole movie up front (which downloads the entire
 * file and gives a growing, unseekable scrubber), we:
 *   1. Probe the duration and write a complete VOD HLS playlist (fixed segment
 *      list + ENDLIST) — so the player knows the full length immediately and
 *      the scrubber is stable and fully seekable.
 *   2. Transcode each segment only when the player requests it, using ffmpeg
 *      input-seek (`-ss` before `-i`, which uses HTTP range requests) so only
 *      that slice is read from put.io — no whole-file download.
 *
 * Segments are served to the renderer over a privileged `glaze-hls` scheme so
 * the in-window <video> plays any container/codec (MKV, HEVC, E-AC-3, …).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

import { protocol, logger } from "../platform/backend.js";

import { putioService } from "./putio.js";

const execFileAsync = promisify(execFile);
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };

// Prefer the ffmpeg/ffprobe binaries bundled with the app (no Homebrew needed).
// The backend runs from .glaze/build/main but node_modules lives in
// .glaze-sources, so resolve both the dev location and the built location, then
// fall back to a system install on PATH.
const PLATFORM_DIR = `${process.platform}-${process.arch}`; // e.g. darwin-arm64
const requireCjs = createRequire(import.meta.url);

// Native binaries can't be executed from inside an asar archive. electron-builder
// copies them out to app.asar.unpacked (via asarUnpack), but @ffmpeg-installer still
// reports the in-asar path, so rewrite it. No-op in dev (no "app.asar" in the path).
function toUnpacked(p: string): string {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function resolveBinary(pkg: string, scope: string, name: string, fallback: string): string {
  try {
    const resolved = (requireCjs(pkg) as { path?: string }).path;
    if (resolved) {
      const unpacked = toUnpacked(resolved);
      if (fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    // not resolvable from the build dir — try explicit paths below
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, "..", "..", "..", ".glaze-sources", "node_modules", scope, PLATFORM_DIR, name),
      path.join(here, "..", "..", "node_modules", scope, PLATFORM_DIR, name),
      path.join(here, "node_modules", scope, PLATFORM_DIR, name),
    ];
    for (const candidate of candidates) {
      const unpacked = toUnpacked(candidate);
      if (fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // fall through to PATH
  }
  logger.info("transcode", `bundled ${name} not found; using PATH`);
  return fallback;
}

const FFMPEG = resolveBinary("@ffmpeg-installer/ffmpeg", "@ffmpeg-installer", "ffmpeg", "ffmpeg");
const FFPROBE = resolveBinary("@ffprobe-installer/ffprobe", "@ffprobe-installer", "ffprobe", "ffprobe");

export const HLS_SCHEME = "glaze-hls";
const ROOT = path.join(os.tmpdir(), "torrentfinder-hls");
const SEG = 6; // seconds per segment

export interface AudioTrack {
  index: number; // 0-based among audio streams (maps to ffmpeg 0:a:<index>)
  language?: string;
  title?: string;
  codec?: string;
  channels?: number;
}

interface Session {
  id: string;
  dir: string;
  url: string;
  durationSec: number;
  audioIndex: number; // which audio stream is muxed into segments
  audioTracks: AudioTrack[];
}

const sessions = new Map<string, Session>();
const inflight = new Map<string, Promise<string>>();

function buildPlaylist(durationSec: number): string {
  const count = Math.max(1, Math.ceil(durationSec / SEG));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEG}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  for (let i = 0; i < count; i++) {
    const segDur = Math.min(SEG, durationSec - i * SEG);
    lines.push(`#EXTINF:${segDur.toFixed(3)},`, `seg${i}.ts`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** Transcode a single segment on demand (cached on disk; concurrent calls dedupe). */
function ensureSegment(session: Session, idx: number): Promise<string> {
  const segPath = path.join(session.dir, `seg${idx}.ts`);
  if (fs.existsSync(segPath)) return Promise.resolve(segPath);

  const key = `${session.id}:${idx}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = (async () => {
    const start = idx * SEG;
    const dur = Math.min(SEG, session.durationSec - start);
    const tmp = path.join(session.dir, `seg${idx}.tmp.ts`);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      // Input-seek: ffmpeg reads only from `start` via HTTP range — no full download.
      "-ss",
      String(start),
      "-i",
      session.url,
      "-t",
      String(dur),
      "-map",
      "0:v:0",
      "-map",
      `0:a:${session.audioIndex}?`,
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      "8M",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "-sn",
      // Offset PTS so the segment lands at the right place on the timeline
      // (a fresh per-segment encode already starts with a keyframe).
      "-output_ts_offset",
      String(start),
      "-muxdelay",
      "0",
      "-muxpreload",
      "0",
      "-f",
      "mpegts",
      tmp,
    ];
    await execFileAsync(FFMPEG, args, { env: ENV, timeout: 120_000, maxBuffer: 1 << 20 });
    await fs.promises.rename(tmp, segPath);
    return segPath;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

// Must run synchronously at import time — before app 'ready' fires.
protocol.registerSchemesAsPrivileged([
  {
    scheme: HLS_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Register the HLS protocol handler. Call after app is ready. */
export async function registerHlsProtocol(): Promise<void> {
  await fs.promises.mkdir(ROOT, { recursive: true }).catch(() => {});

  protocol.handle(HLS_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const segments = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
      const session = sessions.get(segments[0]);
      const fileName = segments[1] ?? "";
      if (!session) {
        return new Response("No session", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (fileName === "index.m3u8") {
        const content = await fs.promises.readFile(path.join(session.dir, "index.m3u8"), "utf-8");
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
        });
      }
      const match = fileName.match(/^seg(\d+)\.ts$/);
      if (match) {
        const segPath = await ensureSegment(session, Number(match[1]));
        const buf = await fs.promises.readFile(segPath);
        return new Response(buf, { status: 200, headers: { "Content-Type": "video/mp2t" } });
      }
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    } catch (err) {
      logger.error("transcode", "protocol handler error", err as Error);
      return new Response("Error", { status: 500, headers: { "Content-Type": "text/plain" } });
    }
  });

  logger.info("transcode", "registered HLS protocol", { scheme: HLS_SCHEME, root: ROOT });
}

async function ffmpegInstalled(): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG, ["-version"], { env: ENV, timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

async function probeDuration(url: string): Promise<number> {
  const { stdout } = await execFileAsync(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", url],
    { env: ENV, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(parsed.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/** Enumerate the file's audio streams (ordered; array index = ffmpeg 0:a:<i>). */
async function probeAudioTracks(url: string): Promise<AudioTrack[]> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      ["-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", url],
      { env: ENV, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: { codec_name?: string; channels?: number; tags?: { language?: string; title?: string } }[];
    };
    return (parsed.streams ?? []).map((s, i) => ({
      index: i,
      language: s.tags?.language,
      title: s.tags?.title,
      codec: s.codec_name,
      channels: typeof s.channels === "number" ? s.channels : undefined,
    }));
  } catch {
    return [];
  }
}

export const transcodeService = {
  async ffmpegStatus(): Promise<{ installed: boolean }> {
    return { installed: await ffmpegInstalled() };
  },

  async installFfmpeg(): Promise<{ installed: boolean }> {
    logger.info("transcode", "installing ffmpeg via Homebrew");
    await execFileAsync("brew", ["install", "ffmpeg"], {
      env: ENV,
      timeout: 15 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { installed: await ffmpegInstalled() };
  },

  /** Prepare playback: probe duration + write the VOD playlist. Fast (no encode). */
  async start(
    fileId: number,
  ): Promise<{ url: string; sessionId: string; audioTracks: AudioTrack[]; audioIndex: number }> {
    if (!(await ffmpegInstalled())) {
      throw new Error("ffmpeg is not installed.");
    }
    const { fallback } = await putioService.streamUrl(fileId);
    const [durationSec, audioTracks] = await Promise.all([
      probeDuration(fallback),
      probeAudioTracks(fallback),
    ]);
    if (!durationSec) {
      throw new Error("Couldn't read this video's duration.");
    }

    const sessionId = randomUUID();
    const dir = path.join(ROOT, sessionId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "index.m3u8"), buildPlaylist(durationSec), "utf-8");

    sessions.set(sessionId, { id: sessionId, dir, url: fallback, durationSec, audioIndex: 0, audioTracks });
    logger.info("transcode", "session ready", { fileId, sessionId, durationSec, audio: audioTracks.length });
    return { url: `${HLS_SCHEME}://hls/${sessionId}/index.m3u8`, sessionId, audioTracks, audioIndex: 0 };
  },

  /**
   * Switch the muxed audio track. Clears already-encoded segments so they
   * regenerate with the new track; the renderer reloads the playlist (cache-
   * busted) and seeks back to the current position.
   */
  async setAudioTrack(sessionId: string, index: number): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (index < 0 || index >= session.audioTracks.length) return;
    session.audioIndex = index;
    // Drop cached/in-flight segments — they carry the previous audio track.
    for (const key of [...inflight.keys()]) {
      if (key.startsWith(`${sessionId}:`)) inflight.delete(key);
    }
    const files = await fs.promises.readdir(session.dir).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((f) => /^seg\d+\.(ts|tmp\.ts)$/.test(f))
        .map((f) => fs.promises.rm(path.join(session.dir, f), { force: true }).catch(() => {})),
    );
    logger.info("transcode", "audio track switched", { sessionId, index });
  },

  async stop(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    for (const key of [...inflight.keys()]) {
      if (key.startsWith(`${sessionId}:`)) inflight.delete(key);
    }
    await fs.promises.rm(session.dir, { recursive: true, force: true }).catch(() => {});
    logger.info("transcode", "stopped session", { sessionId });
  },

  stopAll(): void {
    for (const id of [...sessions.keys()]) void transcodeService.stop(id);
  },
};
