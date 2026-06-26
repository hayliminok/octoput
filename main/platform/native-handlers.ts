import { shell, nativeTheme } from "electron";
import { ipcMain } from "./backend.js";

export function registerNativeHandlers(): void {
  // Octoput is dark-only: force the native appearance to dark so the window's
  // vibrancy material, traffic lights, and any native controls render dark
  // regardless of the OS setting.
  nativeTheme.themeSource = "dark";

  ipcMain.handle("shell:openExternal", async (_e, url: string) => {
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("nativeTheme:getInfo", async () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
  }));
  ipcMain.handle("nativeTheme:setThemeSource", async (_e, source: "system" | "light" | "dark") => {
    nativeTheme.themeSource = source;
    return true;
  });
  ipcMain.handle("nativeTheme:getShouldUseDarkColors", async () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle("nativeTheme:getThemeSource", async () => nativeTheme.themeSource);
  nativeTheme.on("updated", () => {
    ipcMain.broadcast("nativeTheme:updated", {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      themeSource: nativeTheme.themeSource,
    });
  });
}
