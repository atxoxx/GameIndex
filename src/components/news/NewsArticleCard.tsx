import { useMemo } from "react";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../hooks/useNewsFeeds";
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
}

export default function NewsArticleCard({
  article,
  onClick,
  onToggleSave,
  onToggleRead,
  density = "cozy",
  read = false,
  saved = false,
  relatedGameName = null,
}: NewsArticleCardProps) {
  const { t } = useLanguage();
  const isList = density === "list";
  const showBody = density !== "compact";

  const readTimeMinutes = useMemo(() => {
    const text = (article.content || article.description || "") + " " + article.title;
    return estimateReadingTime(text);
  }, [article.content, article.description, article.title]);

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave?.(article);
  };

  const handleReadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleRead?.(article);
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
                ".news-card-cover-placeholder",
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
        </div>
      </div>

      {showBody && (
        <div className="news-card-body">
          {relatedGameName && (
            <span className="news-card-related-badge" title={t("news.relatedToGame", { game: relatedGameName })}>
              🎮 {relatedGameName}
            </span>
          )}

          <h3 className="news-card-title" title={article.title}>
            {article.title}
          </h3>

          {article.description && (
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
export function NewsArticleCardSkeleton({ density = "cozy" }: { density?: ViewDensity }) {
  const showBody = density !== "compact";
  const isList = density === "list";
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
