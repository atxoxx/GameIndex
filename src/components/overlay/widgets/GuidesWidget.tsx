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
import { BookOpen, Globe, Loader2, Map as MapIcon } from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useGameMaps } from "../../../hooks/useGameMaps";
import {
  FIXED_SOURCES,
  buildUrl,
  getSteamAppIdString,
  normalizeUrl,
  parseCustomLinks,
} from "../../weblinks/sources";
import WebviewControls from "../../webview/WebviewControls";
import { Card } from "../../ui";
import type { SourceCategoryKey } from "../../weblinks/types";
import type { Game } from "../../../types/game";

/** Child-webview label prefix reserved for the overlay's Guides browser. */
const PREVIEW_PREFIX = "overlay-guides-";

/** Dropdown optgroup order for the fixed WebLinks sources. */
const WEBSITE_GROUP_ORDER: { key: Exclude<SourceCategoryKey, "all">; i18nKey: string }[] = [
  { key: "stores", i18nKey: "weblinks.categories.stores" },
  { key: "wikis", i18nKey: "weblinks.categories.wikis" },
  { key: "community", i18nKey: "weblinks.categories.community" },
  { key: "modding", i18nKey: "weblinks.categories.modding" },
  { key: "mylinks", i18nKey: "weblinks.categories.mylinks" },
];

type GuidesTab = "websites" | "maps";

interface PickEntry {
  key: string;
  label: string;
  url: string;
}

interface PickGroup {
  id: string;
  label: string;
  entries: PickEntry[];
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
 * Guides — a lightweight in-HUD browser for the current game. Two sub-tabs:
 * "Websites" lists every registered WebLinks source (fixed sources, Steam
 * Guides and the game's custom links) in an always-visible dropdown, "Maps"
 * lists the interactive map providers from `fetch_game_maps`. The chosen page
 * is embedded in a native child webview hosted by the overlay window.
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

  const websiteGroups = useMemo<PickGroup[]>(() => {
    if (!game) return [];
    const groups: PickGroup[] = WEBSITE_GROUP_ORDER.map((group) => ({
      id: group.key,
      label: t(group.i18nKey),
      entries: [],
    }));
    const byId = new Map(groups.map((group) => [group.id, group]));

    for (const source of FIXED_SOURCES) {
      byId.get(source.category)?.entries.push({
        key: source.key,
        label: source.label,
        url: buildUrl(game, source.key, "store", appId),
      });
    }

    if (appId) {
      byId.get("wikis")?.entries.push({
        key: "steam:guides",
        label: t("overlay.guides.steamGuides"),
        url: buildUrl(game, "steam", "guides", appId),
      });
    }

    // Fixed sources resolve to per-game URLs, so a registered link can still
    // duplicate e.g. Steam or NexusMods. Match the WebLinks tab and drop those.
    const fixedUrls = new Set(
      FIXED_SOURCES.map((source) =>
        normalizeUrl(buildUrl(game, source.key, "store", appId))
      )
    );
    for (const link of parseCustomLinks(game.websites)) {
      if (!/^https?:\/\//i.test(link.url)) continue;
      if (fixedUrls.has(normalizeUrl(link.url))) continue;
      byId.get("mylinks")?.entries.push({
        key: `mine:${link.url}`,
        label: link.label,
        url: link.url,
      });
    }

    return groups.filter((group) => group.entries.length > 0);
  }, [game, appId, t]);

  const mapGroups = useMemo<PickGroup[]>(() => {
    const groups: PickGroup[] = [];
    for (const source of maps.sources) {
      const items =
        source.maps.length > 0 ? source.maps : [{ title: source.title, url: source.url }];
      const entries = items
        .filter((item) => /^https?:\/\//i.test(item.url))
        .map((item) => ({
          key: `${source.id}:${item.url}`,
          label: item.title,
          url: item.url,
        }));
      if (entries.length > 0) {
        groups.push({ id: source.id, label: source.label, entries });
      }
    }
    return groups;
  }, [maps.sources]);

  const [activeTab, setActiveTab] = useState<GuidesTab>("websites");
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  // Drop both open pages when the game changes.
  useEffect(() => {
    setWebsiteUrl(null);
    setMapUrl(null);
  }, [game?.id]);

  const activeUrl = activeTab === "websites" ? websiteUrl : mapUrl;
  const preview = useOverlayPreview(activeUrl);

  const activeEntry = useMemo(() => {
    const groups = activeTab === "websites" ? websiteGroups : mapGroups;
    for (const group of groups) {
      const match = group.entries.find((entry) => entry.url === activeUrl);
      if (match) return match;
    }
    return null;
  }, [activeTab, websiteGroups, mapGroups, activeUrl]);

  const openExternal = useCallback(() => {
    if (!activeUrl) return;
    void openUrl(activeUrl).catch(() => {
      window.open(activeUrl, "_blank", "noopener,noreferrer");
    });
  }, [activeUrl]);

  if (!game) {
    return (
      <Card variant="glass" className="overlay-widget overlay-guides-widget" data-testid="overlay-guides">
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <BookOpen />
          </span>
          <h3 className="overlay-widget__title">{t("overlay.group.guides")}</h3>
        </div>
        <p className="overlay-widget__empty">{t("overlay.guides.empty")}</p>
      </Card>
    );
  }

  const tabs: { id: GuidesTab; label: string; icon: ReactNode }[] = [
    { id: "websites", label: t("overlay.guides.websites"), icon: <Globe size={12} aria-hidden /> },
    { id: "maps", label: t("overlay.guides.maps"), icon: <MapIcon size={12} aria-hidden /> },
  ];

  const renderGroups = (groups: PickGroup[]) =>
    groups.map((group) => (
      <optgroup key={group.id} label={group.label}>
        {group.entries.map((entry) => (
          <option key={entry.key} value={entry.url}>
            {entry.label}
          </option>
        ))}
      </optgroup>
    ));

  const tabId = (tab: GuidesTab) => `overlay-guides-tab-${tab}`;
  const noMaps = activeTab === "maps" && maps.status === "ready" && mapGroups.length === 0;

  return (
    <Card variant="glass" className="overlay-widget overlay-guides-widget" data-testid="overlay-guides">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <BookOpen />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.group.guides")}</h3>
      </div>

      <div className="overlay-guides__tabs" role="tablist" aria-label={t("overlay.group.guides")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={activeTab === tab.id}
            aria-controls="overlay-guides-tabpanel"
            className={`overlay-guides__tab${
              activeTab === tab.id ? " overlay-guides__tab--active" : ""
            }`}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`overlay-guides-tab-${tab.id}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        className="overlay-guides__body"
        role="tabpanel"
        id="overlay-guides-tabpanel"
        aria-labelledby={tabId(activeTab)}
      >
        {activeTab === "websites" ? (
          <select
            className="overlay-guides__select"
            value={websiteUrl ?? ""}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            aria-label={t("overlay.guides.websites")}
            data-testid="overlay-guides-select"
          >
            <option value="" disabled>
              {t("overlay.guides.selectWebsite")}
            </option>
            {renderGroups(websiteGroups)}
          </select>
        ) : (
          <select
            className="overlay-guides__select"
            value={mapUrl ?? ""}
            disabled={maps.status === "loading" || mapGroups.length === 0}
            onChange={(event) => setMapUrl(event.target.value)}
            aria-label={t("overlay.guides.maps")}
            data-testid="overlay-guides-select"
          >
            <option value="" disabled>
              {maps.status === "loading"
                ? t("overlay.guides.loading")
                : t("overlay.guides.selectMap")}
            </option>
            {renderGroups(mapGroups)}
          </select>
        )}

        {noMaps ? (
          <p className="overlay-widget__empty">{t("overlay.guides.noMaps")}</p>
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
          <div className="overlay-guides__frame overlay-guides__frame--idle">
            {activeTab === "maps" && maps.status === "loading" ? (
              <div className="overlay-guides__loader" aria-hidden>
                <Loader2 size={16} className="overlay-spin" />
                <span>{t("overlay.guides.loading")}</span>
              </div>
            ) : (
              <span className="overlay-guides__hint">{t("overlay.guides.pickHint")}</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
