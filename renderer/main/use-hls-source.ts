import Hls from "hls.js";
import * as React from "react";

/**
 * Attaches an HLS source to a <video> element using hls.js.
 *
 * - In browsers with native HLS support (Safari / WKWebView) the src is set
 *   directly — hls.js is not needed there.
 * - In Chromium (Electron) hls.js takes over: it fetches the segments itself
 *   and feeds them to the MediaSource API.
 * - If `src` is null/undefined the effect is a no-op.
 */
export function useHlsSource(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string | null | undefined,
) {
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Native HLS (Safari / WKWebView) — harmless fallback; Chromium uses hls.js.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
  }, [videoRef, src]);
}
