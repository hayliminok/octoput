/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { appHandlers } from "./app.js";
import { authService } from "../services/auth.js";
import { putioService } from "../services/putio.js";
import { sourcesService } from "../services/sources.js";
import { jackettService } from "../services/jackett.js";
import { transcodeService } from "../services/transcode.js";
import { updatesService } from "../services/updates.js";
import { vlcService } from "../services/vlc.js";

import { ipcMain, logger } from "../platform/backend.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerHandlers(): void {
  logger.info("handlers", "Registering IPC handlers...");

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Return the .glaze project path (used for deep links back to the host)
  // __dirname = build/main, so two levels up is the app root
  ipcMain.handle("app:getProjectPath", async () => {
    return path.join(__dirname, "..", "..");
  });

  // ── Auth / onboarding handlers ──────────────────────────────────────
  ipcMain.handle("auth:status", async () => {
    return await authService.status();
  });

  ipcMain.handle("auth:beginLink", async () => {
    return await authService.beginLink();
  });

  ipcMain.handle("auth:cancelLink", async () => {
    authService.cancelLink();
  });

  ipcMain.handle("auth:logout", async () => {
    await authService.logout();
    // Tell all windows to re-check auth so the app re-gates to the Connect screen.
    ipcMain.broadcast("auth:changed", {});
  });

  // ── put.io (file browsing + streaming) handlers ─────────────────────
  ipcMain.handle("putio:authStatus", async () => {
    return await putioService.authStatus();
  });

  ipcMain.handle("putio:listFiles", async (_event, params: unknown) => {
    const parentId =
      typeof params === "object" && params !== null
        ? (params as { parentId?: unknown }).parentId
        : undefined;
    return await putioService.listFiles(typeof parentId === "number" ? parentId : 0);
  });

  ipcMain.handle("putio:search", async (_event, params: unknown) => {
    const query =
      typeof params === "object" && params !== null
        ? (params as { query?: unknown }).query
        : undefined;
    if (typeof query !== "string") {
      throw new Error("search requires a string query");
    }
    return { files: await putioService.search(query) };
  });

  // ── In-app transcoding (ffmpeg → HLS) ───────────────────────────────
  ipcMain.handle("transcode:ffmpegStatus", async () => {
    return await transcodeService.ffmpegStatus();
  });

  ipcMain.handle("transcode:installFfmpeg", async () => {
    return await transcodeService.installFfmpeg();
  });

  ipcMain.handle("transcode:start", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("transcode:start requires a numeric fileId");
    }
    return await transcodeService.start(fileId);
  });

  ipcMain.handle("transcode:setAudioTrack", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      sessionId?: unknown;
      index?: unknown;
    };
    if (typeof p.sessionId !== "string" || typeof p.index !== "number") {
      throw new Error("transcode:setAudioTrack requires sessionId (string) and index (number)");
    }
    await transcodeService.setAudioTrack(p.sessionId, p.index);
    return { ok: true };
  });

  ipcMain.handle("transcode:stop", async (_event, params: unknown) => {
    const sessionId =
      typeof params === "object" && params !== null
        ? (params as { sessionId?: unknown }).sessionId
        : undefined;
    if (typeof sessionId === "string") {
      await transcodeService.stop(sessionId);
    }
  });

  // ── App updates (notify-only) ─────────────────────────────────────────
  ipcMain.handle("updates:check", async () => updatesService.check());

  // ── VLC (universal external playback) ───────────────────────────────
  ipcMain.handle("vlc:status", async () => {
    return await vlcService.status();
  });

  ipcMain.handle("vlc:install", async () => {
    return await vlcService.install();
  });

  ipcMain.handle("vlc:openFile", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("vlc:openFile requires a numeric fileId");
    }
    await vlcService.openFile(fileId);
  });

  ipcMain.handle("putio:move", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      fileId?: unknown;
      parentId?: unknown;
    };
    if (typeof p.fileId !== "number" || typeof p.parentId !== "number") {
      throw new Error("putio:move requires fileId and parentId numbers");
    }
    await putioService.move(p.fileId, p.parentId);
  });

  ipcMain.handle("putio:delete", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("putio:delete requires a numeric fileId");
    }
    await putioService.remove(fileId);
  });

  ipcMain.handle("putio:subtitles", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("putio:subtitles requires a numeric fileId");
    }
    return { subtitles: await putioService.listSubtitles(fileId) };
  });

  ipcMain.handle("putio:subtitleVtt", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      fileId?: unknown;
      key?: unknown;
    };
    if (typeof p.fileId !== "number" || typeof p.key !== "string") {
      throw new Error("putio:subtitleVtt requires fileId (number) and key (string)");
    }
    return { vtt: await putioService.subtitleVtt(p.fileId, p.key) };
  });

  ipcMain.handle("putio:streamUrl", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("streamUrl requires a numeric fileId");
    }
    return await putioService.streamUrl(fileId);
  });

  ipcMain.handle("putio:defaultFolder", async () => {
    return await putioService.defaultFolder();
  });

  // ── Transfers ───────────────────────────────────────────────────────
  ipcMain.handle("putio:listTransfers", async () => {
    return { transfers: await putioService.listTransfers() };
  });

  ipcMain.handle("putio:cancelTransfer", async (_event, params: unknown) => {
    const id =
      typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id !== "number") throw new Error("putio:cancelTransfer requires a numeric id");
    await putioService.cancelTransfer(id);
    return { ok: true };
  });

  ipcMain.handle("putio:cleanTransfers", async () => {
    await putioService.cleanTransfers();
    return { ok: true };
  });

  ipcMain.handle("putio:addTransfer", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      url?: unknown;
      saveParentId?: unknown;
    };
    if (typeof p.url !== "string" || !p.url.trim()) {
      throw new Error("putio:addTransfer requires a url");
    }
    const parentId = typeof p.saveParentId === "number" ? p.saveParentId : undefined;
    // Jackett proxy links point at our localhost: resolve to either a magnet/
    // public URL put.io can reach, or raw .torrent bytes we upload directly.
    const resolved = await jackettService.resolveDownload(p.url.trim());
    if (resolved.kind === "torrent") {
      await putioService.uploadTorrent(resolved.data, resolved.filename, parentId);
    } else {
      await putioService.addTransfer(resolved.url, parentId);
    }
    return { ok: true };
  });

  ipcMain.handle("putio:uploadTorrent", async (_event, params: unknown) => {
    const p = (typeof params === "object" && params !== null ? params : {}) as {
      dataBase64?: unknown;
      filename?: unknown;
      saveParentId?: unknown;
    };
    if (typeof p.dataBase64 !== "string" || !p.dataBase64) {
      throw new Error("putio:uploadTorrent requires base64 file data");
    }
    const data = new Uint8Array(Buffer.from(p.dataBase64, "base64"));
    const filename =
      typeof p.filename === "string" && p.filename.trim() ? p.filename.trim() : "upload.torrent";
    await putioService.uploadTorrent(
      data,
      filename,
      typeof p.saveParentId === "number" ? p.saveParentId : undefined,
    );
    return { ok: true };
  });

  // ── Torrent search sources (pluggable providers; Jackett is the default) ──
  ipcMain.handle("sources:list", async () => sourcesService.list());

  ipcMain.handle("sources:setActive", async (_event, params: unknown) => {
    const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id !== "string") throw new Error("sources:setActive requires an id");
    sourcesService.setActive(id);
    return { ok: true };
  });

  ipcMain.handle("sources:status", async (_event, params: unknown) => {
    const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id !== "string") throw new Error("sources:status requires an id");
    return await sourcesService.status(id);
  });

  ipcMain.handle("sources:beginConnect", async (_event, params: unknown) => {
    const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id !== "string") throw new Error("sources:beginConnect requires an id");
    return await sourcesService.beginConnect(id);
  });

  ipcMain.handle("sources:cancelConnect", async (_event, params: unknown) => {
    const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id === "string") sourcesService.cancelConnect(id);
  });

  ipcMain.handle("sources:disconnect", async (_event, params: unknown) => {
    const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
    if (typeof id !== "string") throw new Error("sources:disconnect requires an id");
    await sourcesService.disconnect(id);
    return { ok: true };
  });

  ipcMain.handle("sources:search", async (_event, params: unknown) => {
    const query =
      typeof params === "object" && params !== null ? (params as { query?: unknown }).query : undefined;
    if (typeof query !== "string") throw new Error("sources:search requires a query");
    return await sourcesService.search(query);
  });

  // ── Jackett indexer management ────────────────────────────────────────
  ipcMain.handle("jackett:start", async () => {
    await jackettService.start();
    return { ok: true };
  });

  ipcMain.handle("jackett:status", async () => jackettService.status());

  ipcMain.handle("jackett:indexers", async () => {
    await jackettService.start().catch(() => {});
    return { indexers: await jackettService.listIndexers() };
  });

  ipcMain.handle("jackett:selectedIndexers", async () => {
    return { selected: jackettService.getSelectedIndexers() };
  });

  ipcMain.handle("jackett:setSelectedIndexers", async (_event, params: unknown) => {
    const ids =
      typeof params === "object" && params !== null ? (params as { ids?: unknown }).ids : undefined;
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) {
      throw new Error("jackett:setSelectedIndexers requires a string[] of ids");
    }
    jackettService.setSelectedIndexers(ids as string[]);
    return { ok: true };
  });

  ipcMain.handle("jackett:webUrl", async () => ({ url: jackettService.webUrl() }));

  ipcMain.handle("putio:fileText", async (_event, params: unknown) => {
    const fileId =
      typeof params === "object" && params !== null
        ? (params as { fileId?: unknown }).fileId
        : undefined;
    if (typeof fileId !== "number") {
      throw new Error("putio:fileText requires a numeric fileId");
    }
    return { text: await putioService.fileText(fileId) };
  });

  logger.info("handlers", "✓ IPC handlers registered");

  // TODO: Add more handlers here using ipcMain.handle()
  // Example:
  // ipcMain.handle('file:read', async (event, path) => {
  //   const fs = await import('fs/promises');
  //   return await fs.readFile(path, 'utf-8');
  // });
}
