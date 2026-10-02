import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { dismissWebviewConsent } from "../../hooks/useEmbeddedWebviewNav";
import {
  FIXED_SOURCES,
  MY_LINKS_KEY,
  buildUrl,
  deriveCustomLinkMeta,
  getSteamAppIdString,
  isSameUrl,
  normalizeUrl,
  parseCustomLinks,
} from "./sources";
import { CustomLinkIcon } from "./WebLinksIcons";
import type { SourceCategoryKey, SourceDef, SteamSectionKey } from "./types";
import type { Game } from "../../types/game";

interface UseWebLinksBrowserArgs {
  game: Game;
  visible: boolean;
  onWebsitesChange?: (websites: string[]) => void;
}

export function useWebLinksBrowser({
  game,
  visible,
  onWebsitesChange,
}: UseWebLinksBrowserArgs) {
  const { t } = useLanguage();
  const editable = typeof onWebsitesChange === "function";

  const [activeCategory, setActiveCategory] = useState<SourceCategoryKey>("all");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [activeSourceKey, setActiveSourceKey] = useState<string>("steam");
  const [steamSection, setSteamSection] = useState<SteamSectionKey>("store");
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);
  const [appIdOverride, setAppIdOverride] = useState<string | null>(null);

  const [activeWebviewLabel, setActiveWebviewLabel] = useState<string | null>(null);
  const [currentNavUrl, setCurrentNavUrl] = useState<string>("");
  const [commandedUrl, setCommandedUrl] = useState<string | null>(null);
  const [navState, setNavState] = useState({ back: false, forward: false });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [expanded, setExpanded] = useState(false);
  const [modalWebviewReady, setModalWebviewReady] = useState(false);
  const expandedFrameRef = useRef<HTMLDivElement>(null);

  const appId = useMemo(
    () => appIdOverride ?? getSteamAppIdString(game),
    [game, appIdOverride]
  );

  const parsedCustomLinks = useMemo(
    () => parseCustomLinks(game.websites),
    [game.websites]
  );

  const customLinks = useMemo(
    () => parsedCustomLinks.map((parsed) => parsed.raw),
    [parsedCustomLinks]
  );

  const customSources = useMemo<SourceDef[]>(
    () =>
      parsedCustomLinks.map((parsed) => ({
        key: parsed.url,
        label: parsed.label,
        category: "mylinks",
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
        icon: <CustomLinkIcon />,
        url: parsed.url,
        tag: parsed.tag,
      })),
    [parsedCustomLinks]
  );

  // Fixed sources resolve to per-game URLs, so a saved link can still be a
  // duplicate of e.g. Steam or NexusMods. Drop those from the merged view.
  const fixedCanonicalUrls = useMemo(
    () =>
      new Set(
        FIXED_SOURCES.map((s) => normalizeUrl(buildUrl(game, s.key, "store", appId)))
      ),
    [game, appId]
  );

  const allSources = useMemo<SourceDef[]>(
    () => [
      ...FIXED_SOURCES,
      ...customSources.filter(
        (s) => !s.url || !fixedCanonicalUrls.has(normalizeUrl(s.url))
      ),
    ],
    [customSources, fixedCanonicalUrls]
  );

  const filteredSources = useMemo(() => {
    if (activeCategory === "all") return allSources;
    if (activeCategory === "mylinks") return customSources;
    return FIXED_SOURCES.filter((s) => s.category === activeCategory);
  }, [activeCategory, allSources, customSources]);

  const categoryCounts = useMemo<Record<SourceCategoryKey, number>>(() => {
    const countIn = (cat: SourceCategoryKey) =>
      FIXED_SOURCES.filter((s) => s.category === cat).length;
    return {
      all: allSources.length,
      stores: countIn("stores"),
      wikis: countIn("wikis"),
      community: countIn("community"),
      modding: countIn("modding"),
      mylinks: customSources.length,
    };
  }, [allSources, customSources]);

  const isMyLinksManagerActive = activeSourceKey === MY_LINKS_KEY;

  const handleSelectCategory = useCallback(
    (cat: SourceCategoryKey) => {
      setActiveCategory(cat);
      if (cat === "mylinks") {
        setActiveSourceKey(customSources.length > 0 ? customSources[0].key : MY_LINKS_KEY);
        return;
      }
      const inCat = allSources.filter((s) => cat === "all" || s.category === cat);
      if (inCat.length > 0 && !inCat.some((s) => s.key === activeSourceKey)) {
        setActiveSourceKey(inCat[0].key);
      }
    },
    [activeSourceKey, allSources, customSources]
  );

  const activeSourceDef = useMemo<SourceDef>(() => {
    if (isMyLinksManagerActive) {
      return {
        key: MY_LINKS_KEY,
        label: t("weblinks.myLinks"),
        category: "mylinks",
        accent: "var(--color-accent)",
        iconBg: "var(--color-accent-soft)",
        icon: FIXED_SOURCES[0].icon,
      };
    }
    const found = allSources.find(
      (s) => s.key === activeSourceKey || s.url === activeSourceKey
    );
    if (found) return found;

    if (/^https?:\/\//i.test(activeSourceKey)) {
      const meta = deriveCustomLinkMeta(activeSourceKey);
      return {
        key: activeSourceKey,
        label: meta.label,
        category: "mylinks",
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
        icon: <CustomLinkIcon />,
        url: activeSourceKey,
      };
    }

    return FIXED_SOURCES[0];
  }, [isMyLinksManagerActive, activeSourceKey, allSources, t]);

  const computedInitialUrl = useMemo(() => {
    if (isMyLinksManagerActive) {
      if (customPreviewUrl) return customPreviewUrl;
      if (customSources.length > 0 && customSources[0].url) {
        return customSources[0].url;
      }
      return "";
    }
    return buildUrl(game, activeSourceKey, steamSection, appId);
  }, [
    game,
    activeSourceKey,
    steamSection,
    appId,
    isMyLinksManagerActive,
    customPreviewUrl,
    customSources,
  ]);

  const webviewUrl = commandedUrl ?? computedInitialUrl;

  useEffect(() => {
    setCurrentNavUrl(computedInitialUrl);
    setCommandedUrl(null);
  }, [computedInitialUrl]);

  const isSteamActive = activeSourceKey === "steam" && !isMyLinksManagerActive;
  const steamSubDisabled = isSteamActive && steamSection !== "store" && !appId;
  const isSteamSearchFallback = isSteamActive && steamSection === "store" && !appId;
  const displayUrl = currentNavUrl || computedInitialUrl;
  const hasPreviewableUrl =
    (!isMyLinksManagerActive || customSources.length > 0) && !!displayUrl;

  const openExternal = useCallback(
    async (targetUrl?: string) => {
      const urlToOpen = targetUrl || displayUrl;
      if (!urlToOpen) return;
      try {
        await openUrl(urlToOpen);
      } catch (err) {
        console.error("openUrl failed:", err);
        window.open(urlToOpen, "_blank", "noopener,noreferrer");
      }
    },
    [displayUrl]
  );

  const isCurrentUrlPinned = useMemo(
    () => !!currentNavUrl && customLinks.some((u) => isSameUrl(u, currentNavUrl)),
    [customLinks, currentNavUrl]
  );

  const pinCustomLink = useCallback(
    (url: string) => {
      if (!onWebsitesChange || !url) return;
      if (customLinks.some((u) => isSameUrl(u, url))) return;
      onWebsitesChange([...customLinks, url]);
    },
    [customLinks, onWebsitesChange]
  );

  const zoomIn = useCallback(
    () => setZoomLevel((z) => Math.min(2.0, +(z + 0.1).toFixed(1))),
    []
  );
  const zoomOut = useCallback(
    () => setZoomLevel((z) => Math.max(0.6, +(z - 0.1).toFixed(1))),
    []
  );
  const zoomReset = useCallback(() => setZoomLevel(1.0), []);

  const goBack = useCallback(() => {
    if (!navState.back || !activeWebviewLabel) return;
    invoke("webview_history_navigate", {
      label: activeWebviewLabel,
      direction: "back",
    }).catch(() => {});
  }, [navState.back, activeWebviewLabel]);

  const goForward = useCallback(() => {
    if (!navState.forward || !activeWebviewLabel) return;
    invoke("webview_history_navigate", {
      label: activeWebviewLabel,
      direction: "forward",
    }).catch(() => {});
  }, [navState.forward, activeWebviewLabel]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const dismissCookies = useCallback(() => {
    dismissWebviewConsent(activeWebviewLabel);
  }, [activeWebviewLabel]);

  const home = useCallback(() => {
    setCommandedUrl(null);
    setCurrentNavUrl(computedInitialUrl);
    setReloadNonce((n) => n + 1);
  }, [computedInitialUrl]);

  const navigate = useCallback((newUrl: string) => {
    setCommandedUrl(newUrl);
    setCurrentNavUrl(newUrl);
    setReloadNonce((n) => n + 1);
  }, []);

  const selectPreviewUrl = useCallback((url: string) => {
    setCustomPreviewUrl(url);
    setCommandedUrl(url);
    setCurrentNavUrl(url);
    setReloadNonce((n) => n + 1);
  }, []);

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return {
    editable,

    activeCategory,
    categoryMenuOpen,
    setCategoryMenuOpen,
    filteredSources,
    categoryCounts,
    activeSourceKey,
    setActiveSourceKey,
    handleSelectCategory,
    activeSourceDef,
    isMyLinksManagerActive,

    customLinks,
    selectPreviewUrl,

    appId,
    setAppIdOverride,
    steamSection,
    setSteamSection,
    isSteamActive,
    steamSubDisabled,
    isSteamSearchFallback,

    displayUrl,
    webviewUrl,
    hasPreviewableUrl,
    reloadNonce,
    navState,
    setNavState,
    zoomLevel,
    goBack,
    goForward,
    reload,
    dismissCookies,
    home,
    navigate,
    zoomIn,
    zoomOut,
    zoomReset,
    openExternal,
    pinCustomLink,
    isCurrentUrlPinned,

    expanded,
    toggleExpanded,
    modalWebviewReady,
    setModalWebviewReady,
    expandedFrameRef,

    activeWebviewLabel,
    setActiveWebviewLabel,
    setCurrentNavUrl,
  };
}
