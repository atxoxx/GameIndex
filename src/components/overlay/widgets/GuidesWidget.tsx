import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BookOpen, ChevronLeft, ExternalLink, Loader2, Map as MapIcon } from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useGameMaps } from "../../../hooks/useGameMaps";
import {
  FIXED_SOURCES,
  buildUrl,
  getSteamAppIdString,
  parseCustomLinks,
} from "../../weblinks/sources";
import WebviewControls from "../../webview/WebviewControls";
import { Card } from "../../ui";
import type { Game } from "../../../types/game";

/** Child-webview label prefix reserved for the overlay's Guides browser. */
const PREVIEW_PREFIX = "overlay-guides-";

/**
 * Sources offered in the compact HUD picker, in display order. A curated
 * subset of the full WebLinks list — the panel is small, so stores and
 * anything a player won't open mid-game are left to the main app.
 */
const CURATED_SOURCE_KEYS = [
  "pcgamingwiki",
  "hltb",
  "reddit",
  "youtube",
  "twitch",
  "nexusmods",
  "protondb",
] as const;

interface LinkEntry {
  key: string;
  label: string;
  url: string;
  icon: ReactNode;
}

/**
 * Owns one native child webview hosted by the overlay window. Positioned over
 * the DOM frame and kept glued to it as the panel resizes/scrolls. Uses only
 * the Rust preview commands (no JS `Webview` API), so the overlay window needs
 * no extra core permissions.
 */
function useOverlayPreview(url: string | null) {
  const frameRef = useRef<HTMLDivElement>(null);
  const localLabelRef = useRef<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [navState, setNavState] = useState({ back: false, forward: false });

  useEffect(() => {
    if (!url) {
      setLabel(null);
      setReady(false);
      return;
    }
    let active = true;
    setReady(false);

    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const nextLabel = PREVIEW_PREFIX + Math.random().toString(36).slice(2, 9);

    invoke("create_preview_webview", {
      label: nextLabel,
      url,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      contentFilter: true,
      window: "overlay",
    })
      .then(() => {
        if (!active) {
          void invoke("close_preview_webview", { label: nextLabel }).catch(() => {});
          return;
        }
        localLabelRef.current = nextLabel;
        setLabel(nextLabel);
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to open overlay guides webview:", err);
      });

    return () => {
      active = false;
      const closing = localLabelRef.current ?? nextLabel;
      localLabelRef.current = null;
      void invoke("close_preview_webview", { label: closing }).catch(() => {});
      setLabel(null);
      setReady(false);
    };
  }, [url, reloadNonce]);

  // Keep the native view glued to the DOM frame (resize + scroll).
  useEffect(() => {
    if (!label) return;
    const frame = frameRef.current;
    if (!frame) return;

    const sync = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void invoke("reposition_preview_webview", {
        label,
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
  }, [label]);

  // Track back/forward availability by polling the live URL.
  useEffect(() => {
    if (!label) return;
    let cancelled = false;
    const history: string[] = url ? [url] : [];
    let index = 0;

    const poll = async () => {
      try {
        const current = await invoke<string>("webview_current_url", { label });
        if (cancelled || !current || current.startsWith("about:blank")) return;
        if (history[index] === current) return;
        const known = history.indexOf(current);
        if (known !== -1) {
          index = known;
        } else {
          history.splice(index + 1);
          history.push(current);
          index = history.length - 1;
        }
        setNavState({ back: index > 0, forward: index < history.length - 1 });
      } catch {
        /* webview closed or mid-navigation */
      }
    };

    const timer = window.setInterval(poll, 700);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [label, url]);

  const goBack = useCallback(() => {
    if (!label) return;
    void invoke("webview_history_navigate", { label, direction: "back" }).catch(() => {});
  }, [label]);
  const goForward = useCallback(() => {
    if (!label) return;
    void invoke("webview_history_navigate", { label, direction: "forward" }).catch(() => {});
  }, [label]);
  const dismissCookies = useCallback(() => {
    if (!label) return;
    void invoke("webview_dismiss_consent", { label }).catch(() => {});
  }, [label]);

  return {
    frameRef,
    ready,
    navState,
    goBack,
    goForward,
    dismissCookies,
    reload: () => setReloadNonce((n) => n + 1),
  };
}

/**
 * Guides — a lightweight in-HUD browser for the current game's wikis, guides
 * and interactive maps. Reuses the WebLinks source list and `buildUrl`, plus
 * the map providers from `fetch_game_maps`, and embeds the chosen page in a
 * native child webview hosted by the overlay window.
 */
export default function GuidesWidget() {
  const { session } = useOverlay();
  const gameCtx = useOptionalGames();
  const gameList = gameCtx?.games ?? [];
  const runningGameIds = gameCtx?.runningGameIds ?? [];
  const { t } = useLanguage();

  const game = useMemo<Game | null>(() => {
    if (session?.gameId) {
      const match = gameList.find((g) => String(g.id) === String(session.gameId));
      if (match) return match;
    }
    const runningId = runningGameIds?.[0];
    if (runningId) {
      return gameList.find((g) => String(g.id) === String(runningId)) ?? null;
    }
    return null;
  }, [session?.gameId, gameList, runningGameIds]);

  const maps = useGameMaps(game?.name);

  const appId = useMemo(() => (game ? getSteamAppIdString(game) : null), [game]);

  const entries = useMemo<LinkEntry[]>(() => {
    if (!game) return [];
    const list: LinkEntry[] = [];

    for (const source of maps.sources) {
      list.push({
        key: `map:${source.id}`,
        label: source.label,
        url: source.url,
        icon: <MapIcon size={14} />,
      });
    }

    for (const key of CURATED_SOURCE_KEYS) {
      const def = FIXED_SOURCES.find((s) => s.key === key);
      if (!def) continue;
      list.push({ key, label: def.label, url: buildUrl(game, key, "store", appId), icon: def.icon });
    }

    if (appId) {
      list.push({
        key: "steam:guides",
        label: "Steam Guides",
        url: buildUrl(game, "steam", "guides", appId),
        icon: FIXED_SOURCES.find((s) => s.key === "steam")?.icon ?? <BookOpen size={14} />,
      });
    }

    for (const link of parseCustomLinks(game.websites)) {
      if (!/^https?:\/\//i.test(link.url)) continue;
      list.push({ key: `mine:${link.url}`, label: link.label, url: link.url, icon: <BookOpen size={14} /> });
    }

    return list;
  }, [game, maps.sources, appId]);

  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  // Drop the open page when the game changes.
  useEffect(() => {
    setActiveUrl(null);
  }, [game?.id]);

  const preview = useOverlayPreview(activeUrl);
  const activeEntry = entries.find((e) => e.url === activeUrl) ?? null;

  const openExternal = () => {
    if (!activeUrl) return;
    void openUrl(activeUrl).catch(() => {
      window.open(activeUrl, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <Card variant="glass" className="overlay-widget overlay-guides-widget" data-testid="overlay-guides">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <BookOpen />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.group.guides")}</h3>
        {game && activeUrl && (
          <button
            type="button"
            className="overlay-guides__back"
            onClick={() => setActiveUrl(null)}
            title={t("overlay.guides.back")}
            aria-label={t("overlay.guides.back")}
          >
            <ChevronLeft size={14} />
            <span>{t("overlay.guides.back")}</span>
          </button>
        )}
      </div>

      {!game ? (
        <p className="overlay-widget__empty">{t("overlay.guides.empty")}</p>
      ) : activeUrl ? (
        <div className="overlay-guides__browser">
          <div className="overlay-guides__toolbar">
            <WebviewControls
              canGoBack={preview.navState.back}
              canGoForward={preview.navState.forward}
              onBack={preview.goBack}
              onForward={preview.goForward}
              onReload={preview.reload}
              onDismissCookies={preview.dismissCookies}
              onOpenExternal={openExternal}
            />
            <span className="overlay-guides__title" title={activeUrl}>
              {activeEntry?.label ?? activeUrl}
            </span>
            <button
              type="button"
              className="overlay-guides__external"
              onClick={openExternal}
              title={t("weblinks.openInBrowser")}
              aria-label={t("weblinks.openInBrowser")}
            >
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="overlay-guides__frame" ref={preview.frameRef}>
            {!preview.ready && (
              <div className="overlay-guides__loader" aria-hidden>
                <Loader2 size={16} className="overlay-spin" />
                <span>{t("overlay.guides.loading")}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="overlay-guides__grid" data-testid="overlay-guides-grid">
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="overlay-guides__link"
              onClick={() => setActiveUrl(entry.url)}
              title={entry.label}
            >
              <span className="overlay-guides__link-icon" aria-hidden>
                {entry.icon}
              </span>
              <span className="overlay-guides__link-label">{entry.label}</span>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="overlay-widget__empty">{t("overlay.guides.empty")}</p>
          )}
        </div>
      )}
    </Card>
  );
}
