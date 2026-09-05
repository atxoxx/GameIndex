import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import type { CustomGameFeed } from "./gameNewsTypes";

interface GameNewsCustomFeedsModalProps {
  gameName: string;
  isOpen: boolean;
  onClose: () => void;
  feeds: CustomGameFeed[];
  onSaveFeeds: (feeds: CustomGameFeed[]) => void;
}

/** Format a user-entered URL or subreddit shorthand into a valid RSS URL */
function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // If user entered e.g. "r/Eldenring" or "r/helldivers2"
  const subMatch = trimmed.match(/^(?:r\/|\/r\/)?([a-zA-Z0-9_]+)$/i);
  if (subMatch) {
    return `https://www.reddit.com/r/${subMatch[1]}/.rss`;
  }

  // If user entered e.g. "https://www.reddit.com/r/Eldenring" without .rss
  if (trimmed.includes("reddit.com/r/") && !trimmed.endsWith(".rss")) {
    return `${trimmed.replace(/\/+$/, "")}/.rss`;
  }

  return trimmed;
}

export default function GameNewsCustomFeedsModal({
  gameName,
  isOpen,
  onClose,
  feeds,
  onSaveFeeds,
}: GameNewsCustomFeedsModalProps) {
  const { t } = useLanguage();
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Suggested subreddit based on game name
  const suggestedSubreddit = useMemo(() => {
    const clean = gameName
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    return clean.length >= 3 ? clean : null;
  }, [gameName]);

  if (!isOpen) return null;

  const handleAddFeed = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normUrl = normalizeFeedUrl(feedUrl);
    if (!normUrl) {
      setError("Please enter a valid URL or subreddit.");
      return;
    }

    if (feeds.some((f) => f.url.toLowerCase() === normUrl.toLowerCase())) {
      setError("This feed URL is already added.");
      return;
    }

    const name = feedName.trim() || (feedUrl.startsWith("r/") ? feedUrl : "Custom Feed");
    const newFeed: CustomGameFeed = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      url: normUrl,
      enabled: true,
    };

    onSaveFeeds([...feeds, newFeed]);
    setFeedName("");
    setFeedUrl("");
  };

  const handleQuickAddSubreddit = (sub: string) => {
    const normUrl = `https://www.reddit.com/r/${sub}/.rss`;
    if (feeds.some((f) => f.url.toLowerCase() === normUrl.toLowerCase())) return;

    const newFeed: CustomGameFeed = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: `Reddit r/${sub}`,
      url: normUrl,
      enabled: true,
    };
    onSaveFeeds([...feeds, newFeed]);
  };

  const handleToggleFeed = (id: string) => {
    onSaveFeeds(
      feeds.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f))
    );
  };

  const handleDeleteFeed = (id: string) => {
    onSaveFeeds(feeds.filter((f) => f.id !== id));
  };

  return createPortal(
    <div className="game-news-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="game-news-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="game-news-modal-header">
          <div className="game-news-modal-header-text">
            <h3>{t("game.news.customFeedsTitle")}</h3>
            <p>{t("game.news.customFeedsDesc", { game: gameName })}</p>
          </div>
          <button
            type="button"
            className="game-news-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="game-news-modal-body">
          {/* Quick Subreddit shortcut if available */}
          {suggestedSubreddit &&
            !feeds.some((f) => f.url.includes(suggestedSubreddit)) && (
              <div className="game-news-quick-subreddit">
                <span>Quick Suggestion:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleQuickAddSubreddit(suggestedSubreddit)}
                  leftIcon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  }
                >
                  {t("game.news.addSubredditQuick", { sub: suggestedSubreddit })}
                </Button>
              </div>
            )}

          {/* Add form */}
          <form className="game-news-add-feed-form" onSubmit={handleAddFeed}>
            <div className="game-news-form-row">
              <div className="game-news-form-field">
                <label>{t("game.news.feedName")}</label>
                <input
                  type="text"
                  placeholder="e.g. Official Dev Blog or Reddit"
                  value={feedName}
                  onChange={(e) => setFeedName(e.target.value)}
                />
              </div>

              <div className="game-news-form-field flex-2">
                <label>{t("game.news.feedUrl")}</label>
                <input
                  type="text"
                  placeholder={t("game.news.feedUrlPlaceholder")}
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                />
              </div>

              <div className="game-news-form-action">
                <Button variant="primary" size="sm" type="submit">
                  {t("game.news.addFeed")}
                </Button>
              </div>
            </div>
            {error && <p className="game-news-form-error">{error}</p>}
          </form>

          {/* Existing feeds list */}
          <div className="game-news-custom-feeds-list">
            {feeds.length === 0 ? (
              <div className="game-news-no-custom-feeds">
                <p>{t("game.news.noCustomFeeds")}</p>
              </div>
            ) : (
              feeds.map((feed) => (
                <div key={feed.id} className="game-news-custom-feed-item">
                  <div className="game-news-custom-feed-info">
                    <strong>{feed.name}</strong>
                    <span title={feed.url}>{feed.url}</span>
                  </div>

                  <div className="game-news-custom-feed-controls">
                    <button
                      type="button"
                      className={`game-news-toggle-btn ${feed.enabled ? "is-enabled" : ""}`}
                      onClick={() => handleToggleFeed(feed.id)}
                      title={feed.enabled ? "Disable feed" : "Enable feed"}
                    >
                      {feed.enabled ? "Enabled" : "Disabled"}
                    </button>

                    <button
                      type="button"
                      className="game-news-delete-btn"
                      onClick={() => handleDeleteFeed(feed.id)}
                      title="Remove feed"
                      aria-label="Remove feed"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="game-news-modal-footer">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.done") || "Done"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
