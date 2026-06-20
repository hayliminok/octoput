import * as path from "path";
import * as fs from "fs";
import { app } from "electron";

const PLATFORM_DIR = `${process.platform}-${process.arch}`;

/** Absolute path to a bundled CLI binary, falling back to PATH lookup by name. */
export function resolveCli(name: "putio"): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "bin", PLATFORM_DIR)
    : path.join(app.getAppPath(), "resources", "bin", PLATFORM_DIR);
  const bundled = path.join(base, name + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(bundled)) return bundled;
  return name; // fall back to PATH (dev machines with brew install)
}
