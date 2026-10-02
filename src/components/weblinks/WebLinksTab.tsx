import { createPortal } from "react-dom";
import { useBigScreen } from "../../context/BigScreenContext";
import { useLanguage } from "../../context/LanguageContext";
import { CloseIcon } from "./WebLinksIcons";
import WebLinksSourceStrip from "./WebLinksSourceStrip";
import WebLinksSteamSections from "./WebLinksSteamSections";
import WebLinksAddressBar from "./WebLinksAddressBar";
import WebLinksWebview from "./WebLinksWebview";
import MyLinksManager from "./MyLinksManager";
import WebLinksBigScreen from "./WebLinksBigScreen";
import { useWebLinksBrowser } from "./useWebLinksBrowser";
import type { WebLinksTabProps } from "./types";

export default function WebLinksTab({
  game,
  visible = true,
  onWebsitesChange,
}: WebLinksTabProps) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const browser = useWebLinksBrowser({ game, visible, onWebsitesChange });

  if (isBigScreen) {
    return <WebLinksBigScreen game={game} />;
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
      {/* ─── 1. Source Tabs Strip with inline category filter ──────── */}
      <WebLinksSourceStrip
        sources={browser.filteredSources}
        activeSourceKey={browser.activeSourceKey}
        onSelectSource={browser.setActiveSourceKey}
        customLinksCount={browser.customLinks.length}
        showMyLinksTab={true}
        activeCategory={browser.activeCategory}
        onSelectCategory={browser.handleSelectCategory}
        counts={browser.categoryCounts}
        onMenuOpenChange={browser.setCategoryMenuOpen}
      />

      {/* ─── 2. Steam Sub-Sections (When Steam is selected) ──────────── */}
      {browser.isSteamActive && (
        <WebLinksSteamSections
          activeSection={browser.steamSection}
          onSelectSection={browser.setSteamSection}
          appId={browser.appId}
          onAttachAppId={browser.setAppIdOverride}
        />
      )}

      {/* ─── 3. My Links Custom Manager ─────────────────────────────── */}
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

      {/* ─── 4. Browser Address Bar & Actions Toolbar ───────────────── */}
      {browser.hasPreviewableUrl && addressBar}

      {/* ─── 5. Native Webview Preview Frame ────────────────────────── */}
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
          document.body
        )}
    </div>
  );
}
