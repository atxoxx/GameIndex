import { useMemo, useState } from "react";
import {
  useNewsFeeds,
  formatArticleDate,
  type NewsArticle,
} from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";
import { loadSavedArticles, toggleSavedArticle } from "../../pages/communityStorage";
import HomeSection from "./HomeSection";

const MAX_ITEMS = 6;

interface HomeNewsRailProps {
  onSelectArticle: (article: NewsArticle) => void;
}

/**
 * HomeNewsRail — the newest headlines as a compact horizontal strip.
 * Uses the same `useNewsFeeds` hook as the News page (5-minute cache),
 * so the widget shows instantly and refreshes on a short TTL. Clicking
 * a card marks it read, records it in history, and opens the shared
 * NewsArticlePreview modal via the `onSelectArticle` callback.
 */
export default function HomeNewsRail({ onSelectArticle }: HomeNewsRailProps) {
  const { t } = useLanguage();
  const {
    articles,
    loading,
    readLinks,
    markRead,
    addToHistory,
  } = useNewsFeeds();
  const [savedLinks, setSavedLinks] = useState<Set<string>>(
    () => new Set(loadSavedArticles().map((s) => s.link))
  );

  const latest = useMemo(() => {
    const withImages = articles.filter((a) => a.imageUrl);
    const pool = withImages.length >= 3 ? withImages : articles;
    return pool.slice(0, MAX_ITEMS);
  }, [articles]);

  const handleClick = (article: NewsArticle) => {
    markRead(article.link);
    addToHistory(article);
    onSelectArticle(article);
  };

  const handleToggleSave = (article: NewsArticle) => {
    setSavedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(article.link)) {
        next.delete(article.link);
      } else {
        next.add(article.link);
      }
      return next;
    });
    toggleSavedArticle(article);
  };

  return (
    <HomeSection
      className="home-news"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11a9 9 0 0 1 9 9" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1" />
        </svg>
      }
      title={t("home.news.title")}
      subtitle={latest.length > 0 ? t("home.news.subtitle") : undefined}
      viewAllPath="/news"
    >
      {loading && latest.length === 0 ? (
        <div className="home-news__loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="home-news__skeleton" />
          ))}
        </div>
      ) : latest.length === 0 ? (
        <div className="home-news__empty">{t("home.news.empty")}</div>
      ) : (
        <div className="home-rail-track home-rail-track--news">
          {latest.map((article, i) => (
            <HomeNewsCard
              key={`${article.link}-${i}`}
              article={article}
              read={readLinks.has(article.link)}
              saved={savedLinks.has(article.link)}
              onClick={() => handleClick(article)}
              onToggleSave={() => handleToggleSave(article)}
            />
          ))}
        </div>
      )}
    </HomeSection>
  );
}

function HomeNewsCard({
  article,
  read,
  saved,
  onClick,
  onToggleSave,
}: {
  article: NewsArticle;
  read: boolean;
  saved: boolean;
  onClick: () => void;
  onToggleSave: () => void;
}) {
  const { t } = useLanguage();
  return (
    <article
      className={`home-news-card${read ? " is-read" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="home-news-card__cover">
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="home-news-card__placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="home-news-card__source">{article.sourceName}</span>
        {!read && <span className="home-news-card__unread" aria-hidden />}
      </div>
      <div className="home-news-card__body">
        <h4 className="home-news-card__title" title={article.title}>
          {article.title}
        </h4>
        <div className="home-news-card__footer">
          <span className="home-news-card__date">
            {article.pubDate ? formatArticleDate(article.pubDate) : ""}
          </span>
          <button
            type="button"
            className={`home-news-card__save${saved ? " saved" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
            aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
          >
            <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}
