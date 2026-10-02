import { useCallback, useEffect, useRef, useState } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useWebviewContentFilterEnabled } from "../../context/SettingsContext";
import { IconExternalLink } from "./icons";
import type { MapSourceResult } from "../../types/game";

const MAP_WEBVIEW_PREFIX = "mapgenie-preview-";

/** Tear down every map webview, tolerating ones already gone. */
async function closeMapWebviews() {
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

interface MapTabProps {
  sources: MapSourceResult[];
  /** Hide the native webview while a DOM modal sits above it. */
  visible?: boolean;
}

/**
 * Interactive map tab backed by one or more external providers
 * (MapGenie, GameMaps, GameMappers, Wand, Game-Maps).
 *
 * Pages are served through the same native child-webview pipeline the
 * WebLinks preview uses (`create_preview_webview`), so they are fully
 * interactive and sidestep iframe/framing restrictions. The DOM only
 * owns the toolbars and the frame placeholder the native view tracks.
 */
export default function MapTab({ sources, visible = true }: MapTabProps) {
  const { t } = useLanguage();
  const contentFilterEnabled = useWebviewContentFilterEnabled();
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeMapUrl, setActiveMapUrl] = useState<string | null>(null);
  const [webviewInst, setWebviewInst] = useState<Webview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const activeSource =
    sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null;

  // Prefer an explicitly chosen map, but fall back to the provider's
  // preferred URL when the source (and therefore map list) changes.
  const activeUrl =
    activeMapUrl && activeSource?.maps.some((m) => m.url === activeMapUrl)
      ? activeMapUrl
      : activeSource?.url ?? "";

  const sourceSignature = sources.map((s) => s.id).join("|");
  useEffect(() => {
    setActiveSourceId(null);
    setActiveMapUrl(null);
  }, [sourceSignature]);

  const openExternal = useCallback(() => {
    if (!activeUrl) return;
    openUrl(activeUrl).catch(() => {
      window.open(activeUrl, "_blank", "noopener,noreferrer");
    });
  }, [activeUrl]);

  // Keep the native view glued to the DOM frame as the page scrolls/resizes.
  useEffect(() => {
    const frame = containerRef.current;
    if (!frame || !webviewInst) return;

    const sync = () => {
      const rect = frame.getBoundingClientRect();
      webviewInst
        .setPosition(new LogicalPosition(rect.left, rect.top))
        .catch(() => {});
      webviewInst
        .setSize(new LogicalSize(rect.width, rect.height))
        .catch(() => {});
      invoke("reposition_preview_webview", {
        label: webviewInst.label,
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
  }, [webviewInst]);

  // Native webviews composite above the DOM, so hide it while a modal is open.
  useEffect(() => {
    if (!webviewInst) return;
    invoke("set_preview_webview_visible", {
      label: webviewInst.label,
      visible,
    }).catch(() => {});
    (visible ? webviewInst.show() : webviewInst.hide()).catch(() => {});
  }, [webviewInst, visible]);

  // (Re)create the native webview whenever the selected URL changes.
  useEffect(() => {
    let active = true;
    let local: Webview | null = null;

    if (!activeUrl) {
      setStatus("loading");
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
          url: activeUrl,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          contentFilter: contentFilterEnabled,
        });
        const webview = await Webview.getByLabel(label);
        if (!webview) throw new Error("map webview was not created");

        if (!active) {
          invoke("close_preview_webview", { label }).catch(() => {});
          webview.close().catch(() => {});
          return;
        }

        local = webview;
        setWebviewInst(webview);
        setStatus("ready");
      } catch (err) {
        console.error("Failed to create map webview:", err);
        if (active) setStatus("error");
      }
    }

    init();

    return () => {
      active = false;
      setWebviewInst(null);
      if (local) {
        invoke("close_preview_webview", { label: local.label }).catch(() => {});
        local.close().catch(() => {});
      } else {
        closeMapWebviews();
      }
    };
  }, [activeUrl, contentFilterEnabled]);

  if (!activeSource) return null;

  return (
    <div className="map-tab">
      <div className="map-tab__toolbar">
        <div className="map-tab__heading">
          <span className="map-tab__eyebrow">{t("map.source")}</span>
          <span className="map-tab__game">{activeSource.title}</span>
        </div>

        <button
          type="button"
          className="map-tab__external"
          onClick={openExternal}
          title={t("map.openOnProvider", { provider: activeSource.label })}
        >
          <IconExternalLink size={15} />
          <span>{t("map.openOnProvider", { provider: activeSource.label })}</span>
        </button>
      </div>

      {sources.length > 1 && (
        <div
          className="map-tab__sources"
          role="tablist"
          aria-label={t("map.selectSource")}
        >
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              role="tab"
              aria-selected={source.id === activeSource.id}
              className={`map-tab__chip${source.id === activeSource.id ? " is-active" : ""}`}
              onClick={() => {
                setActiveSourceId(source.id);
                setActiveMapUrl(null);
              }}
            >
              {source.label}
            </button>
          ))}
        </div>
      )}

      {activeSource.maps.length > 1 && (
        <div className="map-tab__maps" role="tablist" aria-label={t("map.selectMap")}>
          {activeSource.maps.map((map) => (
            <button
              key={map.url}
              type="button"
              role="tab"
              aria-selected={map.url === activeUrl}
              className={`map-tab__chip${map.url === activeUrl ? " is-active" : ""}`}
              onClick={() => setActiveMapUrl(map.url)}
            >
              {map.title}
            </button>
          ))}
        </div>
      )}

      <div className="map-tab__frame" ref={containerRef}>
        {status !== "ready" && (
          <div className="map-tab__placeholder">
            {status === "loading" ? (
              <>
                <div className="map-tab__spinner" />
                <span>{t("map.loading")}</span>
              </>
            ) : (
              <>
                <span>{t("map.unavailable")}</span>
                <button
                  type="button"
                  className="map-tab__external"
                  onClick={openExternal}
                >
                  <IconExternalLink size={15} />
                  <span>{t("map.openOnProvider", { provider: activeSource.label })}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
