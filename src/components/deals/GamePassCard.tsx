import type { GamePassGame } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";

interface GamePassCardProps {
  game: GamePassGame;
  onOpenUrl: (url: string | null | undefined) => void;
  index: number;
}

export default function GamePassCard({
  game,
  onOpenUrl,
  index,
}: GamePassCardProps) {
  const { t } = useLanguage();

  return (
    <article
      className="deals-gamepass-card deals-card-enter"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="deals-gamepass-card-image-wrap">
        {game.coverImage ? (
          <img
            className="deals-gamepass-card-image"
            src={game.coverImage}
            alt={game.title}
            loading="lazy"
          />
        ) : (
          <div className="deals-gamepass-card-image-fallback">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}
        {game.platforms.length > 0 && (
          <div className="deals-gamepass-card-platforms">
            {game.platforms.map((p) => (
              <span key={p} className="deals-gamepass-card-platform-badge">
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="deals-gamepass-card-body">
        <h3 className="deals-gamepass-card-title">{game.title}</h3>
        {game.developer && (
          <div className="deals-gamepass-card-company">
            {game.developer}
          </div>
        )}
        {game.description && (
          <p className="deals-gamepass-card-desc">
            {game.description}
          </p>
        )}
        {game.categories.length > 0 && (
          <div className="deals-gamepass-card-meta">
            {game.categories.slice(0, 3).map((cat) => (
              <span key={cat} className="deals-gamepass-card-tag">
                {cat}
              </span>
            ))}
          </div>
        )}
        {game.publisher && (
          <div className="deals-gamepass-card-company deals-gamepass-card-company--muted">
            {t("deals.publishedBy", { publisher: game.publisher })}
          </div>
        )}
        {game.deeplink && (
          <button
            type="button"
            className="deals-gamepass-card-link"
            onClick={() => onOpenUrl(game.deeplink)}
          >
             {t("deals.viewOnXbox")}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
}
