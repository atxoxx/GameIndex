import { useMemo, useState } from "react";
import type { NewsArticle } from "../../../hooks/useNewsFeeds";
import { formatArticleDate, estimateReadingTime } from "../../../hooks/useNewsFeeds";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import {
  classifyArticle,
  extractVersionString,
  type ArticleClassification,
} from "./gameNewsTypes";

interface GameNewsHeroProps {
  article: NewsArticle;
  onOpenArticle: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  saved: boolean;
  read: boolean;
}

export default function GameNewsHero({
  article,
  onOpenArticle,
  onToggleSave,
  saved,
  read,
}: GameNewsHeroProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const category = useMemo<ArticleClassification>(
    () => classifyArticle(article),
    [article]
  );

  const version = useMemo(() => extractVersionString(article.title), [article.title]);

  const readTime = useMemo(() => {
    const text = `${article.content || article.description || ""} ${article.title}`;
    return estimateReadingTime(text);
  }, [article]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(article.link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
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
    <div
      className={`game-news-hero ${read ? "is-read" : ""}`}
      onClick={() => onOpenArticle(article)}
      role="button"
      tabIndex={0}
      aria-label={t("game.news.readArticle")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenArticle(article);
        }
      }}
    >
      {/* Background artwork with gradient wash */}
      <div className="game-news-hero-cover">
        {article.imageUrl ? (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <div className="game-news-hero-overlay" />
      </div>

      {/* Content */}
      <div className="game-news-hero-content">
        <div className="game-news-hero-top-row">
          <div className="game-news-hero-badges">
            <span className={`game-news-badge category-${category}`}>
              {category === "patch" || category === "major" || category === "hotfix" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                  <path d="M18 14h-8" />
                  <path d="M15 18h-5" />
                  <path d="M10 6h8v4h-8V6Z" />
                </svg>
              )}
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
          </div>

          <div className="game-news-hero-actions">
            <button
              type="button"
              className={`game-news-action-btn ${saved ? "is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSave(article);
              }}
              title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
              aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
            >
              <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            <button
              type="button"
              className="game-news-action-btn"
              onClick={handleCopy}
              title={copied ? t("gameInfo.copied") : t("news.copyLink")}
              aria-label={t("news.copyLink")}
            >
              {copied ? (
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

        <h2 className="game-news-hero-title">
          {article.title}
        </h2>

        {article.description && (
          <p className="game-news-hero-snippet">
            {article.description}
          </p>
        )}

        <div className="game-news-hero-footer">
          <div className="game-news-hero-meta">
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
            variant="primary"
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
}
