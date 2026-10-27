import { useMemo } from "react";
import {
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  Eye,
  ImageOff,
  Layers,
  Timer,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NewsCardItem, NewsTopicId } from "../../types/news";
import type { ViewDensity } from "../../types/game";
import { estimateReadingTime, formatArticleDate } from "../../utils/news/feed";
import { NEWS_TOPICS } from "../../utils/news/topics";
import { useLanguage } from "../../context/LanguageContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";

interface NewsArticleCardProps {
  item: NewsCardItem;
  density?: ViewDensity;
  saved?: boolean;
  relatedGameName?: string | null;
  onOpen: (item: NewsCardItem) => void;
  onToggleSave?: (item: NewsCardItem) => void;
  onToggleRead?: (item: NewsCardItem) => void;
  onSelectTopic?: (topic: NewsTopicId) => void;
}

const TOPIC_LABEL = new Map(NEWS_TOPICS.map((topic) => [topic.id, topic.labelKey]));

/**
 * One story card.
 *
 * Shows the lead article, the outlets that ran the same story, inferred topics
 * and the reader state. All four app densities are supported by CSS alone —
 * the DOM stays identical so the card never re-mounts when density changes.
 */
export default function NewsArticleCard({
  item,
  density = "cozy",
  saved = false,
  relatedGameName = null,
  onOpen,
  onToggleSave,
  onToggleRead,
  onSelectTopic,
}: NewsArticleCardProps) {
  const { t, language } = useLanguage();
  const menu = useContextMenu();
  const copy = useCopyToClipboard();

  const { article, related, topics, unread } = item;

  const readTime = useMemo(
    () => estimateReadingTime(`${article.content} ${article.description} ${article.title}`),
    [article.content, article.description, article.title],
  );

  const outletNames = useMemo(
    () => [...new Set(related.map((entry) => entry.sourceName))],
    [related],
  );

  const handleSave = (event: React.MouseEvent) => {
    event.stopPropagation();
    onToggleSave?.(item);
  };

  const menuItems: ContextMenuItem[] = [
    {
      id: "read",
      label: t("news.readNow"),
      icon: <Eye size={15} />,
      accent: true,
      onSelect: () => onOpen(item),
    },
    {
      id: "open-browser",
      label: t("weblinks.openBrowser"),
      icon: <ExternalLink size={15} />,
      onSelect: () => {
        void openUrl(article.link).catch(() => undefined);
      },
    },
    { id: "sep-1", separator: true },
    ...(onToggleRead
      ? [
          {
            id: "toggle-read",
            label: unread ? t("news.markAsRead") : t("news.markAsUnread"),
            icon: <Check size={15} />,
            onSelect: () => onToggleRead(item),
          } as ContextMenuItem,
        ]
      : []),
    ...(onToggleSave
      ? [
          {
            id: "toggle-save",
            label: saved ? t("news.removeBookmark") : t("news.saveForLater"),
            icon: <Bookmark size={15} />,
            onSelect: () => onToggleSave(item),
          } as ContextMenuItem,
        ]
      : []),
    { id: "sep-2", separator: true },
    {
      id: "copy-link",
      label: t("news.copyLink"),
      icon: <Copy size={15} />,
      onSelect: () => void copy(article.link),
    },
    {
      id: "copy-title",
      label: t("gameMenu.copyName"),
      icon: <Copy size={15} />,
      onSelect: () => void copy(article.title),
    },
  ];

  const cover = article.imageUrl ? (
    <img src={article.imageUrl} alt="" loading="lazy" />
  ) : (
    <span className="news-card__placeholder" aria-hidden>
      <ImageOff size={22} />
    </span>
  );

  return (
    <article
      className={`news-card density-${density}${unread ? " is-unread" : " is-read"}`}
      data-density={density}
      role="button"
      tabIndex={0}
      aria-label={t("news.readArticle", { title: article.title })}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        // Nested controls (save, topic chips) bubble their own Enter/Space.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
      onContextMenu={(event) => menu.open(event)}
    >
      <div className="news-card__cover">
        {cover}
        <span className="news-card__source">{article.sourceName}</span>
        {!unread && (
          <span className="news-card__read-mark" title={t("news.markAsRead")}>
            <Check size={11} />
          </span>
        )}
        {onToggleSave && (
          <button
            type="button"
            className={`news-card__save${saved ? " is-saved" : ""}`}
            onClick={handleSave}
            title={saved ? t("news.removeBookmark") : t("news.saveForLater")}
            aria-label={saved ? t("news.removeBookmark") : t("news.saveForLater")}
          >
            <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="news-card__body">
        {(relatedGameName || topics.length > 0) && (
          <div className="news-card__chips">
            {relatedGameName && (
              <span className="news-chip news-chip--game" title={t("news.relatedToGame", { game: relatedGameName })}>
                {relatedGameName}
              </span>
            )}
            {topics.slice(0, 2).map((topic) => (
              <button
                key={topic}
                type="button"
                className="news-chip news-chip--topic"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectTopic?.(topic);
                }}
              >
                {TOPIC_LABEL.has(topic) ? t(TOPIC_LABEL.get(topic) as string) : topic}
              </button>
            ))}
          </div>
        )}

        <h3 className="news-card__title">{article.title}</h3>

        {density !== "compact" && article.description && (
          <p className="news-card__snippet">{article.description}</p>
        )}

        <div className="news-card__meta">
          <span className="news-card__meta-source">{article.sourceName}</span>
          {article.pubDate && (
            <>
              <span className="news-card__dot" aria-hidden />
              <span>{formatArticleDate(article.pubDate, language)}</span>
            </>
          )}
          <span className="news-card__dot" aria-hidden />
          <span className="news-card__readtime">
            <Timer size={11} aria-hidden />
            {t("news.minRead", { count: readTime })}
          </span>
          {outletNames.length > 0 && (
            <span
              className="news-card__outlets"
              title={t("news.alsoCoveredBy", { sources: outletNames.join(", ") })}
            >
              <Layers size={11} aria-hidden />+{outletNames.length}
            </span>
          )}
        </div>
      </div>

      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={menuItems}
          onClose={menu.close}
          ariaLabel={article.title}
          header={
            <>
              <span className="context-menu-title" title={article.title}>
                {article.title}
              </span>
              <span className="ctx-badge">{article.sourceName}</span>
            </>
          }
        />
      )}
    </article>
  );
}

/** Skeleton with the same box model as a real card. */
export function NewsArticleCardSkeleton({ density = "cozy" }: { density?: ViewDensity }) {
  return (
    <div className={`news-card news-card--skeleton density-${density}`} aria-hidden>
      <div className="news-card__cover news-card__cover--skeleton" />
      <div className="news-card__body">
        <div className="news-skeleton-line" style={{ width: "78%", height: 14 }} />
        <div className="news-skeleton-line" style={{ width: "94%", height: 10 }} />
        <div className="news-skeleton-line" style={{ width: "61%", height: 10 }} />
      </div>
    </div>
  );
}
