import { useEffect, useRef, useState } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { OpenExternalIcon, SteamIcon } from "./WebLinksIcons";
import type { SourceDef, SteamSectionDef, ViewHeightMode } from "./types";
import type { Game } from "../../types/game";

interface WebLinksWebviewProps {
  url: string;
  game: Game;
  visible?: boolean;
  activeSourceDef: SourceDef;
  activeSteamSection?: SteamSectionDef;
  steamSubDisabled: boolean;
  isSteamSearchFallback: boolean;
  reloadNonce: number;
  zoomLevel: number;
  heightMode: ViewHeightMode;
  onUrlChange?: (url: string) => void;
  onNavStateChange?: (state: { back: boolean; forward: boolean }) => void;
  onWebviewLabelChange?: (label: string | null) => void;
  onOpenExternal: (url?: string) => void;
  /** While true the native webview is hidden so DOM popovers can appear above it */
  menuOpen?: boolean;
}

export default function WebLinksWebview({
  url,
  game,
  visible = true,
  activeSourceDef,
  activeSteamSection,
  steamSubDisabled,
  isSteamSearchFallback,
  reloadNonce,
  zoomLevel,
  heightMode,
  onUrlChange,
  onNavStateChange,
  onWebviewLabelChange,
  onOpenExternal,
  menuOpen = false,
}: WebLinksWebviewProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewInst, setWebviewInst] = useState<Webview | null>(null);

  const navHistoryRef = useRef<string[]>([url]);
  const navIndexRef = useRef(0);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    setWebviewReady(false);
  }, [url, reloadNonce]);

  // Sizing and positioning sync
  useEffect(() => {
    if (!containerRef.current || !webviewInst) return;

    const handleResize = () => {
      if (!containerRef.current || !webviewInst) return;
      const rect = containerRef.current.getBoundingClientRect();

      webviewInst
        .setPosition(new LogicalPosition(rect.left, rect.top))
        .catch((e) => console.error("Error setting webview position:", e));
      webviewInst
        .setSize(new LogicalSize(rect.width, rect.height))
        .catch((e) => console.error("Error setting webview size:", e));
    };

    handleResize();

    const observer = new ResizeObserver(() => {
      handleResize();
    });

    observer.observe(containerRef.current);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [webviewInst, heightMode]);

  // Visibility sync — hide while a DOM popover (category menu) is open,
  // since native webviews composite above DOM content and z-index can't win.
  useEffect(() => {
    if (!webviewInst) return;
    if (visible && !menuOpen) {
      webviewInst.show().catch((e) => console.error("Error showing webview:", e));
    } else {
      webviewInst.hide().catch((e) => console.error("Error hiding webview:", e));
    }
  }, [webviewInst, visible, menuOpen]);

  // Apply zoom level via JS evaluation
  useEffect(() => {
    if (!webviewInst || !webviewReady) return;
    const js = `
      try {
        document.body.style.zoom = "${zoomLevel}";
      } catch (e) {}
    `;
    invoke("webview_eval", {
      label: webviewInst.label,
      js,
    }).catch(() => {});
  }, [webviewInst, webviewReady, zoomLevel]);

  // Initialize and recreate native webview on url / nonce change
  useEffect(() => {
    let active = true;
    let localWebview: Webview | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function pollCurrentUrl() {
      if (!localWebview || !active || !visibleRef.current) return;
      try {
        const current = await invoke<string>("webview_current_url", {
          label: localWebview.label,
        });
        if (!current) return;
        if (current.startsWith("about:blank")) return;

        const hist = navHistoryRef.current;
        const idx = navIndexRef.current;
        if (hist[idx] === current) return;

        const known = hist.indexOf(current);
        if (known !== -1) {
          navIndexRef.current = known;
        } else {
          const truncated = hist.slice(0, idx + 1);
          truncated.push(current);
          navHistoryRef.current = truncated;
          navIndexRef.current = truncated.length - 1;
        }

        if (onUrlChange) onUrlChange(current);
        if (onNavStateChange) {
          const curIdx = navIndexRef.current;
          const curLen = navHistoryRef.current.length;
          onNavStateChange({ back: curIdx > 0, forward: curIdx < curLen - 1 });
        }
      } catch {
        // webview closed or mid-navigation
      }
    }

    async function initWebview() {
      if (steamSubDisabled || !url) {
        try {
          const allWebviews = await Webview.getAll();
          for (const wv of allWebviews) {
            if (wv.label.startsWith("weblinks-preview-")) {
              await wv.close();
            }
          }
        } catch {
          // ignore
        }
        return;
      }

      // Close previous webviews first
      try {
        const allWebviews = await Webview.getAll();
        for (const wv of allWebviews) {
          if (wv.label.startsWith("weblinks-preview-")) {
            await wv.close();
          }
        }
      } catch {
        // ignore
      }

      if (!active || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const uniqueLabel = "weblinks-preview-" + Math.random().toString(36).substring(2, 9);

      try {
        await invoke("create_preview_webview", {
          label: uniqueLabel,
          url,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
        const webview = await Webview.getByLabel(uniqueLabel);
        if (!webview) throw new Error("preview webview was not created");

        if (!active) {
          webview.close().catch(() => {});
          return;
        }

        localWebview = webview;
        setWebviewInst(webview);
        if (onWebviewLabelChange) onWebviewLabelChange(webview.label);

        navHistoryRef.current = [url];
        navIndexRef.current = 0;
        if (onNavStateChange) onNavStateChange({ back: false, forward: false });

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollCurrentUrl, 500);

        setWebviewReady(true);

        webview.once("tauri://error", (e) => {
          console.error("Webview creation error:", e);
        });
      } catch (err) {
        console.error("Failed to create webview:", err);
      }
    }

    initWebview();

    return () => {
      active = false;
      setWebviewInst(null);
      if (onWebviewLabelChange) onWebviewLabelChange(null);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (localWebview) {
        localWebview.close().catch(() => {});
      } else {
        Webview.getAll()
          .then((all) => {
            for (const wv of all) {
              if (wv.label.startsWith("weblinks-preview-")) {
                wv.close().catch(() => {});
              }
            }
          })
          .catch(() => {});
      }
    };
  }, [url, steamSubDisabled, reloadNonce]);

  const heightClass =
    heightMode === "max"
      ? " wl-preview-max"
      : heightMode === "tall"
      ? " wl-preview-tall"
      : " wl-preview-standard";

  return (
    <div className={`wl-preview${heightClass}`}>
      {steamSubDisabled ? (
        <div className="wl-empty">
          <div className="wl-empty-header">
            <span
              className="wl-empty-icon"
              style={{
                color: activeSourceDef.accent,
                background: activeSourceDef.iconBg,
              }}
            >
              {activeSteamSection?.icon}
            </span>
            <h3>{t("weblinks.steamAppIdNotDetected")}</h3>
          </div>
          <p>
            {t("weblinks.steamAppIdNotDetectedBody", {
              section: activeSteamSection?.label ?? "",
              game: game.name,
              appid: "{appid}",
            })}
          </p>
          <button
            className="wl-empty-btn primary"
            onClick={() => onOpenExternal()}
            type="button"
          >
            <OpenExternalIcon />
            {t("weblinks.steam.searchStore")}
          </button>
        </div>
      ) : isSteamSearchFallback ? (
        <div className="wl-empty subtle">
          <div className="wl-empty-header">
            <span
              className="wl-empty-icon"
              style={{
                color: activeSourceDef.accent,
                background: activeSourceDef.iconBg,
              }}
            >
              {SteamIcon}
            </span>
            <h3>{t("weblinks.steamSearchMode")}</h3>
          </div>
          <p>{t("weblinks.steamSearchModeBody", { game: game.name })}</p>
        </div>
      ) : null}

      {!steamSubDisabled && (
        <div ref={containerRef} className="wl-webview-frame">
          {!webviewReady && (
            <div className="wl-webview-loader" aria-hidden>
              <div className="wl-webview-spinner" />
              <span>
                {t("weblinks.loading", {
                  source: activeSourceDef.label,
                })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
