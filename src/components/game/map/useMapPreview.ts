import { useEffect, useState, type RefObject } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { currentWindowLabel } from "../../../utils/windowLabel";

const MAP_WEBVIEW_PREFIX = "mapgenie-preview-";

/** Tear down every map webview, tolerating ones already gone. */
export async function closeMapWebviews(): Promise<void> {
  try {
    const all = await Webview.getAll();
    for (const wv of all) {
      if (wv.label.startsWith(MAP_WEBVIEW_PREFIX)) {
        await invoke("close_preview_webview", { label: wv.label }).catch(() => {});
        await wv.close().catch(() => {});
      }
    }
  } catch {
    // Not running under Tauri (frontend-only dev) — nothing to close.
  }
}

interface MapPreviewOptions {
  /** Map URL, or null on the launchpad. */
  url: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  expandedFrameRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  /** The native webview composites above the DOM; hide it behind modals. */
  visible: boolean;
  reloadNonce: number;
  contentFilterEnabled: boolean;
}

/**
 * Owns the native child webview behind the Map tab.
 *
 * The map itself is a full page served by an external provider, so it rides
 * the same native preview pipeline as the Web Links browser. This hook keeps
 * three things in sync that are easy to get wrong: the DOM frame the view
 * tracks, visibility while a DOM modal sits above it, and teardown on URL
 * change / unmount.
 */
export function useMapPreview({
  url,
  containerRef,
  expandedFrameRef,
  expanded,
  visible,
  reloadNonce,
  contentFilterEnabled,
}: MapPreviewOptions) {
  const [webview, setWebview] = useState<Webview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // (Re)create the native webview whenever the selected URL changes.
  useEffect(() => {
    let active = true;
    let local: Webview | null = null;

    if (!url) {
      setStatus("loading");
      setWebview(null);
      return;
    }

    setStatus("loading");

    async function init() {
      await closeMapWebviews();
      if (!active || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const label = MAP_WEBVIEW_PREFIX + Math.random().toString(36).slice(2, 9);

      try {
        await invoke("create_preview_webview", {
          label,
          url,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          contentFilter: contentFilterEnabled,
          window: currentWindowLabel(),
        });
        const created = await Webview.getByLabel(label);
        if (!created) throw new Error("map webview was not created");

        if (!active) {
          invoke("close_preview_webview", { label }).catch(() => {});
          created.close().catch(() => {});
          return;
        }

        local = created;
        setWebview(created);
        setStatus("ready");
      } catch (err) {
        console.error("Failed to create map webview:", err);
        if (active) setStatus("error");
      }
    }

    init();

    return () => {
      active = false;
      setWebview(null);
      if (local) {
        invoke("close_preview_webview", { label: local.label }).catch(() => {});
        local.close().catch(() => {});
      } else {
        closeMapWebviews();
      }
    };
  }, [url, contentFilterEnabled, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the native view glued to the DOM frame as the page scrolls/resizes.
  useEffect(() => {
    const frame =
      expanded && expandedFrameRef.current
        ? expandedFrameRef.current
        : containerRef.current;
    if (!frame || !webview) return;

    const sync = () => {
      const rect = frame.getBoundingClientRect();
      webview.setPosition(new LogicalPosition(rect.left, rect.top)).catch(() => {});
      webview.setSize(new LogicalSize(rect.width, rect.height)).catch(() => {});
      invoke("reposition_preview_webview", {
        label: webview.label,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [webview, expanded, containerRef, expandedFrameRef]);

  // Native webviews composite above the DOM, so hide while a modal is open.
  useEffect(() => {
    if (!webview) return;
    invoke("set_preview_webview_visible", {
      label: webview.label,
      visible,
    }).catch(() => {});
    (visible ? webview.show() : webview.hide()).catch(() => {});
  }, [webview, visible]);

  return { webview, status };
}
