import { Bookmark, Check, Timer } from "lucide-react";
import type { NewsArticle } from "../../../types/news";
import { estimateReadingTime, formatArticleDate } from "../../../utils/news/feed";
import { useLanguage } from "../../../context/LanguageContext";

interface GameNewsCardProps {
  article: NewsArticle;
  saved: boolean;
  read: boolean;
  /** Additional outlets carrying the same story (cluster). */
  alsoCount?: number;
  onOpen: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  onToggleRead: (article: NewsArticle) => void;
}

/**
 * Grid card for the per-game News tab.
 *
 * Kept separate from the page-level `NewsArticleCard`: the game tab merges
 * Steam news, per-game custom feeds and matching global headlines, so it does
 * not need clusters, topics or the Home rail's queue behaviour.
 */
export default function GameNewsCard({
  article,
  saved,
  read,
  alsoCount,
  onOpen,
  onToggleSave,
  onToggleRead,
}: GameNewsCardProps) {
  const { t, language } = useLanguage();
  const readTime = estimateReadingTime(`${article.content} ${article.description} ${article.title}`);

  return (
    <article
      className={`game-news-grid-card${read ? " is-read" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("news.readArticle", { title: article.title })}
      onClick={() => onOpen(article)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(article);
        }
      }}
    >
      <div className="game-news-grid-card__cover">
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="game-news-grid-card__placeholder" aria-hidden />
        )}
        <span className="game-news-grid-card__source">{article.sourceName}</span>
        {alsoCount && alsoCount > 0 ? (
          <span className="game-news-grid-card__also">
            +{alsoCount} {t("game.news.alsoCovered")}
          </span>
        ) : null}
        <div className="game-news-grid-card__actions">
          <button
            type="button"
            className={saved ? "is-active" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSave(article);
            }}
            title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
            aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
          >
            <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleRead(article);
            }}
            title={read ? t("news.markAsUnread") : t("news.markAsRead")}
            aria-label={read ? t("news.markAsUnread") : t("news.markAsRead")}
          >
            <Check size={14} />
          </button>
        </div>
      </div>
      <div className="game-news-grid-card__body">
        <h3>{article.title}</h3>
        {article.description && <p>{article.description}</p>}
        <div className="game-news-grid-card__meta">
          <span>{article.pubDate ? formatArticleDate(article.pubDate, language) : article.sourceName}</span>
          <span>
            <Timer size={11} aria-hidden />
            {t("news.minRead", { count: readTime })}
          </span>
        </div>
      </div>
    </article>
  );
}
