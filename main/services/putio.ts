/**
 * put.io service
 *
 * Browses the user's put.io files via the `putio` CLI and builds authenticated
 * stream URLs for in-app video playback. The CLI handles its own OAuth session
 * (configured via `putio auth login`); we read the stored token only to
 * construct streaming URLs the API can serve directly to a <video> element.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { logger } from "../platform/backend.js";
import { resolveCli } from "./cli-paths.js";

const execFileAsync = promisify(execFile);

const PATH_WITH_HOMEBREW = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const EXEC_OPTS = {
  maxBuffer: 32 * 1024 * 1024,
  timeout: 60_000,
  env: { ...process.env, PATH: PATH_WITH_HOMEBREW },
} as const;

const CONFIG_PATH = path.join(os.homedir(), ".config", "putio", "config.json");

export interface PutioFile {
  id: number;
  name: string;
  parentId: number;
  fileType: string;
  size: number;
  isFolder: boolean;
  isVideo: boolean;
  thumbnail?: string;
  /** put.io's full video frame (no icon fallback) — used as a player poster. */
  screenshot?: string;
}

export interface Transfer {
  id: number;
  name: string;
  status: string; // DOWNLOADING | COMPLETED | SEEDING | ERROR | IN_QUEUE | …
  percentDone: number; // 0–100
  size: number; // bytes
  downSpeed: number; // bytes/s
  estimatedTime: number | null; // seconds remaining, if known
  errorMessage?: string;
}

export interface PutioFolderInfo {
  id: number;
  name: string;
  parentId: number;
}

export interface PutioListing {
  files: PutioFile[];
  parent: PutioFolderInfo;
}

export interface PutioAuthStatus {
  authenticated: boolean;
  username?: string;
}

interface RawFile {
  id?: number | string;
  name?: string;
  parent_id?: number | string;
  parentId?: number | string;
  file_type?: string;
  fileType?: string;
  content_type?: string;
  contentType?: string;
  size?: number | string;
  screenshot?: string;
  icon?: string;
}

interface CliError {
  error?: { title?: string; message?: string };
}

/** Run a putio subcommand and parse its JSON output, surfacing CLI errors. */
// put.io uses negative ids for shared content (-2 is the "Shared with you"
// root, and shared files/folders themselves have negative ids). The CLI's flag
// parser reads a bare "-2" token as a flag ("Unrecognized flag: -2"), so id
// values must be passed joined as --flag=value, which parses negatives correctly.
function idFlag(flag: string, value: number | string): string {
  return `${flag}=${value}`;
}

async function runPutio<T>(args: string[]): Promise<T> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(resolveCli("putio"), [...args, "--output", "json"], EXEC_OPTS));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (e.code === "ENOENT") {
      throw new Error("putio CLI not found. Install it with: brew install putdotio/tap/putio-cli");
    }
    // The CLI prints structured error JSON to stdout even on non-zero exit.
    stdout = e.stdout ?? "";
    if (!stdout) {
      throw new Error(e.message || "putio command failed");
    }
  }

  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("Could not parse putio output");
  }

  const maybeError = data as CliError;
  if (maybeError && typeof maybeError === "object" && maybeError.error) {
    throw new Error(maybeError.error.message || maybeError.error.title || "put.io error");
  }
  return data as T;
}

function normalizeFile(raw: RawFile): PutioFile {
  const fileType = String(raw.file_type ?? raw.fileType ?? "FILE").toUpperCase();
  const contentType = String(raw.content_type ?? raw.contentType ?? "");
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? "Untitled"),
    parentId: Number(raw.parent_id ?? raw.parentId ?? 0),
    fileType,
    size: Number(raw.size ?? 0),
    isFolder: fileType === "FOLDER",
    isVideo: fileType === "VIDEO" || contentType.startsWith("video"),
    thumbnail: raw.screenshot || raw.icon || undefined,
    screenshot: raw.screenshot || undefined,
  };
}

interface RawTransfer {
  id?: number;
  name?: string;
  status?: string;
  percent_done?: number;
  size?: number;
  down_speed?: number;
  estimated_time?: number | null;
  error_message?: string | null;
}

function normalizeTransfer(raw: RawTransfer): Transfer {
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? "Transfer"),
    status: String(raw.status ?? "").toUpperCase(),
    percentDone: Number(raw.percent_done ?? 0),
    size: Number(raw.size ?? 0),
    downSpeed: Number(raw.down_speed ?? 0),
    estimatedTime: raw.estimated_time != null ? Number(raw.estimated_time) : null,
    errorMessage: raw.error_message ? String(raw.error_message) : undefined,
  };
}

export const putioService = {
  /** Probe whether the put.io CLI has a valid session. */
  async authStatus(): Promise<PutioAuthStatus> {
    try {
      // A lightweight authenticated call — fails fast when the token is invalid.
      await runPutio<{ files?: RawFile[] }>(["files", "list", "--per-page", "1"]);
      let username: string | undefined;
      try {
        // `putio whoami` nests account details under `info` (info.username).
        const who = await runPutio<{ info?: { username?: string }; username?: string }>(["whoami"]);
        username = who.info?.username ?? who.username;
      } catch {
        // username is optional
      }
      return { authenticated: true, username };
    } catch (err) {
      logger.info("putio", "not authenticated", { detail: (err as Error).message });
      return { authenticated: false };
    }
  },

  /** List the contents of a folder (0 = root). */
  async listFiles(parentId: number): Promise<PutioListing> {
    logger.info("putio", "listFiles", { parentId });
    // No --sort-by: put.io returns files in the account's configured sort order,
    // which we preserve as-is.
    const data = await runPutio<{ files?: RawFile[]; parent?: RawFile }>([
      "files",
      "list",
      idFlag("--parent-id", parentId),
      "--per-page",
      "1000",
    ]);

    const files = Array.isArray(data.files) ? data.files.map(normalizeFile) : [];

    const parent: PutioFolderInfo = data.parent
      ? {
          id: Number(data.parent.id ?? parentId),
          name: String(data.parent.name ?? "Your Files"),
          parentId: Number(data.parent.parent_id ?? data.parent.parentId ?? 0),
        }
      : { id: parentId, name: parentId === 0 ? "Your Files" : "Folder", parentId: 0 };

    logger.info("putio", "listFiles complete", { parentId, count: files.length });
    return { files, parent };
  },

  /** Move a file/folder into another folder. */
  async move(fileId: number, parentId: number): Promise<void> {
    logger.info("putio", "move", { fileId, parentId });
    await runPutio(["files", "move", idFlag("--id", fileId), idFlag("--parent-id", parentId)]);
  },

  /** Delete a file/folder (sent to put.io trash). */
  async remove(fileId: number): Promise<void> {
    logger.info("putio", "delete", { fileId });
    await runPutio(["files", "delete", idFlag("--id", fileId)]);
  },

  /** Search the user's put.io files across the whole account. */
  async search(query: string): Promise<PutioFile[]> {
    const q = query.trim();
    if (!q) return [];
    logger.info("putio", "search", { query: q });
    const data = await runPutio<{ files?: RawFile[] }>([
      "files",
      "search",
      "--query",
      q,
      "--per-page",
      "200",
    ]);
    const files = Array.isArray(data.files) ? data.files.map(normalizeFile) : [];
    logger.info("putio", "search complete", { query: q, count: files.length });
    return files;
  },

  /** Add a magnet/URL as a transfer, optionally saving into a target folder. */
  async addTransfer(url: string, saveParentId?: number): Promise<void> {
    const args = ["transfers", "add", "--url", url];
    if (typeof saveParentId === "number" && saveParentId >= 0) {
      args.push("--save-parent-id", String(saveParentId));
    }
    logger.info("putio", "addTransfer", { saveParentId, url: url.slice(0, 80) });
    await runPutio(args);
  },

  /**
   * Upload a .torrent file to put.io, which starts a transfer.
   *
   * The bundled CLI can't upload files, so we POST directly to put.io's upload
   * endpoint with the stored OAuth token. Used both for local .torrent files the
   * user picks and for Jackett results whose download proxy returns torrent
   * bytes instead of a magnet (e.g. private trackers).
   */
  async uploadTorrent(data: Uint8Array, filename: string, saveParentId?: number): Promise<void> {
    const { token } = await readAuth();
    const form = new FormData();
    form.append("file", new Blob([data], { type: "application/x-bittorrent" }), filename);
    if (typeof saveParentId === "number" && saveParentId >= 0) {
      form.append("parent_id", String(saveParentId));
    }
    logger.info("putio", "uploadTorrent", { filename, saveParentId, bytes: data.byteLength });
    const res = await fetch("https://upload.put.io/v2/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`put.io upload failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  },

  /** All transfers on the account, normalized. */
  async listTransfers(): Promise<Transfer[]> {
    const data = await runPutio<{ transfers?: RawTransfer[] }>(["transfers", "list", "--page-all"]);
    return (data.transfers ?? []).map(normalizeTransfer);
  },

  /** Cancel/remove a transfer by id. */
  async cancelTransfer(id: number): Promise<void> {
    await runPutio(["transfers", "cancel", "--id", String(id)]);
  },

  /** Remove finished (completed/errored) transfers from the list. */
  async cleanTransfers(): Promise<void> {
    await runPutio(["transfers", "clean"]);
  },

  /** The account's default download folder (pre-selected target for new transfers). */
  async defaultFolder(): Promise<{ id: number; name: string }> {
    try {
      const who = await runPutio<{ info?: { settings?: { default_download_folder?: number } } }>([
        "whoami",
      ]);
      const id = Number(who.info?.settings?.default_download_folder ?? 0);
      if (!id) return { id: 0, name: "Your Files" };
      const data = await runPutio<{ parent?: RawFile }>([
        "files",
        "list",
        idFlag("--parent-id", id),
        "--per-page",
        "1",
      ]);
      return { id, name: data.parent?.name ? String(data.parent.name) : "Folder" };
    } catch {
      return { id: 0, name: "Your Files" };
    }
  },

  /**
   * Build authenticated playback URLs for a file.
   * - `hls`: an HLS playlist that transcodes + serves segments, so playback is
   *   progressive (starts fast, supports seeking) instead of downloading the
   *   whole file. WKWebView plays HLS natively.
   * - `fallback`: the direct `/stream` URL, used if HLS can't be produced.
   */
  async streamUrl(fileId: number): Promise<{ hls: string; fallback: string }> {
    const { token, apiBaseUrl } = await readAuth();
    const t = encodeURIComponent(token);
    logger.info("putio", "streamUrl", { fileId });
    return {
      hls: `${apiBaseUrl}/v2/files/${fileId}/hls/media.m3u8?oauth_token=${t}&subtitle_languages=all`,
      fallback: `${apiBaseUrl}/v2/files/${fileId}/stream?oauth_token=${t}`,
    };
  },

  /** List available subtitle tracks for a file. */
  async listSubtitles(fileId: number): Promise<{ key: string; label: string; language: string }[]> {
    const { token, apiBaseUrl } = await readAuth();
    const res = await fetch(
      `${apiBaseUrl}/v2/files/${fileId}/subtitles?oauth_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      subtitles?: { key?: string; language?: string; name?: string; language_code?: string }[];
    };
    const subs = (data.subtitles ?? [])
      .filter((s) => s.key)
      .map((s) => ({
        key: String(s.key),
        label: s.name || s.language || "Subtitle",
        language: s.language_code || s.language || "und",
      }));
    logger.info("putio", "listSubtitles", { fileId, count: subs.length });
    return subs;
  },

  /** Fetch a subtitle as WebVTT (converting from SRT if needed). */
  async subtitleVtt(fileId: number, key: string): Promise<string> {
    const { token, apiBaseUrl } = await readAuth();
    const res = await fetch(
      `${apiBaseUrl}/v2/files/${fileId}/subtitles/${encodeURIComponent(key)}?oauth_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) throw new Error(`Couldn't load subtitle (${res.status})`);
    const text = await res.text();
    return text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text);
  },

  /**
   * Fetch a text/markdown file's contents for in-app preview. Done in the main
   * process because the renderer (file:// origin) can't fetch put.io directly
   * (CORS). Capped to the first ~512 KB via a Range request.
   */
  async fileText(fileId: number): Promise<string> {
    const { token, apiBaseUrl } = await readAuth();
    const res = await fetch(
      `${apiBaseUrl}/v2/files/${fileId}/stream?oauth_token=${encodeURIComponent(token)}`,
      { headers: { Range: "bytes=0-524287" } },
    );
    if (!res.ok && res.status !== 206) throw new Error(`Couldn't load file (${res.status})`);
    return await res.text();
  },
};

async function readAuth(): Promise<{ token: string; apiBaseUrl: string }> {
  let token: string | undefined;
  let apiBaseUrl = "https://api.put.io";
  try {
    const config = JSON.parse(await fs.promises.readFile(CONFIG_PATH, "utf-8"));
    token = config.auth_token;
    if (typeof config.api_base_url === "string") apiBaseUrl = config.api_base_url;
  } catch {
    throw new Error("put.io is not connected. Run “putio auth login” in Terminal.");
  }
  if (!token) throw new Error("No put.io token found. Run “putio auth login” in Terminal.");
  return { token, apiBaseUrl };
}

/** Minimal SRT → WebVTT conversion (header + comma→dot timestamps). */
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r+/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${body}`;
}
