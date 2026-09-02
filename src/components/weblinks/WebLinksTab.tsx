import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useBigScreen } from "../../context/BigScreenContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  FIXED_SOURCES,
  MY_LINKS_KEY,
  buildUrl,
  deriveCustomLinkMeta,
  getSteamAppIdString,
} from "./sources";
import { CloseIcon, CustomLinkIcon } from "./WebLinksIcons";
import WebLinksSourceStrip from "./WebLinksSourceStrip";
import WebLinksSteamSections from "./WebLinksSteamSections";
import WebLinksAddressBar from "./WebLinksAddressBar";
import WebLinksWebview from "./WebLinksWebview";
import MyLinksManager from "./MyLinksManager";
import WebLinksBigScreen from "./WebLinksBigScreen";
import type {
  SourceCategoryKey,
  SourceDef,
  SteamSectionKey,
  WebLinksTabProps,
} from "./types";

export default function WebLinksTab({
  game,
  visible = true,
  onWebsitesChange,
}: WebLinksTabProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const editable = typeof onWebsitesChange === "function";

  const [activeCategory, setActiveCategory] = useState<SourceCategoryKey>("all");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [activeSourceKey, setActiveSourceKey] = useState<string>("steam");
  const [steamSection, setSteamSection] = useState<SteamSectionKey>("store");
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);
  const [appIdOverride, setAppIdOverride] = useState<string | null>(null);
  const [activeWebviewLabel, setActiveWebviewLabel] = useState<string | null>(null);

  // Address bar & webview state
  const [currentNavUrl, setCurrentNavUrl] = useState<string>("");
  // URL the webview must be (re)created for — set only by explicit user
  // actions (source/section change, address bar, home, reload). Poll
  // reported navigations update `currentNavUrl` (display) WITHOUT this.
  const [commandedUrl, setCommandedUrl] = useState<string | null>(null);
  const [navState, setNavState] = useState<{ back: boolean; forward: boolean }>({
    back: false,
    forward: false,
  });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  // Enlarged browser modal — the native webview is moved into the modal frame
  const [expanded, setExpanded] = useState(false);
  const [modalWebviewReady, setModalWebviewReady] = useState(false);
  const expandedFrameRef = useRef<HTMLDivElement>(null);

  // Steam AppID detection (canonical resolver + session override)
  const appId = useMemo(() => {
    if (appIdOverride) return appIdOverride;
    return getSteamAppIdString(game);
  }, [game, appIdOverride]);

  // Extract raw custom links
  const customLinks = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of game.websites ?? []) {
      const trimmed = (u ?? "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }, [game.websites]);

  // Convert custom links to SourceDef items
  const customSources = useMemo<SourceDef[]>(() => {
    return customLinks.map((raw) => {
      let url = raw;
      let label = "";
      let tag = "";
      if (raw.startsWith("{") && raw.endsWith("}")) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.url) {
            url = parsed.url;
            label = parsed.label;
            tag = parsed.tag;
          }
        } catch {
          // ignore
        }
      }
      const meta = deriveCustomLinkMeta(url);
      return {
        key: url,
        label: label || meta.label,
        category: "mylinks",
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
        icon: <CustomLinkIcon />,
        url,
        tag,
      };
    });
  }, [customLinks]);

  // All sources (fixed + individual custom links)
  const allSources = useMemo<SourceDef[]>(() => {
    return [...FIXED_SOURCES, ...customSources];
  }, [customSources]);

  // Filter sources by category
  const filteredSources = useMemo(() => {
    if (activeCategory === "all") return allSources;
    if (activeCategory === "mylinks") return customSources;
    return FIXED_SOURCES.filter((s) => s.category === activeCategory);
  }, [activeCategory, allSources, customSources]);

  // Counts per category for category pill badges
  const categoryCounts = useMemo(() => {
    const counts: Record<SourceCategoryKey, number> = {
      all: FIXED_SOURCES.length + customSources.length,
      stores: FIXED_SOURCES.filter((s) => s.category === "stores").length,
      wikis: FIXED_SOURCES.filter((s) => s.category === "wikis").length,
      community: FIXED_SOURCES.filter((s) => s.category === "community").length,
      modding: FIXED_SOURCES.filter((s) => s.category === "modding").length,
      mylinks: customSources.length,
    };
    return counts;
  }, [customSources]);

  // Select a category: switch the active source to one inside that category
  const handleSelectCategory = useCallback(
    (cat: SourceCategoryKey) => {
      setActiveCategory(cat);
      if (cat === "mylinks") {
        if (customSources.length > 0) {
          setActiveSourceKey(customSources[0].key);
        } else {
          setActiveSourceKey(MY_LINKS_KEY);
        }
        return;
      }
      const inCat = allSources.filter(
        (s) => cat === "all" || s.category === cat
      );
      if (inCat.length > 0 && !inCat.some((s) => s.key === activeSourceKey)) {
        setActiveSourceKey(inCat[0].key);
      }
    },
    [activeSourceKey, allSources, customSources]
  );

  const isMyLinksManagerActive = activeSourceKey === MY_LINKS_KEY;

  // Active Source Definition
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
    const found = allSources.find((s) => s.key === activeSourceKey || s.url === activeSourceKey);
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

  // Active target URL for webview
  const computedInitialUrl = useMemo(() => {
    if (isMyLinksManagerActive) {
      if (customPreviewUrl) return customPreviewUrl;
      if (customSources.length > 0 && customSources[0].url) {
        return customSources[0].url;
      }
      return "";
    }
    return buildUrl(game, activeSourceKey, steamSection, appId);
  }, [game, activeSourceKey, steamSection, appId, isMyLinksManagerActive, customPreviewUrl, customSources]);

  const webviewUrl = commandedUrl ?? computedInitialUrl;

  // Sync initial computed URL to currentNavUrl when source/section changes
  useEffect(() => {
    setCurrentNavUrl(computedInitialUrl);
    setCommandedUrl(null);
  }, [computedInitialUrl]);

  const isSteamActive = activeSourceKey === "steam" && !isMyLinksManagerActive;
  const steamSubDisabled = isSteamActive && steamSection !== "store" && !appId;
  const isSteamSearchFallback = isSteamActive && steamSection === "store" && !appId;
  const hasPreviewableUrl =
    (!isMyLinksManagerActive || customSources.length > 0) &&
    !!(currentNavUrl || computedInitialUrl);

  // External browser opener
  const handleOpenExternal = useCallback(
    async (targetUrl?: string) => {
      const urlToOpen = targetUrl || currentNavUrl || computedInitialUrl;
      if (!urlToOpen) return;
      try {
        await openUrl(urlToOpen);
      } catch (err) {
        console.error("openUrl failed:", err);
        window.open(urlToOpen, "_blank", "noopener,noreferrer");
      }
    },
    [currentNavUrl, computedInitialUrl]
  );

  // Pin current URL to My Links
  const handlePinCustomLink = useCallback(
    (url: string) => {
      if (!onWebsitesChange || !url) return;
      if (customLinks.some((u) => u.toLowerCase().includes(url.toLowerCase()))) return;
      onWebsitesChange([...customLinks, url]);
    },
    [customLinks, onWebsitesChange]
  );

  const isCurrentUrlPinned = useMemo(() => {
    if (!currentNavUrl) return false;
    return customLinks.some((u) => u.toLowerCase().includes(currentNavUrl.toLowerCase()));
  }, [customLinks, currentNavUrl]);

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel((z) => Math.min(2.0, +(z + 0.1).toFixed(1)));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(0.6, +(z - 0.1).toFixed(1)));
  const handleZoomReset = () => setZoomLevel(1.0);

  // Shared browser actions (tab toolbar + expanded modal toolbar)
  const handleGoBack = useCallback(() => {
    if (!navState.back || !activeWebviewLabel) return;
    invoke("webview_history_navigate", {
      label: activeWebviewLabel,
      direction: "back",
    }).catch(() => {});
  }, [navState.back, activeWebviewLabel]);

  const handleGoForward = useCallback(() => {
    if (!navState.forward || !activeWebviewLabel) return;
    invoke("webview_history_navigate", {
      label: activeWebviewLabel,
      direction: "forward",
    }).catch(() => {});
  }, [navState.forward, activeWebviewLabel]);

  const handleReload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const handleHome = useCallback(() => {
    setCommandedUrl(null);
    setCurrentNavUrl(computedInitialUrl);
    setReloadNonce((n) => n + 1);
  }, [computedInitialUrl]);

  const handleNavigate = useCallback((newUrl: string) => {
    setCommandedUrl(newUrl);
    setCurrentNavUrl(newUrl);
    setReloadNonce((n) => n + 1);
  }, []);

  // Auto-close the enlarged browser when the tab itself is hidden
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  // Close the enlarged browser with Escape
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // BigScreen Mode
  if (isBigScreen) {
    return <WebLinksBigScreen game={game} />;
  }

  return (
    <div className="wl-tab">
      {/* ─── 1. Source Tabs Strip with inline category filter ──────── */}
      <WebLinksSourceStrip
        sources={filteredSources}
        activeSourceKey={activeSourceKey}
        onSelectSource={(key) => setActiveSourceKey(key)}
        customLinksCount={customLinks.length}
        showMyLinksTab={true}
        activeCategory={activeCategory}
        onSelectCategory={handleSelectCategory}
        counts={categoryCounts}
        onMenuOpenChange={setCategoryMenuOpen}
      />

      {/* ─── 2. Steam Sub-Sections (When Steam is selected) ──────────── */}
      {isSteamActive && (
        <WebLinksSteamSections
          activeSection={steamSection}
          onSelectSection={(sec) => setSteamSection(sec)}
          appId={appId}
          onAttachAppId={(id) => setAppIdOverride(id)}
        />
      )}

      {/* ─── 3. My Links Custom Manager ─────────────────────────────── */}
      {isMyLinksManagerActive && (
        <MyLinksManager
          game={game}
          customLinks={customLinks}
          activePreviewUrl={currentNavUrl || computedInitialUrl}
          editable={editable}
          onSelectPreviewUrl={(url) => {
            setCustomPreviewUrl(url);
            setCommandedUrl(url);
            setCurrentNavUrl(url);
            setReloadNonce((n) => n + 1);
          }}
          onOpenExternal={handleOpenExternal}
          onWebsitesChange={onWebsitesChange}
        />
      )}

      {/* ─── 4. Browser Address Bar & Actions Toolbar ───────────────── */}
      {hasPreviewableUrl && (
        <WebLinksAddressBar
          currentUrl={currentNavUrl || computedInitialUrl}
          activeSourceDef={activeSourceDef}
          navState={navState}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onReload={handleReload}
          onHome={handleHome}
          onNavigate={handleNavigate}
          onOpenExternal={handleOpenExternal}
          onPinCustomLink={editable ? handlePinCustomLink : undefined}
          isPinned={isCurrentUrlPinned}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          expanded={expanded}
          onToggleExpand={() => setExpanded((v) => !v)}
        />
      )}

      {/* ─── 5. Native Webview Preview Frame ────────────────────────── */}
      {hasPreviewableUrl && (
        <WebLinksWebview
          url={webviewUrl}
          game={game}
          visible={visible}
          activeSourceDef={activeSourceDef}
          activeSteamSection={
            isSteamActive
              ? {
                  key: steamSection,
                  label: steamSection,
                  i18nKey: `weblinks.steam.${steamSection}`,
                  icon: activeSourceDef.icon,
                }
              : undefined
          }
          steamSubDisabled={steamSubDisabled}
          isSteamSearchFallback={isSteamSearchFallback}
          reloadNonce={reloadNonce}
          zoomLevel={zoomLevel}
          expanded={expanded}
          expandedFrameRef={expandedFrameRef}
          onWebviewReadyChange={setModalWebviewReady}
          onUrlChange={(url) => setCurrentNavUrl(url)}
          onNavStateChange={(state) => setNavState(state)}
          onWebviewLabelChange={(label) => setActiveWebviewLabel(label)}
          onOpenExternal={handleOpenExternal}
          menuOpen={categoryMenuOpen}
        />
      )}

      {/* ─── 6. Footnote Informational Bar ──────────────────────────── */}
      <div className="wl-footnote">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{t("weblinks.footnote")}</span>
      </div>

      {/* ─── 7. Enlarged Browser Modal (near-full-window) ────────────── */}
      {expanded &&
        hasPreviewableUrl &&
        createPortal(
          <div
            className="wl-expand-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t("weblinks.expandView")}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setExpanded(false);
            }}
          >
            <div className="wl-expand-modal">
              <div className="wl-expand-toolbar">
                <WebLinksAddressBar
                  currentUrl={currentNavUrl || computedInitialUrl}
                  activeSourceDef={activeSourceDef}
                  navState={navState}
                  onGoBack={handleGoBack}
                  onGoForward={handleGoForward}
                  onReload={handleReload}
                  onHome={handleHome}
                  onNavigate={handleNavigate}
                  onOpenExternal={handleOpenExternal}
                  onPinCustomLink={editable ? handlePinCustomLink : undefined}
                  isPinned={isCurrentUrlPinned}
                  zoomLevel={zoomLevel}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onZoomReset={handleZoomReset}
                  expanded={expanded}
                  onToggleExpand={() => setExpanded(false)}
                />
                <button
                  className="wl-expand-close"
                  onClick={() => setExpanded(false)}
                  type="button"
                  title={t("weblinks.closeExpand")}
                  aria-label={t("weblinks.closeExpand")}
                >
                  <CloseIcon />
                </button>
              </div>
              <div ref={expandedFrameRef} className="wl-expand-frame">
                {!modalWebviewReady && (
                  <div className="wl-webview-loader" aria-hidden>
                    <div className="wl-webview-spinner" />
                    <span>
                      {t("weblinks.loading", { source: activeSourceDef.label })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
