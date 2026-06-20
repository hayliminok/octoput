/**
 * VLC integration
 *
 * We can't embed VLC's renderer in a WKWebView app, but we can hand the put.io
 * stream URL to the VLC desktop app, which streams any container/codec over
 * HTTP. VLC is installed on demand via Homebrew cask.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { logger } from "../platform/backend.js";

import { putioService } from "./putio.js";

const execFileAsync = promisify(execFile);
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };

async function vlcInstalled(): Promise<boolean> {
  const candidates = ["/Applications/VLC.app", path.join(os.homedir(), "Applications", "VLC.app")];
  if (candidates.some((p) => fs.existsSync(p))) return true;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/mdfind",
      ["kMDItemCFBundleIdentifier == 'org.videolan.VLC'"],
      { timeout: 8_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const vlcService = {
  async status(): Promise<{ installed: boolean }> {
    return { installed: await vlcInstalled() };
  },

  /** Install VLC via Homebrew cask (first-time, can take a while). */
  async install(): Promise<{ installed: boolean }> {
    logger.info("vlc", "installing VLC via Homebrew cask");
    await execFileAsync("brew", ["install", "--cask", "vlc"], {
      env: ENV,
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const installed = await vlcInstalled();
    logger.info("vlc", "install complete", { installed });
    return { installed };
  },

  /** Open a put.io file's stream URL in the VLC app. */
  async openFile(fileId: number): Promise<void> {
    if (!(await vlcInstalled())) {
      throw new Error("VLC is not installed.");
    }
    const { fallback } = await putioService.streamUrl(fileId);
    logger.info("vlc", "opening file in VLC", { fileId });
    await execFileAsync("open", ["-a", "VLC", fallback], { env: ENV });
  },
};
