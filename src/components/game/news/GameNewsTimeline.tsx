import { useState } from "react";
import type { NewsArticle } from "../../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../../hooks/useNewsFeeds";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import {
  classifyArticle,
  extractVersionString,
  type ArticleClassification,
} from "./gameNewsTypes";

interface GameNewsTimelineProps {
  articles: NewsArticle[];
  readLinks: Set<string>;
  savedArticles: { link: string }[];
  onOpenArticle: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  onToggleRead: (article: NewsArticle) => void;
}

export default function GameNewsTimeline({
  articles,
  readLinks,
  savedArticles,
  onOpenArticle,
  onToggleSave,
  onToggleRead,
}: GameNewsTimelineProps) {
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
    <div className="game-news-timeline" role="feed" aria-label="Game updates timeline">
      <div className="game-news-timeline-track" aria-hidden="true" />

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
            className={`game-news-timeline-item ${isRead ? "is-read" : ""}`}
            onClick={() => onOpenArticle(article)}
            role="article"
            tabIndex={0}
            aria-label={article.title}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenArticle(article);
              }
            }}
          >
            {/* Timeline node marker */}
            <div className={`game-news-timeline-node category-${category}`}>
              {category === "patch" || category === "major" || category === "hotfix" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              ) : category === "announcement" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </div>

            {/* Timeline Card */}
            <div className="game-news-timeline-card">
              <div className="game-news-timeline-header">
                <div className="game-news-timeline-badges">
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

                <div className="game-news-timeline-actions">
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

              <div className="game-news-timeline-body">
                <div className="game-news-timeline-text">
                  <h3 className="game-news-timeline-title">
                    {article.title}
                  </h3>

                  {article.description && (
                    <p className="game-news-timeline-snippet">
                      {article.description}
                    </p>
                  )}
                </div>

                {article.imageUrl && (
                  <div className="game-news-timeline-thumb">
                    <img
                      src={article.imageUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="game-news-timeline-footer">
                <div className="game-news-timeline-meta">
                  {article.pubDate && (
                    <span className="game-news-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {formatArticleDate(article.pubDate)}
                    </span>
                  )}

                  <span className="game-news-meta-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {t("game.news.readTime", { min: readTime })}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenArticle(article);
                  }}
                  leftIcon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                  }
                >
                  {t("game.news.readArticle")}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GameNewsTimelineSkeleton() {
  return (
    <div className="game-news-timeline" aria-hidden="true">
      <div className="game-news-timeline-track" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="game-news-timeline-item">
          <div className="game-news-timeline-node skeleton-pulse" />
          <div className="game-news-timeline-card skeleton-card">
            <div className="skeleton-line skeleton-title" style={{ width: "40%" }} />
            <div className="skeleton-line skeleton-subtitle" style={{ width: "80%" }} />
            <div className="skeleton-line skeleton-subtitle" style={{ width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
