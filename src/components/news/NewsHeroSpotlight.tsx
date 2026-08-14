import { useState, useEffect, useMemo, useCallback } from "react";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";

interface NewsHeroSpotlightProps {
  articles: NewsArticle[];
  readLinks: Set<string>;
  savedLinks: Set<string>;
  activeTag: string | null;
  onSelectArticle: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  onSelectTag: (tag: string | null) => void;
}

const ROTATION_INTERVAL_MS = 7000;
const MAX_SPOTLIGHT_ITEMS = 5;

export default function NewsHeroSpotlight({
  articles,
  readLinks,
  savedLinks,
  activeTag,
  onSelectArticle,
  onToggleSave,
  onSelectTag,
}: NewsHeroSpotlightProps) {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  // Pick top spotlight articles with valid images and non-empty titles
  const spotlightArticles = useMemo(() => {
    const withImages = articles.filter((a) => a.imageUrl && a.title.trim().length > 0);
    const pool = withImages.length >= 3 ? withImages : articles;
    return pool.slice(0, MAX_SPOTLIGHT_ITEMS);
  }, [articles]);

  // Extract dynamic trending tags from all articles
  const trendingTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    const tagPatterns: { tag: string; re: RegExp }[] = [
      { tag: "Steam", re: /\bsteam\b/i },
      { tag: "PlayStation", re: /\b(playstation|ps5|ps4|sony)\b/i },
      { tag: "Xbox", re: /\b(xbox|game pass|microsoft)\b/i },
      { tag: "Nintendo", re: /\b(nintendo|switch|mario|zelda|pokemon)\b/i },
      { tag: "PC", re: /\b(pc gaming|steam deck|rtx|geforce|radeon)\b/i },
      { tag: "Hardware", re: /\b(hardware|gpu|cpu|nvidia|amd|intel)\b/i },
      { tag: "Indie", re: /\bindie\b/i },
      { tag: "Deals", re: /\b(deal|discount|free|giveaway|sale)\b/i },
      { tag: "Patch", re: /\b(patch|update|hotfix|notes)\b/i },
      { tag: "Review", re: /\b(review|score|verdict)\b/i },
      { tag: "RPG", re: /\b(rpg|jrpg|role-playing)\b/i },
      { tag: "Esports", re: /\b(esports|tournament|championship)\b/i },
    ];

    for (const a of articles) {
      const text = (a.title + " " + (a.description || "")).toLowerCase();
      for (const { tag, re } of tagPatterns) {
        if (re.test(text)) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }

    return Array.from(tagCounts.entries())
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [articles]);

  // Auto-advance timer
  useEffect(() => {
    if (spotlightArticles.length <= 1 || isPaused) return;

    setProgress(0);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / ROTATION_INTERVAL_MS) * 100);
      setProgress(pct);

      if (elapsed >= ROTATION_INTERVAL_MS) {
        setActiveIndex((prev) => (prev + 1) % spotlightArticles.length);
        setProgress(0);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [spotlightArticles.length, activeIndex, isPaused]);

  const activeArticle = spotlightArticles[activeIndex] ?? spotlightArticles[0];

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + spotlightArticles.length) % spotlightArticles.length);
    setProgress(0);
  }, [spotlightArticles.length]);

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % spotlightArticles.length);
    setProgress(0);
  }, [spotlightArticles.length]);

  if (!activeArticle || spotlightArticles.length === 0) {
    return null;
  }

  const isSaved = savedLinks.has(activeArticle.link);
  const isRead = readLinks.has(activeArticle.link);
  const readTime = estimateReadingTime(
    (activeArticle.content || activeArticle.description || "") + " " + activeArticle.title
  );

  return (
    <div
      className="news-hero-spotlight"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background ambient glow & image */}
      <div className="news-hero-bg-container">
        {activeArticle.imageUrl ? (
          <img
            src={activeArticle.imageUrl}
            alt=""
            className="news-hero-bg-image"
            loading="eager"
          />
        ) : (
          <div className="news-hero-bg-fallback" />
        )}
        <div className="news-hero-overlay" />
      </div>

      {/* Progress track */}
      {spotlightArticles.length > 1 && (
        <div className="news-hero-progress-track">
          <div
            className="news-hero-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Hero content layout */}
      <div className="news-hero-content">
        <div className="news-hero-main-info">
          {/* Eyebrow & Badges */}
          <div className="news-hero-badges">
            <span className="news-hero-featured-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {t("news.featured")}
            </span>
            <span className="news-hero-source-chip">{activeArticle.sourceName}</span>
            {activeArticle.pubDate && (
              <span className="news-hero-date-chip">{formatArticleDate(activeArticle.pubDate)}</span>
            )}
            <span className="news-hero-readtime-chip">⏱ {readTime} min read</span>
            {!isRead && <span className="news-hero-unread-dot" title={t("news.statsUnread")} />}
          </div>

          {/* Headline */}
          <h2
            className="news-hero-title"
            onClick={() => onSelectArticle(activeArticle)}
            title={activeArticle.title}
          >
            {activeArticle.title}
          </h2>

          {/* Snippet description */}
          {activeArticle.description && (
            <p className="news-hero-snippet">{activeArticle.description}</p>
          )}

          {/* Hero Actions */}
          <div className="news-hero-actions">
            <button
              type="button"
              className="news-hero-read-btn"
              onClick={() => onSelectArticle(activeArticle)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {t("news.readNow")}
            </button>

            <button
              type="button"
              className={`news-hero-bookmark-btn ${isSaved ? "saved" : ""}`}
              onClick={() => onToggleSave(activeArticle)}
              title={isSaved ? t("news.removeBookmark") : t("news.saveForLater")}
              aria-label={isSaved ? t("news.removeBookmark") : t("news.saveForLater")}
            >
              <svg viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {isSaved ? t("news.saved") : t("common.save")}
            </button>

            {/* Carousel Navigation Arrows */}
            {spotlightArticles.length > 1 && (
              <div className="news-hero-nav-arrows">
                <button
                  type="button"
                  className="news-hero-arrow-btn"
                  onClick={handlePrev}
                  title="Previous story"
                  aria-label="Previous story"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="news-hero-counter">
                  {activeIndex + 1} / {spotlightArticles.length}
                </span>
                <button
                  type="button"
                  className="news-hero-arrow-btn"
                  onClick={handleNext}
                  title="Next story"
                  aria-label="Next story"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Thumbnail Selector Strip on right/bottom */}
        {spotlightArticles.length > 1 && (
          <div className="news-hero-thumbnail-list" role="tablist" aria-label="Spotlight stories">
            {spotlightArticles.map((art, idx) => (
              <button
                key={`${art.link}-${idx}`}
                type="button"
                role="tab"
                aria-selected={idx === activeIndex}
                className={`news-hero-thumbnail-item ${idx === activeIndex ? "active" : ""}`}
                onClick={() => {
                  setActiveIndex(idx);
                  setProgress(0);
                }}
              >
                <div className="news-hero-thumb-img-wrapper">
                  {art.imageUrl ? (
                    <img src={art.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="news-hero-thumb-placeholder">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="news-hero-thumb-text">
                  <span className="news-hero-thumb-source">{art.sourceName}</span>
                  <span className="news-hero-thumb-title">{art.title}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Trending Topics Cloud Bar */}
      {trendingTags.length > 0 && (
        <div className="news-hero-trending-bar">
          <span className="news-hero-trending-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            {t("news.trendingTopics")}
          </span>
          <div className="news-hero-tag-pills">
            {trendingTags.map(([tag, count]) => {
              const isSelected = activeTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  className={`news-hero-tag-pill ${isSelected ? "active" : ""}`}
                  onClick={() => onSelectTag(isSelected ? null : tag)}
                >
                  #{tag}
                  <span className="news-hero-tag-count">{count}</span>
                </button>
              );
            })}
            {activeTag && (
              <button
                type="button"
                className="news-hero-tag-clear"
                onClick={() => onSelectTag(null)}
                title={t("common.clear")}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
