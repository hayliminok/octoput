/**
 * Torrent search sources.
 *
 * A "source" is a pluggable search provider. Today there's one (bundled Jackett),
 * but the registry + active-source selection make it easy to add others later —
 * the renderer talks to sources generically (sources:list/status/connect/search),
 * never to a specific provider. Adding a transfer is always put.io and is not a
 * source concern; a source only turns a query into results with magnet links.
 */

import * as fs from "fs";
import * as path from "path";

import { app, logger } from "../platform/backend.js";
import { jackettService } from "./jackett.js";
import type { SearchResult } from "./search-types.js";

export interface SourceInfo {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

interface TorrentSource {
  id: string;
  name: string;
  description: string;
  status(): Promise<{ connected: boolean; username?: string }>;
  beginConnect(): Promise<{ url?: string; alreadyConnected?: boolean }>;
  cancelConnect(): void;
  disconnect(): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
}

// ── Providers ─────────────────────────────────────────────────────────
// Bundled Jackett — a local multi-indexer Torznab server.
const jackett: TorrentSource = {
  id: "jackett",
  name: "Jackett",
  description: "Search many torrent indexers via the bundled Jackett server.",
  async status() {
    // "Connected" = bundled & available; the sidecar starts lazily on first search.
    const s = await jackettService.status();
    return { connected: s.installed };
  },
  async beginConnect() {
    await jackettService.start(); // throws if the binary isn't bundled
    return { alreadyConnected: true };
  },
  cancelConnect() {},
  async disconnect() {
    jackettService.stop();
  },
  search(query) {
    return jackettService.search(query);
  },
};

const REGISTRY: TorrentSource[] = [jackett];

// ── Active-source persistence (userData/octoput-sources.json) ─────────
const CONFIG_PATH = path.join(app.getPath("userData"), "octoput-sources.json");

function readActiveId(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as { active?: string };
    if (typeof cfg.active === "string" && REGISTRY.some((s) => s.id === cfg.active)) {
      return cfg.active;
    }
  } catch {
    // no/invalid config — fall back to the first provider
  }
  return REGISTRY[0].id;
}

function writeActiveId(id: string): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ active: id }));
  } catch (err) {
    logger.error("sources", "failed to persist active source", err as Error);
  }
}

function find(id: string): TorrentSource {
  const s = REGISTRY.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown search source: ${id}`);
  return s;
}

export const sourcesService = {
  list(): SourceInfo[] {
    const active = readActiveId();
    return REGISTRY.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      active: s.id === active,
    }));
  },
  setActive(id: string): void {
    if (REGISTRY.some((s) => s.id === id)) writeActiveId(id);
  },
  getActive(): TorrentSource {
    return REGISTRY.find((s) => s.id === readActiveId()) ?? REGISTRY[0];
  },
  status(id: string) {
    return find(id).status();
  },
  beginConnect(id: string) {
    return find(id).beginConnect();
  },
  cancelConnect(id: string): void {
    REGISTRY.find((s) => s.id === id)?.cancelConnect();
  },
  disconnect(id: string) {
    return find(id).disconnect();
  },
  async search(query: string): Promise<{ results: SearchResult[] }> {
    return { results: await sourcesService.getActive().search(query) };
  },
};
