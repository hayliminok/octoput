import {
  app,
  BrowserWindow as ElectronBrowserWindow,
  Menu,
  ipcMain as electronIpcMain,
  protocol,
} from "electron";
import type { BrowserWindowConstructorOptions } from "electron";

export { app, Menu, protocol };

type GlazeWindowOptions = BrowserWindowConstructorOptions & { windowKey?: string };

export class BrowserWindow extends ElectronBrowserWindow {
  constructor(opts: GlazeWindowOptions = {}) {
    const { windowKey: _ignored, webPreferences, ...rest } = opts;
    super({
      ...rest,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        plugins: true, // Chromium's built-in PDF viewer, for in-app PDF preview
        ...webPreferences,
      },
    });
  }
}

export const logger = {
  info: (scope: string, msg: string, meta?: unknown) =>
    console.log(`[${scope}] ${msg}`, meta ?? ""),
  debug: (scope: string, msg: string, meta?: unknown) =>
    console.debug(`[${scope}] ${msg}`, meta ?? ""),
  warn: (scope: string, msg: string, meta?: unknown) =>
    console.warn(`[${scope}] ${msg}`, meta ?? ""),
  error: (scope: string, msg: string, err?: unknown) =>
    console.error(`[${scope}] ${msg}`, err ?? ""),
};

export const ipcMain = Object.assign(electronIpcMain, {
  broadcast(channel: string, payload: unknown): void {
    for (const win of ElectronBrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  },
});

export async function initDevToolsButtonState(): Promise<void> {
  /* no-op */
}
