import { CheckCircle2, ChevronRight } from "lucide-react";
import type { NewsArticle } from "../../../types/news";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import { GameTabEmpty } from "../tabs";
import GameNewsHero from "./GameNewsHero";
import GameNewsCard from "./GameNewsCard";
import GameNewsBriefRow from "./GameNewsBriefRow";

export interface GameNewsBriefingProps {
  hero: NewsArticle | null;
  unread: NewsArticle[];
  patchNotes: NewsArticle[];
  unreadCount: number;
  readLinks: ReadonlySet<string>;
  savedLinks: ReadonlySet<string>;
  onOpenArticle: (article: NewsArticle) => void;
  onToggleSave: (article: NewsArticle) => void;
  onToggleRead: (article: NewsArticle) => void;
  onShowFeed: () => void;
}

/**
 * The News tab's Briefing view.
 *
 * It answers the three questions a patch cycle raises: what is the headline,
 * what changed while I was away, and what are the latest patch notes. The full
 * feed is one switch away.
 */
export default function GameNewsBriefing({
  hero,
  unread,
  patchNotes,
  unreadCount,
  readLinks,
  savedLinks,
  onOpenArticle,
  onToggleSave,
  onToggleRead,
  onShowFeed,
}: GameNewsBriefingProps) {
  const { t } = useLanguage();

  if (!hero) {
    return (
      <GameTabEmpty
        icon={<CheckCircle2 size={24} />}
        title={t("game.news.emptyTitle")}
        description={t("game.news.emptySubtitle")}
      />
    );
  }

  return (
    <div className="game-news-briefing">
      <GameNewsHero
        article={hero}
        onOpenArticle={onOpenArticle}
        onToggleSave={onToggleSave}
        saved={savedLinks.has(hero.link)}
        read={readLinks.has(hero.link)}
      />

      <section className="game-news-brief-section">
        <header className="game-news-brief-head">
          <div>
            <h3>{t("game.news.sinceLastVisit")}</h3>
            <p>
              {unreadCount > 0
                ? t("game.news.sinceLastVisitCount", { count: unreadCount })
                : t("game.news.caughtUp")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<ChevronRight size={14} />}
            onClick={onShowFeed}
          >
            {t("game.news.openFeed")}
          </Button>
        </header>

        {unread.length > 0 ? (
          <div className="game-news-grid game-news-grid--briefing">
            {unread.map((article) => (
              <GameNewsCard
                key={article.link}
                article={article}
                onOpen={onOpenArticle}
                onToggleSave={onToggleSave}
                onToggleRead={onToggleRead}
                read={readLinks.has(article.link)}
                saved={savedLinks.has(article.link)}
              />
            ))}
          </div>
        ) : (
          <p className="game-news-brief-caughtup">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t("game.news.caughtUpHint")}
          </p>
        )}
      </section>

      {patchNotes.length > 0 && (
        <section className="game-news-brief-section">
          <header className="game-news-brief-head">
            <div>
              <h3>{t("game.news.latestPatchNotes")}</h3>
              <p>{t("game.news.latestPatchNotesHint")}</p>
            </div>
          </header>
          <div className="game-news-brief-list">
            {patchNotes.map((article) => (
              <GameNewsBriefRow
                key={article.link}
                article={article}
                onOpen={onOpenArticle}
                read={readLinks.has(article.link)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
