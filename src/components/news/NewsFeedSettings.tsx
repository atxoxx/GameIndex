import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { NewsFeed, FeedHealthStatus } from "../../hooks/useNewsFeeds";
import { DEFAULT_FEEDS, CURATED_FEED_PACKS, getRegionalFeeds, discoverFeedUrl } from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";

interface NewsFeedSettingsProps {
  allFeeds: NewsFeed[];
  enabledFeedUrls: Set<string>;
  customFeeds: NewsFeed[];
  failedFeedsList?: string[];
  feedHealthMap?: Map<string, FeedHealthStatus>;
  testingHealth?: boolean;
  onToggleFeed: (url: string) => void;
  onAddFeed: (name: string, url: string, category?: string) => void;
  onImportPack?: (packId: string) => void;
  onRemoveFeed: (url: string) => void;
  onExportOpml: () => void;
  onImportOpml: (file: File) => void;
  onExportSavedMarkdown?: () => void;
  onTestFeedHealth?: () => void;
  onClose: () => void;
}

export default function NewsFeedSettings({
  allFeeds,
  enabledFeedUrls,
  customFeeds,
  failedFeedsList = [],
  feedHealthMap = new Map(),
  testingHealth = false,
  onToggleFeed,
  onAddFeed,
  onImportPack,
  onRemoveFeed,
  onExportOpml,
  onImportOpml,
  onExportSavedMarkdown,
  onTestFeedHealth,
  onClose,
}: NewsFeedSettingsProps) {
  const { t, language } = useLanguage();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [feedCategory, setFeedCategory] = useState("general");
  const [addError, setAddError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const opmlInputRef = useRef<HTMLInputElement>(null);
  const regionalFeeds = getRegionalFeeds(language);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleAdd = () => {
    setAddError(null);

    const trimmedName = name.trim();
    let trimmedUrl = url.trim();

    if (!trimmedName || !trimmedUrl) {
      setAddError(t("news.feedErrorNameUrl"));
      return;
    }

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = "https://" + trimmedUrl;
    }

    try {
      new URL(trimmedUrl);
    } catch {
      setAddError(t("news.feedErrorInvalidUrl"));
      return;
    }

    const allUrls = [
      ...DEFAULT_FEEDS.map((f) => f.url),
      ...regionalFeeds.map((f) => f.url),
      ...customFeeds.map((f) => f.url),
    ];
    if (allUrls.some((u) => u.toLowerCase() === trimmedUrl.toLowerCase())) {
      setAddError(t("news.feedErrorDuplicate"));
      return;
    }

    onAddFeed(trimmedName, trimmedUrl, feedCategory);
    setName("");
    setUrl("");
  };

  const handleDiscover = async () => {
    let homepage = url.trim();
    if (!homepage) {
      setAddError(t("news.feedErrorPasteUrl"));
      return;
    }
    if (!/^https?:\/\//i.test(homepage)) homepage = "https://" + homepage;
    setDiscovering(true);
    setAddError(null);
    try {
      const feedUrl = await discoverFeedUrl(homepage);
      if (feedUrl) {
        setUrl(feedUrl);
        if (!name.trim()) {
          try {
            setName(new URL(homepage).hostname.replace(/^www\./, ""));
          } catch {
            /* keep empty name */
          }
        }
      } else {
        setAddError(t("news.feedErrorNoFeed"));
      }
    } catch {
      setAddError(t("news.feedErrorUnreachable"));
    } finally {
      setDiscovering(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const filteredDefaults = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return DEFAULT_FEEDS;
    return DEFAULT_FEEDS.filter((f) => f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q));
  }, [searchFilter]);

  const filteredCustoms = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return customFeeds;
    return customFeeds.filter((f) => f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q));
  }, [customFeeds, searchFilter]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("news.feedSettingsTitle")}
    >
      <div className="modal news-feed-settings-modal">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">{t("news.feedSettingsTitle")}</h2>
            <p className="modal-subtitle">
              {t("news.feedSettingsSubtitle")}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="news-feed-settings-body">
          {/* Failed Feeds Diagnostic Banner */}
          {failedFeedsList.length > 0 && (
            <div className="news-feed-warning-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>
                {t("news.failedFeedsWarning", { count: failedFeedsList.length, names: failedFeedsList.join(", ") })}
              </span>
            </div>
          )}

          {/* Diagnostics Bar */}
          <div className="news-feed-diagnostics-bar">
            <button
              type="button"
              className="news-feed-diagnostics-btn"
              onClick={onTestFeedHealth}
              disabled={testingHealth}
            >
              {testingHealth ? (
                <>
                  <span className="news-feed-test-spinner" />
                  {t("news.testingFeeds")}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  {t("news.testFeeds")}
                </>
              )}
            </button>
            <span className="news-feed-diagnostics-hint">{t("news.diagnosticsHint")}</span>
          </div>

          {/* Curated Preset Packs */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              {t("news.curatedPacksTitle")}
            </h3>
            <div className="news-feed-packs-grid">
              {CURATED_FEED_PACKS.map((pack) => {
                const alreadyAdded = pack.feeds.every((f) =>
                  allFeeds.some((af) => af.url.toLowerCase() === f.url.toLowerCase())
                );
                return (
                  <div key={pack.id} className="news-feed-pack-card">
                    <div className="news-feed-pack-header">
                      <span className="news-feed-pack-icon">{pack.icon}</span>
                      <div className="news-feed-pack-info">
                        <div className="news-feed-pack-name">{t(pack.nameKey)}</div>
                        <div className="news-feed-pack-desc">{t(pack.descKey)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`news-feed-pack-btn ${alreadyAdded ? "added" : ""}`}
                      onClick={() => onImportPack?.(pack.id)}
                      disabled={alreadyAdded}
                    >
                      {alreadyAdded ? t("news.packAdded") : t("news.packAdd")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Feed Search Filter */}
          <div className="news-feed-search-row">
            <input
              type="search"
              className="news-feed-input"
              placeholder={t("news.searchFeedsPlaceholder")}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>

          {/* Default feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              {t("news.internationalFeeds")}
              <span className="news-feed-settings-count">
                {t("news.feedsEnabled", { enabled: DEFAULT_FEEDS.filter((f) => enabledFeedUrls.has(f.url)).length, total: DEFAULT_FEEDS.length })}
              </span>
            </h3>
            {filteredDefaults.map((feed) => {
              const isEnabled = enabledFeedUrls.has(feed.url);
              const health = feedHealthMap.get(feed.url);
              return (
                <div key={feed.url} className="news-feed-default-item">
                  <div className="news-feed-default-icon">
                    {feed.name.charAt(0)}
                  </div>
                  <div className="news-feed-default-info">
                    <div className="news-feed-name-row">
                      <span className="news-feed-default-name">{feed.name}</span>
                      {health && (
                        <span className={`news-feed-health-chip ${health.status}`}>
                          {health.status === "ok" ? "🟢" : health.status === "slow" ? "🟡" : "🔴"} {health.latencyMs}ms
                        </span>
                      )}
                    </div>
                    <div className="news-feed-default-url" title={feed.url}>
                      {feed.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`news-source-pill news-feed-item-toggle${isEnabled ? " active" : ""}`}
                    onClick={() => onToggleFeed(feed.url)}
                    title={isEnabled ? t("news.disableFeed", { name: feed.name }) : t("news.enableFeed", { name: feed.name })}
                  >
                    {isEnabled ? t("news.on") : t("news.off")}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Regional feeds (per active UI language) */}
          {regionalFeeds.length > 0 && (
            <div className="news-feed-settings-section">
              <h3 className="news-feed-settings-section-title">
                {t("news.regionalFeeds")}
                <span className="news-feed-settings-count">
                  {t("news.feedsEnabled", { enabled: regionalFeeds.filter((f) => enabledFeedUrls.has(f.url)).length, total: regionalFeeds.length })}
                </span>
              </h3>
              <p className="news-feed-opml-hint">{t("news.regionalFeedsHint")}</p>
              {regionalFeeds.map((feed) => {
                const isEnabled = enabledFeedUrls.has(feed.url);
                const health = feedHealthMap.get(feed.url);
                return (
                  <div key={feed.url} className="news-feed-default-item">
                    <div className="news-feed-default-icon">
                      {feed.name.charAt(0)}
                    </div>
                    <div className="news-feed-default-info">
                      <div className="news-feed-name-row">
                        <span className="news-feed-default-name">{feed.name}</span>
                        {health && (
                          <span className={`news-feed-health-chip ${health.status}`}>
                            {health.status === "ok" ? "🟢" : health.status === "slow" ? "🟡" : "🔴"} {health.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <div className="news-feed-default-url" title={feed.url}>
                        {feed.url}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`news-source-pill news-feed-item-toggle${isEnabled ? " active" : ""}`}
                      onClick={() => onToggleFeed(feed.url)}
                      title={isEnabled ? t("news.disableFeed", { name: feed.name }) : t("news.enableFeed", { name: feed.name })}
                    >
                      {isEnabled ? t("news.on") : t("news.off")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              {t("news.customFeeds")}
              {customFeeds.length > 0 && ` (${customFeeds.length})`}
            </h3>
            {filteredCustoms.length === 0 ? (
              <p className="news-feed-error news-feed-empty-hint">
                {t("news.noCustomFeeds")}
              </p>
            ) : (
              filteredCustoms.map((feed) => {
                const isEnabled = enabledFeedUrls.has(feed.url);
                const health = feedHealthMap.get(feed.url);
                return (
                  <div key={feed.url} className="news-feed-custom-item">
                    <div className="news-feed-custom-info">
                      <div className="news-feed-name-row">
                        <span className="news-feed-custom-name">{feed.name}</span>
                        {health && (
                          <span className={`news-feed-health-chip ${health.status}`}>
                            {health.status === "ok" ? "🟢" : health.status === "slow" ? "🟡" : "🔴"} {health.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <div className="news-feed-custom-url" title={feed.url}>
                        {feed.url}
                      </div>
                    </div>
                    <div className="news-feed-custom-actions">
                      <button
                        type="button"
                        className={`news-source-pill news-feed-item-toggle${isEnabled ? " active" : ""}`}
                        onClick={() => onToggleFeed(feed.url)}
                      >
                        {isEnabled ? t("news.on") : t("news.off")}
                      </button>
                      <button
                        type="button"
                        className="news-feed-remove-btn"
                        title={t("sourceManager.removeSourceLabel", { source: feed.name })}
                        aria-label={t("sourceManager.removeSourceLabel", { source: feed.name })}
                        onClick={() => onRemoveFeed(feed.url)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add feed form */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">{t("news.addCustomFeed")}</h3>
            <div className="news-feed-add-form">
              <div className="news-feed-add-row">
                <input
                  type="text"
                  className="news-feed-input"
                  placeholder={t("news.feedNamePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  maxLength={40}
                />
                <input
                  type="url"
                  className="news-feed-input"
                  placeholder={t("news.feedUrlPlaceholder")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
                <select
                  className="news-feed-select"
                  value={feedCategory}
                  onChange={(e) => setFeedCategory(e.target.value)}
                >
                  <option value="general">{t("news.catGeneral")}</option>
                  <option value="pc">{t("news.tabPc")}</option>
                  <option value="console">{t("news.tabConsole")}</option>
                  <option value="tech">{t("news.tabTech")}</option>
                  <option value="indie">{t("news.tabIndie")}</option>
                  <option value="deals">{t("news.tabDeals")}</option>
                  <option value="esports">{t("news.tabEsports")}</option>
                </select>
              </div>
              {addError && <p className="news-feed-error">{addError}</p>}
              <div className="news-feed-add-actions">
                <button
                  type="button"
                  className="news-feed-add-btn"
                  onClick={handleAdd}
                  disabled={!name.trim() || !url.trim()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t("news.addFeed")}
                </button>
                <button
                  type="button"
                  className="news-feed-discover-btn"
                  onClick={handleDiscover}
                  disabled={discovering}
                  title={t("news.discoverTitle")}
                >
                  {discovering ? t("news.discovering") : t("news.discoverFromUrl")}
                </button>
              </div>
            </div>
          </div>

          {/* OPML backup / restore & Markdown export */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">{t("news.opmlTitle")}</h3>
            <p className="news-feed-opml-hint">{t("news.opmlHint")}</p>
            <div className="news-feed-opml-actions">
              <button
                type="button"
                className="news-feed-opml-btn"
                onClick={onExportOpml}
                title={t("newsPage.exportOpml")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t("newsPage.exportOpml")}
              </button>
              <button
                type="button"
                className="news-feed-opml-btn"
                onClick={() => opmlInputRef.current?.click()}
                title={t("newsPage.importOpml")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {t("newsPage.importOpml")}
              </button>

              {onExportSavedMarkdown && (
                <button
                  type="button"
                  className="news-feed-opml-btn"
                  onClick={onExportSavedMarkdown}
                  title={t("news.exportBookmarksMd")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
                  {t("news.exportBookmarksMd")}
                </button>
              )}

              <input
                ref={opmlInputRef}
                type="file"
                accept=".opml,application/xml,text/xml"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportOpml(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <span className="modal-footer-count">
            {t("news.feedCounts", { international: DEFAULT_FEEDS.length, regional: regionalFeeds.length, custom: customFeeds.length })}
          </span>
          <div className="modal-footer-actions">
            <button
              type="button"
              className="edit-btn edit-btn-secondary"
              onClick={onClose}
            >
              {t("editImage.done")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
