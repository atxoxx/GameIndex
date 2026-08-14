import { useMemo } from "react";
import type { GamePassGame } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { titleToSlug } from "../../pages/deals/dealsConstants";

interface GamePassCardProps {
  game: GamePassGame;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect?: (game: GamePassGame) => void;
  index: number;
  density?: string;
}

export default function GamePassCard({
  game,
  onOpenUrl,
  onInspect,
  index,
  density = "cozy",
}: GamePassCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();

  const slug = useMemo(() => titleToSlug(game.title), [game.title]);
  const wishlisted = isWishlisted(slug);
  const ownedInLibrary = useMemo(() => {
    const titleNorm = game.title.toLowerCase().trim();
    return games.some((g) => g.name.toLowerCase().trim() === titleNorm);
  }, [game.title, games]);

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle({
      id: 0,
      name: game.title,
      slug,
      summary: game.description ?? null,
      rating: null,
      aggregatedRating: null,
      coverUrl: game.coverImage ?? null,
      logoUrl: null,
      genres: game.categories ?? [],
      platforms: game.platforms ?? [],
      firstReleaseDate: game.releaseDate ?? null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  return (
    <article
      className={`deals-gamepass-card deals-card-enter density-${density} ${
        ownedInLibrary ? "is-owned" : ""
      } ${wishlisted ? "is-wishlisted" : ""}`}
      style={{ animationDelay: `${Math.min(index * 30, 450)}ms` }}
      role="button"
      tabIndex={0}
      onClick={() => (onInspect ? onInspect(game) : onOpenUrl(game.deeplink))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onInspect) onInspect(game);
          else onOpenUrl(game.deeplink);
        }
      }}
    >
      <div className="deals-gamepass-card-image-wrap">
        {game.coverImage ? (
          <img
            className="deals-gamepass-card-image"
            src={game.coverImage}
            alt={game.title}
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const fb = target.parentElement?.querySelector(
                ".deals-gamepass-card-image-fallback",
              ) as HTMLElement | null;
              if (fb) fb.style.display = "flex";
            }}
          />
        ) : null}

        <div
          className="deals-gamepass-card-image-fallback"
          style={{ display: game.coverImage ? "none" : "flex" }}
        >
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

        {/* Platform tags */}
        {game.platforms.length > 0 && (
          <div className="deals-gamepass-card-platforms">
            {game.platforms.map((p) => (
              <span key={p} className="deals-gamepass-card-platform-badge">
                {p}
              </span>
            ))}
          </div>
        )}

        {/* Status badges */}
        <div className="deals-card-top-badges">
          {ownedInLibrary && (
            <span className="deals-card-badge deals-card-badge--owned" title={t("deals.inLibrary")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
          {wishlisted && (
            <span className="deals-card-badge deals-card-badge--wishlist" title={t("deals.onWishlist")}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </span>
          )}
        </div>

        {/* Quick action buttons */}
        <div className="deals-card-quick-actions">
          <button
            type="button"
            className={`deals-card-action-btn ${wishlisted ? "active" : ""}`}
            onClick={handleToggleWishlist}
            title={wishlisted ? t("deals.removeFromWishlist") : t("deals.addToWishlist")}
            aria-label={wishlisted ? t("deals.removeFromWishlist") : t("deals.addToWishlist")}
          >
            <svg
              viewBox="0 0 24 24"
              fill={wishlisted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="deals-gamepass-card-body">
        <h3 className="deals-gamepass-card-title" title={game.title}>
          {game.title}
        </h3>

        {game.developer && (
          <div className="deals-gamepass-card-company">{game.developer}</div>
        )}

        {game.description && (
          <p className="deals-gamepass-card-desc">{game.description}</p>
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

        {game.deeplink && (
          <button
            type="button"
            className="deals-gamepass-card-link"
            onClick={(e) => {
              e.stopPropagation();
              onOpenUrl(game.deeplink);
            }}
          >
            {t("deals.viewOnXbox")}
            <svg
              width="14"
              height="14"
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
