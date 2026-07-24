import { useState, useCallback, useEffect } from "react";
import type { NewsFeed } from "../../hooks/useNewsFeeds";
import { DEFAULT_FEEDS, discoverFeedUrl } from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";

interface NewsFeedSettingsProps {
  allFeeds: NewsFeed[];
  enabledFeedUrls: Set<string>;
  customFeeds: NewsFeed[];
  onToggleFeed: (url: string) => void;
  onAddFeed: (name: string, url: string) => void;
  onRemoveFeed: (url: string) => void;
  onClose: () => void;
}

export default function NewsFeedSettings({
  allFeeds,
  enabledFeedUrls,
  customFeeds,
  onToggleFeed,
  onAddFeed,
  onRemoveFeed,
  onClose,
}: NewsFeedSettingsProps) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Close on Escape
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

    // Ensure URL has a protocol
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = "https://" + trimmedUrl;
    }

    // Validate URL format
    try {
      new URL(trimmedUrl);
    } catch {
      setAddError(t("news.feedErrorInvalidUrl"));
      return;
    }

    // Check for duplicates
    const allUrls = [
      ...DEFAULT_FEEDS.map((f) => f.url),
      ...customFeeds.map((f) => f.url),
    ];
    if (allUrls.some((u) => u.toLowerCase() === trimmedUrl.toLowerCase())) {
      setAddError(t("news.feedErrorDuplicate"));
      return;
    }

    onAddFeed(trimmedName, trimmedUrl);
    setName("");
    setUrl("");
  };

  // Auto-discover a feed URL from a homepage (#9)
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
          {/* Default feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              {t("news.defaultFeeds")}
              <span style={{ fontWeight: 400, textTransform: "none", marginLeft: "auto", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                {t("news.feedsEnabled", { enabled: allFeeds.filter((f) => f.isDefault && enabledFeedUrls.has(f.url)).length, total: DEFAULT_FEEDS.length })}
              </span>
            </h3>
            {DEFAULT_FEEDS.map((feed) => {
              const isEnabled = enabledFeedUrls.has(feed.url);
              return (
                <div key={feed.url} className="news-feed-default-item">
                  <div className="news-feed-default-icon">
                    {feed.name.charAt(0)}
                  </div>
                  <div className="news-feed-default-info">
                    <div className="news-feed-default-name">{feed.name}</div>
                    <div className="news-feed-default-url" title={feed.url}>
                      {feed.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`news-source-pill${isEnabled ? " active" : ""}`}
                    style={{ fontSize: "10px", padding: "2px 10px" }}
                    onClick={() => onToggleFeed(feed.url)}
                    title={isEnabled ? t("news.disableFeed", { name: feed.name }) : t("news.enableFeed", { name: feed.name })}
                  >
                    {isEnabled ? t("news.on") : t("news.off")}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Custom feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              {t("news.customFeeds")}
              {customFeeds.length > 0 && ` (${customFeeds.length})`}
            </h3>
            {customFeeds.length === 0 ? (
              <p
                className="news-feed-error"
                style={{ color: "var(--color-text-muted)", marginTop: 0 }}
              >
                {t("news.noCustomFeeds")}
              </p>
            ) : (
              customFeeds.map((feed) => (
                <div key={feed.url} className="news-feed-custom-item">
                  <div className="news-feed-custom-info">
                    <div className="news-feed-custom-name">{feed.name}</div>
                    <div className="news-feed-custom-url" title={feed.url}>
                      {feed.url}
                    </div>
                  </div>
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
              ))
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
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <span className="modal-footer-count">
            {t("news.feedCounts", { default: DEFAULT_FEEDS.length, custom: customFeeds.length })}
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
