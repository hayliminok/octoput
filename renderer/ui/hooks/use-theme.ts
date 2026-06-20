import { useEffect, useState } from "react";
import type { NativeThemeInfo } from "@platform/ipc-types";

/**
 * Reflect the OS/app theme onto `<html class="dark">` and react to changes
 * broadcast from the main process.
 */
export function useTheme() {
  const [info, setInfo] = useState<NativeThemeInfo | null>(null);

  useEffect(() => {
    window.glazeAPI.nativeTheme.getInfo().then(setInfo).catch(() => {});
    return window.glazeAPI.glaze.ipc.onNotification("nativeTheme:updated", (p) =>
      setInfo(p as NativeThemeInfo),
    );
  }, []);

  useEffect(() => {
    if (info) document.documentElement.classList.toggle("dark", info.shouldUseDarkColors);
  }, [info]);

  return {
    theme: (info?.shouldUseDarkColors ? "dark" : "light") as "dark" | "light",
    themeSource: info?.themeSource ?? "system",
    setThemeSource: (s: "system" | "light" | "dark") =>
      window.glazeAPI.nativeTheme.setThemeSource(s),
  };
}
