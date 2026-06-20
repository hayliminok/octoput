/**
 * Shared torrent-search result shapes.
 *
 * Source-agnostic types produced by search providers (Jackett today) and
 * consumed by the sources registry and the renderer. Kept in their own module
 * so providers don't depend on each other.
 */

export interface ReleaseInfo {
  title?: string;
  year?: number;
  resolution?: string;
  quality?: string;
  codec?: string;
  audio?: string;
  bitDepth?: string;
  part?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  link: string; // magnet URL or torrent link
  indexer: string;
  source: string;
  seeders: string;
  peers: string;
  size: string; // bytes, as string
  uploadedAt?: string;
  releaseInfo?: ReleaseInfo;
}
