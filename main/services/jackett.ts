/**
 * Bundled Jackett sidecar.
 *
 * Jackett is a long-running .NET server exposing a Torznab API on localhost. We
 * spawn the bundled binary on demand, read the API key it writes to its config,
 * auto-configure a curated set of public (no-auth) indexers, and search them via
 * Torznab. The user picks which of these default indexers to search; richer
 * indexer management is delegated to Jackett's own web UI.
 *
 * NOTE: exact Jackett args / config paths / API shapes are version-specific and
 * were written without a binary to test against — expect a fixup pass once the
 * macOS arm64 build is dropped into resources/jackett/<platform-arch>/.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { XMLParser } from "fast-xml-parser";

import { app, logger } from "../platform/backend.js";
import type { ReleaseInfo, SearchResult } from "./search-types.js";

const PORT = 9117;
const BASE = `http://127.0.0.1:${PORT}`;
const PLATFORM_DIR = `${process.platform}-${process.arch}`;
const DATA_DIR = path.join(app.getPath("userData"), "jackett-data");
const SELECTION_PATH = path.join(app.getPath("userData"), "octoput-jackett.json");

// Indexers auto-configured on first run — the full catalog a user can toggle in
// Settings. Cloudflare-gated indexers (1337x, torrentgalaxy, eztv) are excluded:
// their managed Turnstile challenge needs a solver we can't run (see the
// FlareSolverr revert in git history); the clones/mirrors below don't gate.
const DEFAULT_INDEXERS = [
  "internetarchive",
  "limetorrents",
  "magnetdownload",
  "nyaasi",
  "thepiratebay",
  "therarbg",
  "torrentdownloads",
  "torrentdownload",
  "torrentgalaxyclone",
  "torrentscsv",
  "yts",
];

// Of the configured indexers, the ones searched by default on a fresh install.
// Users can change the selection in Settings; their choice persists and wins.
const DEFAULT_ACTIVE = [
  "limetorrents",
  "therarbg",
  "torrentdownloads",
  "torrentdownload",
  "torrentgalaxyclone",
];

function exePath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "jackett", PLATFORM_DIR)
    : path.join(app.getAppPath(), "resources", "jackett", PLATFORM_DIR);
  return path.join(base, process.platform === "win32" ? "jackett.exe" : "jackett");
}

let proc: ChildProcess | null = null;
let startPromise: Promise<void> | null = null;
// Jackett's admin API (list/configure indexers) is cookie-session protected even
// with no admin password — log in once and reuse the cookie. Torznab search is
// authed separately by the API key and needs no cookie.
let authCookie: string | null = null;

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/** A resolved download: either a URL put.io can fetch, or raw .torrent bytes. */
export type ResolvedDownload =
  | { kind: "url"; url: string }
  | { kind: "torrent"; data: Uint8Array; filename: string };

/** Derive a .torrent filename from the proxy link's `file` query param. */
function torrentFilename(proxyUrl: string): string {
  try {
    const name = new URL(proxyUrl).searchParams.get("file");
    if (name) {
      const safe = name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120);
      if (safe) return `${safe}.torrent`;
    }
  } catch {
    // fall through to default
  }
  return "download.torrent";
}

async function login(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/UI/Dashboard`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=", // no admin password configured
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) authCookie = setCookie.split(";")[0];
  } catch (err) {
    logger.error("jackett", "login failed", err as Error);
  }
}

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(authCookie ? { Cookie: authCookie } : {}), ...(extra ?? {}) };
}

function readApiKey(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "ServerConfig.json"), "utf-8")) as {
      APIKey?: string;
    };
    return cfg.APIKey ?? null;
  } catch {
    return null;
  }
}

function readSelection(): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(SELECTION_PATH, "utf-8")) as { selected?: string[] };
    if (Array.isArray(cfg.selected)) return cfg.selected;
  } catch {
    // no selection yet
  }
  return DEFAULT_ACTIVE;
}

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/UI/Dashboard`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Jackett did not start in time");
}

/**
 * Extract release metadata (resolution, codec, quality…) from a torrent title.
 *
 * Jackett's Torznab feed only gives the raw release name, so we parse it here.
 * Without it the renderer's resolution/codec filters have nothing to key off
 * and silently drop every result.
 */
function parseReleaseInfo(rawTitle: string): ReleaseInfo {
  // Release names use ./_/space interchangeably as separators; normalise so
  // word boundaries match tokens like "x265" in "Movie.2024.x265.mkv".
  const t = ` ${rawTitle.replace(/[._]+/g, " ")} `;
  const m = (re: RegExp): string | undefined => t.match(re)?.[0]?.trim();

  let resolution: string | undefined = m(/\b(?:4320|2160|1440|1080|720|576|480)p\b/i)?.toLowerCase();
  if (!resolution && /\b(?:4k|uhd)\b/i.test(t)) resolution = "2160p";

  let codec: string | undefined;
  // Titles arrive separator-normalised, so "x264"/"x.264"/"H264"/"H.264" all
  // read as "[xh] ?264"; map every spelling of the same format to one value.
  if (/\b(?:[xh]\s?265|hevc)\b/i.test(t)) codec = "x265";
  else if (/\b(?:[xh]\s?264|avc)\b/i.test(t)) codec = "x264";
  else if (/\bav1\b/i.test(t)) codec = "av1";
  else if (/\b(?:xvid|divx)\b/i.test(t)) codec = "xvid";
  else if (/\bvp9\b/i.test(t)) codec = "vp9";

  let quality: string | undefined;
  if (/\bremux\b/i.test(t)) quality = "REMUX";
  else if (/\b(?:blu-?ray|bd-?rip|br-?rip|bd-?remux)\b/i.test(t)) quality = "BluRay";
  else if (/\bweb-?dl\b/i.test(t)) quality = "WEB-DL";
  else if (/\bweb-?rip\b/i.test(t)) quality = "WEBRip";
  else if (/\bweb\b/i.test(t)) quality = "WEB";
  else if (/\bhdtv\b/i.test(t)) quality = "HDTV";
  else if (/\bdvd-?rip\b/i.test(t)) quality = "DVDRip";
  else if (/\b(?:hd-?cam|cam-?rip|\bcam\b)\b/i.test(t)) quality = "CAM";

  let audio: string | undefined;
  if (/\batmos\b/i.test(t)) audio = "Atmos";
  else if (/\btrue-?hd\b/i.test(t)) audio = "TrueHD";
  else if (/\bdts-?hd\b/i.test(t)) audio = "DTS-HD";
  else if (/\bdts\b/i.test(t)) audio = "DTS";
  else if (/\b(?:ddp?|e-?ac-?3|dd\+)\b/i.test(t)) audio = "DD+";
  else if (/\bac-?3\b/i.test(t)) audio = "AC3";
  else if (/\baac\b/i.test(t)) audio = "AAC";
  else if (/\bflac\b/i.test(t)) audio = "FLAC";

  const bitDepth = /\b10-?\s?bit\b/i.test(t) ? "10bit" : /\b8-?\s?bit\b/i.test(t) ? "8bit" : undefined;

  return { resolution, codec, quality, audio, bitDepth };
}

// Noise words ignored when matching a query against result titles.
const QUERY_STOPWORDS = new Set(["and", "the", "a", "an", "of", "or", "to", "in", "&"]);

/** Significant lowercased tokens from a search query (drops stopwords/punctuation). */
function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[._\-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2 && !QUERY_STOPWORDS.has(t));
}

/**
 * Whether a result title is relevant to the query: every significant query
 * token must appear in the title. Torznab `t=search` matching is loose on some
 * indexers (returning near-misses or recent items), so we AND-filter ourselves.
 */
function matchesQuery(title: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const t = title.toLowerCase().replace(/[._\-]+/g, " ");
  return tokens.every((tok) => t.includes(tok));
}

interface EpisodeSpec {
  season: number;
  epStart?: number; // undefined = season-only (e.g. "S01")
  epEnd?: number; // inclusive end for ranges; defaults to epStart
}

/** Parse a season/episode spec (SxxExx, Sxx, or NxNN) from a string, if present. */
function parseEpisodeSpec(s: string): EpisodeSpec | null {
  const t = s.replace(/[._]+/g, " ");
  // SxxExx (+ optional range): S03E02, S3E2, S03E02E03, S03E01-E03
  let m = t.match(/\bs(\d{1,3})\s?e(\d{1,4})(?:\s?-?\s?e(\d{1,4}))?\b/i);
  if (m) return { season: +m[1], epStart: +m[2], epEnd: m[3] ? +m[3] : +m[2] };
  // NxNN (+ optional range): 3x02, 03x02, 3x02-03
  m = t.match(/\b(\d{1,3})x(\d{1,4})(?:\s?-\s?(\d{1,4}))?\b/i);
  if (m) return { season: +m[1], epStart: +m[2], epEnd: m[3] ? +m[3] : +m[2] };
  // Season only: Sxx
  m = t.match(/\bs(\d{1,3})\b/i);
  if (m) return { season: +m[1] };
  return null;
}

/** A query token encoding a season/episode (matched numerically, not by name). */
function isSpecToken(tok: string): boolean {
  return /^s\d{1,3}(e\d{1,4})*$/i.test(tok) || /^\d{1,3}x\d{1,4}$/i.test(tok);
}

/** Whether a result title satisfies the query's season/episode spec. */
function matchesEpisode(title: string, q: EpisodeSpec): boolean {
  const t = parseEpisodeSpec(title);
  if (!t || t.season !== q.season) return false;
  if (q.epStart === undefined) return true; // season-only query: any episode or the season pack
  if (t.epStart === undefined) return false; // episode query: exclude whole-season packs
  const end = t.epEnd ?? t.epStart;
  return q.epStart >= t.epStart && q.epStart <= end;
}

/** Map a Torznab RSS feed into our SearchResult shape. */
function parseTorznab(xmlText: string): SearchResult[] {
  let doc: unknown;
  try {
    doc = xml.parse(xmlText);
  } catch {
    return [];
  }
  const channel = (doc as { rss?: { channel?: { item?: unknown } } }).rss?.channel;
  if (!channel) return [];
  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  const out: SearchResult[] = [];
  for (const raw of items as Array<Record<string, unknown>>) {
    const attrs = raw["torznab:attr"];
    const attrList = Array.isArray(attrs) ? attrs : attrs ? [attrs] : [];
    const attr = (name: string): string | undefined => {
      const found = (attrList as Array<Record<string, string>>).find((a) => a["@_name"] === name);
      return found?.["@_value"];
    };
    const enclosure = raw.enclosure as { "@_url"?: string; "@_length"?: string } | undefined;
    const indexerTag = raw.jackettindexer as { "#text"?: string; "@_id"?: string } | string | undefined;
    const indexerName =
      typeof indexerTag === "string" ? indexerTag : (indexerTag?.["#text"] ?? "Jackett");
    const link = attr("magneturl") || enclosure?.["@_url"] || String(raw.link ?? "");
    if (!link) continue;
    const title = String(raw.title ?? "Untitled");
    out.push({
      id: String(raw.guid ?? link),
      title,
      link,
      indexer: indexerName,
      source: "jackett",
      seeders: attr("seeders") ?? "0",
      peers: attr("peers") ?? attr("leechers") ?? "0",
      size: attr("size") ?? enclosure?.["@_length"] ?? String(raw.size ?? 0),
      uploadedAt: raw.pubDate ? String(raw.pubDate) : undefined,
      releaseInfo: parseReleaseInfo(title),
    });
  }
  return out;
}

export const jackettService = {
  isInstalled(): boolean {
    return fs.existsSync(exePath());
  },

  /** Spawn the Jackett server (idempotent) and wait until its API responds. */
  async start(): Promise<void> {
    if (proc) return;
    if (startPromise) return startPromise;
    if (!jackettService.isInstalled()) {
      throw new Error("Jackett isn't bundled in this build.");
    }
    startPromise = (async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      logger.info("jackett", "starting sidecar", { exe: exePath(), data: DATA_DIR });
      const p = spawn(exePath(), ["--NoUpdates", "--Port", String(PORT), "--DataFolder", DATA_DIR], {
        stdio: "ignore",
      });
      proc = p;
      p.on("exit", (code) => {
        logger.info("jackett", "sidecar exited", { code });
        proc = null;
        startPromise = null;
      });
      await waitForReady();
      await login();
      await jackettService.ensureDefaults().catch((e) =>
        logger.error("jackett", "ensureDefaults failed", e as Error),
      );
    })();
    return startPromise;
  },

  stop(): void {
    if (proc) {
      try {
        proc.kill();
      } catch {
        // already gone
      }
      proc = null;
      startPromise = null;
    }
  },

  async status(): Promise<{ installed: boolean; running: boolean }> {
    return { installed: jackettService.isInstalled(), running: !!proc };
  },

  /** Configure any default indexers that aren't set up yet (first-run only work). */
  async ensureDefaults(): Promise<void> {
    const configured = new Set((await jackettService.listIndexers()).map((i) => i.id));
    const missing = DEFAULT_INDEXERS.filter((id) => !configured.has(id));
    for (const id of missing) {
      try {
        const g = await fetch(`${BASE}/api/v2.0/indexers/${id}/config`, { headers: adminHeaders() });
        if (!g.ok) continue;
        const cfg = await g.text();
        await fetch(`${BASE}/api/v2.0/indexers/${id}/config`, {
          method: "POST",
          headers: adminHeaders({ "Content-Type": "application/json" }),
          body: cfg,
        });
      } catch {
        // skip indexers that fail to configure
      }
    }
  },

  /** Configured indexers Jackett currently has. */
  async listIndexers(): Promise<{ id: string; name: string }[]> {
    try {
      const url = `${BASE}/api/v2.0/indexers?configured=true`;
      let res = await fetch(url, { headers: adminHeaders(), redirect: "manual" });
      if (res.status === 302) {
        await login(); // cookie expired/missing — re-auth once
        res = await fetch(url, { headers: adminHeaders(), redirect: "manual" });
      }
      if (res.status !== 200) return [];
      const data = (await res.json()) as Array<{ id?: string; name?: string; configured?: boolean }>;
      return data
        .filter((i) => i.id && i.configured !== false)
        .map((i) => ({ id: String(i.id), name: String(i.name ?? i.id) }));
    } catch {
      return [];
    }
  },

  getSelectedIndexers(): string[] {
    return readSelection();
  },

  setSelectedIndexers(ids: string[]): void {
    try {
      fs.writeFileSync(SELECTION_PATH, JSON.stringify({ selected: ids }));
    } catch (err) {
      logger.error("jackett", "failed to persist indexer selection", err as Error);
    }
  },

  /** The local Jackett web UI URL (for advanced indexer management). */
  webUrl(): string {
    return `${BASE}/UI/Dashboard`;
  },

  /**
   * Resolve a Jackett download link into something put.io can actually ingest.
   *
   * Indexers that don't expose a magnet leave us with Jackett's local `/dl/`
   * proxy URL (http://127.0.0.1:9117/dl/…). put.io's servers can't reach our
   * machine, so handing them that URL produces a dead transfer. We *can* reach
   * localhost, so we follow the proxy here: a redirect yields a magnet/public
   * URL, while a 2xx bittorrent body (typical of private trackers) yields the
   * .torrent bytes for us to upload. Magnets and non-proxy URLs pass through.
   */
  async resolveDownload(url: string, depth = 0): Promise<ResolvedDownload> {
    if (url.startsWith("magnet:")) return { kind: "url", url };
    if (!url.startsWith(`${BASE}/dl`) || depth > 5) return { kind: "url", url };

    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      // Network hiccup — fall back to the original URL as a best effort.
      logger.info("jackett", "resolveDownload fetch failed", { error: (err as Error).message });
      return { kind: "url", url };
    }

    const loc = res.headers.get("location");
    if (loc && res.status >= 300 && res.status < 400) {
      if (loc.startsWith("magnet:")) return { kind: "url", url: loc };
      // Another Jackett hop → keep following; otherwise it's a public URL.
      return loc.startsWith(BASE)
        ? jackettService.resolveDownload(loc, depth + 1)
        : { kind: "url", url: loc };
    }
    if (res.ok) {
      const data = new Uint8Array(await res.arrayBuffer());
      // Bencoded torrents start with a dictionary: the byte 'd' (0x64).
      if (data[0] !== 0x64) throw new Error("Jackett returned a non-torrent response for this result.");
      return { kind: "torrent", data, filename: torrentFilename(url) };
    }
    throw new Error(`Jackett couldn't fetch this torrent (HTTP ${res.status}).`);
  },

  async search(query: string): Promise<SearchResult[]> {
    await jackettService.start();
    const key = readApiKey();
    if (!key) throw new Error("Jackett isn't ready yet — try again in a moment.");
    const selected = readSelection();
    const ids = selected.length ? selected : ["all"];
    const results: SearchResult[] = [];
    // Query indexers in parallel; a slow/failing one can't stall the rest.
    await Promise.all(
      ids.map(async (id) => {
        try {
          const url = `${BASE}/api/v2.0/indexers/${id}/results/torznab/api?apikey=${key}&t=search&q=${encodeURIComponent(query)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) {
            logger.info("jackett", "indexer search non-200", { id, status: res.status });
            return;
          }
          const parsed = parseTorznab(await res.text());
          logger.info("jackett", "indexer results", { id, count: parsed.length });
          results.push(...parsed);
        } catch (err) {
          logger.info("jackett", "indexer search failed", { id, error: (err as Error).message });
        }
      }),
    );
    // De-dupe by magnet/link.
    const seen = new Set<string>();
    const deduped = results.filter((r) => (seen.has(r.link) ? false : (seen.add(r.link), true)));
    // Relevance filter: every show-name term must appear in the title, and if
    // the query carries a season/episode spec, the title must match it too.
    const spec = parseEpisodeSpec(query);
    const nameTokens = queryTokens(query).filter((tok) => !isSpecToken(tok));
    const relevant = deduped.filter(
      (r) => matchesQuery(r.title, nameTokens) && (!spec || matchesEpisode(r.title, spec)),
    );
    logger.info("jackett", "search results", {
      query,
      raw: deduped.length,
      relevant: relevant.length,
      spec: spec ?? undefined,
    });
    return relevant;
  },
};
