import { useState } from "react";
import type { NewsArticle } from "../../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../../hooks/useNewsFeeds";
import { useLanguage } from "../../../context/LanguageContext";
import {
  classifyArticle,
  extractVersionString,
  type ArticleClassification,
} from "./gameNewsTypes";

interface GameNewsListViewProps {
  articles: NewsArticle[];
  readLinks: Set<string>;
  savedArticles: { link: string }[];
  onOpenArticle: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  onToggleRead: (article: NewsArticle) => void;
}

export default function GameNewsListView({
  articles,
  readLinks,
  savedArticles,
  onOpenArticle,
  onToggleSave,
  onToggleRead,
}: GameNewsListViewProps) {
  const { t } = useLanguage();
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const handleCopy = async (e: React.MouseEvent, link: string) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(link);
        setCopiedLink(link);
        setTimeout(() => setCopiedLink(null), 1500);
      }
    } catch {
      // ignore
    }
  };

  const getBadgeLabel = (cat: ArticleClassification): string => {
    switch (cat) {
      case "patch":
        return t("game.news.patchBadge");
      case "major":
        return t("game.news.majorUpdateBadge");
      case "hotfix":
        return t("game.news.hotfixBadge");
      case "announcement":
        return t("game.news.announcementBadge");
      default:
        return t("game.news.articleBadge");
    }
  };

  return (
    <div className="game-news-list-view" role="list">
      {articles.map((article, index) => {
        const isRead = readLinks.has(article.link);
        const isSaved = savedArticles.some((s) => s.link === article.link);
        const category = classifyArticle(article);
        const version = extractVersionString(article.title);
        const readTime = estimateReadingTime(
          `${article.content || article.description || ""} ${article.title}`
        );

        return (
          <div
            key={article.link || index}
            className={`game-news-list-row ${isRead ? "is-read" : ""}`}
            onClick={() => onOpenArticle(article)}
            role="listitem"
            tabIndex={0}
            aria-label={article.title}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenArticle(article);
              }
            }}
          >
            {/* Thumbnail */}
            <div className="game-news-list-thumb">
              {article.imageUrl ? (
                <img
                  src={article.imageUrl}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="game-news-list-thumb-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
              )}
            </div>

            {/* Middle info */}
            <div className="game-news-list-main">
              <div className="game-news-list-badges">
                <span className={`game-news-badge category-${category}`}>
                  {getBadgeLabel(category)}
                </span>
                {version && (
                  <span className="game-news-version-badge">
                    {version}
                  </span>
                )}
                <span className="game-news-source-pill">
                  {article.sourceName}
                </span>
                {!isRead && <span className="game-news-unread-dot" title="Unread" />}
              </div>

              <h4 className="game-news-list-title" title={article.title}>
                {article.title}
              </h4>

              {article.description && (
                <p className="game-news-list-snippet">
                  {article.description}
                </p>
              )}
            </div>

            {/* Right Meta & Actions */}
            <div className="game-news-list-meta-actions">
              <div className="game-news-list-date-info">
                {article.pubDate && <span>{formatArticleDate(article.pubDate)}</span>}
                <span className="game-news-list-readtime">
                  {t("game.news.readTime", { min: readTime })}
                </span>
              </div>

              <div className="game-news-list-actions">
                <button
                  type="button"
                  className={`game-news-action-btn ${isSaved ? "is-active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSave(article);
                  }}
                  title={isSaved ? t("news.removeBookmark") : t("news.saveForLater")}
                  aria-label={isSaved ? t("news.removeBookmark") : t("news.saveForLater")}
                >
                  <svg viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>

                <button
                  type="button"
                  className={`game-news-action-btn ${isRead ? "is-active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleRead(article);
                  }}
                  title={isRead ? t("news.markAsUnread") : t("news.markAsRead")}
                  aria-label={isRead ? t("news.markAsUnread") : t("news.markAsRead")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="game-news-action-btn"
                  onClick={(e) => handleCopy(e, article.link)}
                  title={copiedLink === article.link ? t("gameInfo.copied") : t("news.copyLink")}
                  aria-label={t("news.copyLink")}
                >
                  {copiedLink === article.link ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GameNewsListSkeleton() {
  return (
    <div className="game-news-list-view" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="game-news-list-row skeleton-card">
          <div className="game-news-list-thumb skeleton-pulse" />
          <div className="game-news-list-main">
            <div className="skeleton-line skeleton-title" style={{ width: "50%" }} />
            <div className="skeleton-line skeleton-subtitle" style={{ width: "90%" }} />
          </div>
          <div className="game-news-list-meta-actions">
            <div className="skeleton-line skeleton-subtitle" style={{ width: "60px" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
