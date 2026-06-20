import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { app } from "electron";

const currentDirPath = path.dirname(fileURLToPath(import.meta.url));
const BUILD_ROOT = path.resolve(currentDirPath, "..");

const DEV_SERVER = "http://localhost:5173";

export function getBuildRoot(): string {
  return BUILD_ROOT;
}

export function getPreloadPath(): string {
  return path.join(BUILD_ROOT, "preload.cjs");
}

export async function getWindowUrl(htmlFileName: string): Promise<string> {
  if (!app.isPackaged && process.env.OCTOPUT_DEV_SERVER === "1") {
    return `${DEV_SERVER}/${htmlFileName}`;
  }
  return pathToFileURL(path.join(BUILD_ROOT, "renderer", htmlFileName)).toString();
}
