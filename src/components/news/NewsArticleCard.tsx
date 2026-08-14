import { useMemo, useState } from "react";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime, extractArticleTags } from "../../hooks/useNewsFeeds";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

interface NewsArticleCardProps {
  article: NewsArticle;
  onClick: (article: NewsArticle) => void;
  onToggleSave?: (article: NewsArticle) => void;
  onToggleRead?: (article: NewsArticle) => void;
  density?: ViewDensity;
  read?: boolean;
  saved?: boolean;
  relatedGameName?: string | null;
  onSelectTag?: (tag: string) => void;
}

export default function NewsArticleCard({
  article,
  onClick,
  onToggleSave,
  onToggleRead,
  density = "cinematic",
  read = false,
  saved = false,
  relatedGameName = null,
  onSelectTag,
}: NewsArticleCardProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const isList = density === "list";
  const isCompact = density === "compact";
  const showBody = !isCompact || isList;

  const readTimeMinutes = useMemo(() => {
    const text = (article.content || article.description || "") + " " + article.title;
    return estimateReadingTime(text);
  }, [article.content, article.description, article.title]);

  const tags = useMemo(() => {
    return extractArticleTags(article).slice(0, 3);
  }, [article]);

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave?.(article);
  };

  const handleReadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleRead?.(article);
  };

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(article.link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <article
      className={`news-article-card density-${density}${isList ? " news-article-card-list" : ""}${
        read ? " is-read" : ""
      }`}
      onClick={() => onClick(article)}
      role="button"
      tabIndex={0}
      aria-label={t("news.readArticle", { title: article.title })}
      data-density={density}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(article);
        }
      }}
    >
      <div className="news-card-cover">
        {article.imageUrl ? (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const placeholder = target.parentElement?.querySelector(
                ".news-card-cover-placeholder"
              ) as HTMLElement | null;
              if (placeholder) placeholder.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="news-card-cover-placeholder"
          style={{ display: article.imageUrl ? "none" : "flex" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>

        {/* Gradient backdrop overlay for readability in cinematic mode */}
        <div className="news-card-cover-overlay" />

        {/* Source badge */}
        <span className="news-card-source-badge">{article.sourceName}</span>

        {/* Read time badge */}
        <span className="news-card-readtime-badge">
          ⏱ {readTimeMinutes} min
        </span>

        {/* Unread indicator */}
        {!read && <span className="news-card-unread-dot" title={t("news.statsUnread")} />}

        {/* Hover Quick Actions */}
        <div className="news-card-quick-actions">
          {onToggleSave && (
            <button
              type="button"
              className={`news-card-action-btn ${saved ? "active" : ""}`}
              onClick={handleSaveClick}
              title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
              aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
            >
              <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}

          {onToggleRead && (
            <button
              type="button"
              className={`news-card-action-btn ${read ? "is-read" : ""}`}
              onClick={handleReadClick}
              title={read ? t("news.markAsUnread") : t("news.markAsRead")}
              aria-label={read ? t("news.markAsUnread") : t("news.markAsRead")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="news-card-action-btn"
            onClick={handleCopyLink}
            title={copied ? t("gameInfo.copied") : t("news.copyLink")}
            aria-label={t("news.copyLink")}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {showBody && (
        <div className="news-card-body">
          {/* Related game / tags header */}
          <div className="news-card-badges-row">
            {relatedGameName && (
              <span className="news-card-related-badge" title={t("news.relatedToGame", { game: relatedGameName })}>
                🎮 {relatedGameName}
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className="news-card-tag-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTag?.(tag);
                }}
              >
                #{tag}
              </span>
            ))}
          </div>

          <h3 className="news-card-title" title={article.title}>
            {article.title}
          </h3>

          {!isCompact && article.description && (
            <p className="news-card-snippet">{article.description}</p>
          )}

          <div className="news-card-meta">
            <span className="news-card-source-name">{article.sourceName}</span>
            {article.pubDate && (
              <>
                <span className="news-card-meta-dot" aria-hidden="true" />
                <span>{formatArticleDate(article.pubDate)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Skeleton loader for news article cards shown during loading. */
export function NewsArticleCardSkeleton({ density = "cinematic" }: { density?: ViewDensity }) {
  const isList = density === "list";
  const showBody = density !== "compact" || isList;
  return (
    <div
      className={`news-article-card news-article-card-skeleton density-${density}${
        isList ? " news-article-card-list" : ""
      }`}
      aria-hidden="true"
    >
      <div className="news-card-cover-skeleton" />
      {showBody && (
        <div className="news-card-body-skeleton">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-subtitle" />
          <div className="skeleton-line skeleton-subtitle short" />
        </div>
      )}
    </div>
  );
}
