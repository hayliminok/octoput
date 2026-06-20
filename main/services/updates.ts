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
