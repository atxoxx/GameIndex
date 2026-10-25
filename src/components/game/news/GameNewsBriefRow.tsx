import { ChevronRight } from "lucide-react";
import type { NewsArticle } from "../../../types/news";
import { useLanguage } from "../../../context/LanguageContext";
import { formatArticleDate } from "../../../utils/news/feed";
import { Badge } from "../../ui";
import {
  classifyArticle,
  extractVersionString,
  type ArticleClassification,
} from "./gameNewsTypes";

const BADGE_VARIANT: Record<
  ArticleClassification,
  "default" | "success" | "warning" | "danger" | "info" | "accent"
> = {
  patch: "info",
  major: "accent",
  hotfix: "warning",
  announcement: "default",
  press: "default",
  general: "default",
};

const BADGE_LABEL_KEY: Record<ArticleClassification, string> = {
  patch: "game.news.patchBadge",
  major: "game.news.majorUpdateBadge",
  hotfix: "game.news.hotfixBadge",
  announcement: "game.news.announcementBadge",
  press: "game.news.press",
  general: "game.news.articleBadge",
};

export interface GameNewsBriefRowProps {
  article: NewsArticle;
  onOpen: (article: NewsArticle) => void;
  read: boolean;
}

/** One compact line in the briefing's patch-note list. */
export default function GameNewsBriefRow({
  article,
  onOpen,
  read,
}: GameNewsBriefRowProps) {
  const { t, language } = useLanguage();
  const classification = classifyArticle(article);
  const version = extractVersionString(article.title);

  return (
    <button
      type="button"
      className={`game-news-brief-row${read ? " is-read" : ""}`}
      onClick={() => onOpen(article)}
    >
      <span className="game-news-brief-row__date">
        {article.pubDate ? formatArticleDate(article.pubDate, language) : article.sourceName}
      </span>
      <Badge variant={BADGE_VARIANT[classification]} size="sm">
        {version ?? t(BADGE_LABEL_KEY[classification])}
      </Badge>
      <span className="game-news-brief-row__title">{article.title}</span>
      <span className="game-news-brief-row__source">{article.sourceName}</span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}
