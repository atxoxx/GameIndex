import { useCallback } from "react";

/**
 * Hook for cover images rendered in long lists (store grid, game relations).
 * Returns a tuple of `[loadedUrl, refCallback]`:
 * - `loadedUrl` is the source URL itself — images load straight from the
 *   remote URL and the browser's HTTP cache serves repeat visits.
 * - `refCallback` attaches the element and marks it `decoding = "async"` so
 *   WebKitGTK / WebView2 rasterize the bitmap off the main thread — a fast
 *   scroll through many covers never janks on synchronous image decode.
 *
 * Historical note: this hook used to invoke `download_image` (Rust) for every
 * element that entered the viewport, but the returned base64 data URL was
 * always discarded — `loadedUrl` stayed the remote URL. Each call was a full
 * network fetch + base64 encode + IPC round-trip per card for nothing, and a
 * fast scroll through a store grid fired dozens of them at once. The observer
 * and invoke are gone; the decode hint is the only real work the hook does.
 */
export function useProgressiveImage(
  url: string | null
): [string | null, (node: HTMLElement | null) => void] {
  const refCallback = useCallback((node: HTMLElement | null) => {
    if (node instanceof HTMLImageElement) {
      node.decoding = "async";
    }
  }, []);

  return [url, refCallback];
}
