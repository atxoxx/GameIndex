import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";
import { useBigScreen } from "../../context/BigScreenContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import {
  GameTabChips,
  GameTabSearch,
  GameTabShell,
  GameTabToolbar,
  useGameTabState,
} from "../game/tabs";
import { CloseIcon } from "./WebLinksIcons";
import WebLinksSourceStrip from "./WebLinksSourceStrip";
import WebLinksSteamSections from "./WebLinksSteamSections";
import WebLinksAddressBar from "./WebLinksAddressBar";
import WebLinksWebview from "./WebLinksWebview";
import MyLinksManager from "./MyLinksManager";
import WebLinksBigScreen from "./WebLinksBigScreen";
import WebLinksHub from "./WebLinksHub";
import { useWebLinksBrowser } from "./useWebLinksBrowser";
import { readLastSource, writeLastSource } from "./weblinksStorage";
import { FIXED_SOURCES, MY_LINKS_KEY, SOURCE_CATEGORIES } from "./sources";
import type { SourceCategoryKey, WebLinksTabProps } from "./types";

interface WebLinksTabState {
  category: SourceCategoryKey;
}

const DEFAULT_STATE: WebLinksTabState = {
  category: "all",
};

/**
 * Web Links — a hub that maps every useful destination for a game, backed by
 * the existing native preview browser.
 *
 * The hub is the landing surface; opening a card moves into the browser, and
 * the grid button in its address bar returns to the hub. The last opened
 * source is remembered per game and offered as a resume card.
 */
export default function WebLinksTab({
  game,
  visible = true,
  onWebsitesChange,
}: WebLinksTabProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const browser = useWebLinksBrowser({ game, visible, onWebsitesChange });
  const [state, setState] = useGameTabState<WebLinksTabState>({
    prefix: "wl",
    defaults: DEFAULT_STATE,
    allowed: {
      category: SOURCE_CATEGORIES.map((category) => category.key),
    },
  });
  const [mode, setMode] = useState<"hub" | "browser">("hub");
  const [hubSearch, setHubSearch] = useState("");
  const [lastSourceKey, setLastSourceKey] = useState<string | null>(() =>
    readLastSource(game.id),
  );

  useEffect(() => {
    setLastSourceKey(readLastSource(game.id));
  }, [game.id]);

  const openSource = (sourceKey: string) => {
    browser.setActiveSourceKey(sourceKey);
    setMode("browser");
    if (sourceKey !== MY_LINKS_KEY && !/^https?:\/\//i.test(sourceKey)) {
      writeLastSource(game.id, sourceKey);
      setLastSourceKey(sourceKey);
    }
  };

  const openManager = () => {
    browser.setActiveSourceKey(MY_LINKS_KEY);
    setMode("browser");
  };

  const openHub = () => {
    if (browser.expanded) browser.toggleExpanded();
    setMode("hub");
  };

  const lastSource = useMemo(
    () => FIXED_SOURCES.find((source) => source.key === lastSourceKey) ?? null,
    [lastSourceKey],
  );

  if (isBigScreen) {
    return <WebLinksBigScreen game={game} />;
  }

  if (mode === "hub") {
    const categoryItems = SOURCE_CATEGORIES.filter(
      (category) => category.key !== "all",
    ).map((category) => ({
      id: category.key,
      label: t(category.i18nKey),
    }));

    return (
      <GameTabShell
        eyebrow={t("weblinks.hub.eyebrow")}
        title={t("game.tab.weblinks")}
        description={t("weblinks.hub.summary", {
          game: game.name,
          sources: FIXED_SOURCES.length,
          links: browser.customLinks.length,
        })}
        icon={<Link2 size={20} />}
        actions={
          browser.editable ? (
            <Button variant="secondary" size="sm" onClick={openManager}>
              {t("weblinks.hub.manage")}
            </Button>
          ) : undefined
        }
        toolbar={
          <GameTabToolbar
            search={
              <GameTabSearch
                value={hubSearch}
                onChange={setHubSearch}
                placeholder={t("weblinks.hub.searchPlaceholder")}
                label={t("weblinks.hub.searchPlaceholder")}
                clearLabel={t("weblinks.hub.clearSearch")}
              />
            }
            filters={
              <GameTabChips
                items={[
                  { id: "all" as SourceCategoryKey, label: t("weblinks.categories.all") },
                  ...categoryItems,
                ]}
                value={state.category}
                onChange={(category) => setState({ category })}
                ariaLabel={t("weblinks.filterByCategory")}
              />
            }
          />
        }
      >
        <WebLinksHub
          game={game}
          sources={FIXED_SOURCES}
          customLinks={browser.parsedCustomLinks}
          activeCategory={state.category}
          query={hubSearch}
          lastSource={lastSource}
          appId={browser.appId}
          editable={browser.editable}
          onOpenSource={(source) => openSource(source.key)}
          onOpenCustom={(link) => openSource(link.url)}
          onOpenExternal={(url) => void browser.openExternal(url)}
          onManageLinks={openManager}
        />
      </GameTabShell>
    );
  }

  const addressBar = (
    <WebLinksAddressBar
      currentUrl={browser.displayUrl}
      activeSourceDef={browser.activeSourceDef}
      navState={browser.navState}
      onGoBack={browser.goBack}
      onGoForward={browser.goForward}
      onReload={browser.reload}
      onHome={browser.home}
      onOpenHub={openHub}
      onDismissCookies={browser.dismissCookies}
      onNavigate={browser.navigate}
      onOpenExternal={browser.openExternal}
      onPinCustomLink={browser.editable ? browser.pinCustomLink : undefined}
      isPinned={browser.isCurrentUrlPinned}
      zoomLevel={browser.zoomLevel}
      onZoomIn={browser.zoomIn}
      onZoomOut={browser.zoomOut}
      onZoomReset={browser.zoomReset}
      expanded={browser.expanded}
      onToggleExpand={browser.toggleExpanded}
    />
  );

  return (
    <div className="wl-tab">
      <WebLinksSourceStrip
        sources={browser.filteredSources}
        activeSourceKey={browser.activeSourceKey}
        onSelectSource={openSource}
        customLinksCount={browser.customLinks.length}
        showMyLinksTab={true}
        activeCategory={browser.activeCategory}
        onSelectCategory={browser.handleSelectCategory}
        counts={browser.categoryCounts}
        onMenuOpenChange={browser.setCategoryMenuOpen}
      />

      {browser.isSteamActive && (
        <WebLinksSteamSections
          activeSection={browser.steamSection}
          onSelectSection={browser.setSteamSection}
          appId={browser.appId}
          onAttachAppId={browser.setAppIdOverride}
        />
      )}

      {browser.isMyLinksManagerActive && (
        <MyLinksManager
          game={game}
          customLinks={browser.customLinks}
          activePreviewUrl={browser.displayUrl}
          editable={browser.editable}
          onSelectPreviewUrl={browser.selectPreviewUrl}
          onOpenExternal={browser.openExternal}
          onWebsitesChange={onWebsitesChange}
        />
      )}

      {browser.hasPreviewableUrl && addressBar}

      {browser.hasPreviewableUrl && (
        <WebLinksWebview
          url={browser.webviewUrl}
          game={game}
          visible={visible}
          activeSourceDef={browser.activeSourceDef}
          activeSteamSection={
            browser.isSteamActive
              ? {
                  key: browser.steamSection,
                  label: browser.steamSection,
                  i18nKey: `weblinks.steam.${browser.steamSection}`,
                  icon: browser.activeSourceDef.icon,
                }
              : undefined
          }
          steamSubDisabled={browser.steamSubDisabled}
          isSteamSearchFallback={browser.isSteamSearchFallback}
          reloadNonce={browser.reloadNonce}
          zoomLevel={browser.zoomLevel}
          expanded={browser.expanded}
          expandedFrameRef={browser.expandedFrameRef}
          onWebviewReadyChange={browser.setModalWebviewReady}
          onUrlChange={browser.setCurrentNavUrl}
          onNavStateChange={browser.setNavState}
          onWebviewLabelChange={browser.setActiveWebviewLabel}
          onOpenExternal={browser.openExternal}
          menuOpen={browser.categoryMenuOpen}
        />
      )}

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
        <button type="button" className="wl-footnote__hub" onClick={openHub}>
          {t("weblinks.hub.back")}
        </button>
      </div>

      {browser.expanded &&
        browser.hasPreviewableUrl &&
        createPortal(
          <div
            className="wl-expand-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t("weblinks.expandView")}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) browser.toggleExpanded();
            }}
          >
            <div className="wl-expand-modal">
              <div className="wl-expand-toolbar">
                {addressBar}
                <button
                  className="wl-expand-close"
                  onClick={browser.toggleExpanded}
                  type="button"
                  title={t("weblinks.closeExpand")}
                  aria-label={t("weblinks.closeExpand")}
                >
                  <CloseIcon />
                </button>
              </div>
              <div ref={browser.expandedFrameRef} className="wl-expand-frame">
                {!browser.modalWebviewReady && (
                  <div className="wl-webview-loader" aria-hidden>
                    <div className="wl-webview-spinner" />
                    <span>
                      {t("weblinks.loading", { source: browser.activeSourceDef.label })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
