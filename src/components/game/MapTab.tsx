import { useCallback, useEffect, useRef, useState } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useWebviewContentFilterEnabled } from "../../context/SettingsContext";
import { IconExternalLink } from "./icons";
import type { MapgenieGame } from "../../types/game";

const MAP_WEBVIEW_PREFIX = "mapgenie-preview-";

/** Tear down every MapGenie webview, tolerating ones already gone. */
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
  game: MapgenieGame;
  /** Hide the native webview while a DOM modal sits above it. */
  visible?: boolean;
}

/**
 * MapGenie interactive map tab.
 *
 * MapGenie is served through the same native child-webview pipeline the
 * WebLinks preview uses (`create_preview_webview`), so the map is fully
 * interactive and sidesteps iframe/framing restrictions. The DOM only
 * owns the toolbar and the frame placeholder the native view tracks.
 */
export default function MapTab({ game, visible = true }: MapTabProps) {
  const { t } = useLanguage();
  const contentFilterEnabled = useWebviewContentFilterEnabled();
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeSlug, setActiveSlug] = useState(game.maps[0]?.slug ?? game.slug);
  const [webviewInst, setWebviewInst] = useState<Webview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const activeMap = game.maps.find((m) => m.slug === activeSlug) ?? game.maps[0];
  const activeUrl = activeMap?.url ?? game.url;

  // Re-home onto a fresh map whenever the game itself changes.
  useEffect(() => {
    setActiveSlug(game.maps[0]?.slug ?? game.slug);
  }, [game.slug, game.maps]);

  const openExternal = useCallback(() => {
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

  // (Re)create the native webview whenever the selected map changes.
  useEffect(() => {
    let active = true;
    let local: Webview | null = null;
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
        if (!webview) throw new Error("MapGenie webview was not created");

        if (!active) {
          invoke("close_preview_webview", { label }).catch(() => {});
          webview.close().catch(() => {});
          return;
        }

        local = webview;
        setWebviewInst(webview);
        setStatus("ready");
      } catch (err) {
        console.error("Failed to create MapGenie webview:", err);
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

  return (
    <div className="map-tab">
      <div className="map-tab__toolbar">
        <div className="map-tab__heading">
          <span className="map-tab__eyebrow">{t("map.source")}</span>
          <span className="map-tab__game">{game.title}</span>
        </div>

        {game.maps.length > 1 && (
          <div className="map-tab__maps" role="tablist" aria-label={t("map.selectMap")}>
            {game.maps.map((map) => (
              <button
                key={map.slug}
                type="button"
                role="tab"
                aria-selected={map.slug === activeMap?.slug}
                className={`map-tab__chip${map.slug === activeMap?.slug ? " is-active" : ""}`}
                onClick={() => setActiveSlug(map.slug)}
              >
                {map.title}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="map-tab__external"
          onClick={openExternal}
          title={t("map.openOnMapGenie")}
        >
          <IconExternalLink size={15} />
          <span>{t("map.openOnMapGenie")}</span>
        </button>
      </div>

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
                  <span>{t("map.openOnMapGenie")}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
