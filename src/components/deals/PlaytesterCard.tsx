import { useMemo } from "react";
import type { PlaytesterGame } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { titleToSlug } from "../../pages/deals/dealsConstants";

interface PlaytesterCardProps {
  game: PlaytesterGame;
  onInspect?: (game: PlaytesterGame) => void;
  index: number;
  density?: string;
}

export default function PlaytesterCard({
  game,
  onInspect,
  index,
  density = "cozy",
}: PlaytesterCardProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();

  const slug = useMemo(() => titleToSlug(game.title), [game.title]);
  const wishlisted = isWishlisted(slug);
  const ownedInLibrary = useMemo(() => {
    const titleNorm = game.title.toLowerCase().trim();
    return games.some((g) => g.name.toLowerCase().trim() === titleNorm);
  }, [game.title, games]);

  const isActive = game.status.toLowerCase() === "active";

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle({
      id: 0,
      name: game.title,
      slug,
      summary: game.description ?? null,
      rating: null,
      aggregatedRating: null,
      coverUrl: game.thumbnail ?? null,
      logoUrl: null,
      genres: game.genres ?? [],
      platforms:
        game.platforms && game.platforms.length > 0
          ? game.platforms
          : game.platform
            ? [game.platform]
            : [],
      firstReleaseDate: null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  return (
    <article
      className={`pt-card deals-card-enter density-${density} ${
        ownedInLibrary ? "is-owned" : ""
      } ${wishlisted ? "is-wishlisted" : ""}`}
      style={{ animationDelay: `${Math.min(index * 30, 450)}ms` }}
      role="button"
      tabIndex={0}
      onClick={() => onInspect?.(game)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect?.(game);
        }
      }}
      aria-label={t("deals.openPlaytesterLabel", { game: game.title })}
    >
      <div className="pt-card-image-wrap">
        {game.thumbnail ? (
          <img
            className="pt-card-image"
            src={game.thumbnail}
            alt={game.title}
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const fb = target.parentElement?.querySelector(
                ".pt-card-image-fallback",
              ) as HTMLElement | null;
              if (fb) fb.style.display = "flex";
            }}
          />
        ) : null}

        <div
          className="pt-card-image-fallback"
          style={{ display: game.thumbnail ? "none" : "flex" }}
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

        {/* Platform badge */}
        {game.platform && (
          <span className="pt-card-platform-badge">
            {game.platforms.length > 1
              ? game.platforms.join(" · ")
              : game.platform}
          </span>
        )}

        {/* Offer type badge */}
        {game.kind && <span className="pt-card-kind-badge">{game.kind}</span>}

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

      <div className="pt-card-body">
        <h3 className="pt-card-title" title={game.title}>
          {game.title}
        </h3>

        <div className="pt-card-meta">
          <span
            className={`pt-card-status ${isActive ? "active" : ""}`}
            title={game.status}
          >
            <span className="pt-card-status-dot" aria-hidden="true" />
            {game.status}
          </span>

          {game.genres.length > 0 && (
            <span className="pt-card-genres">
              {game.genres.slice(0, 3).join(", ")}
            </span>
          )}
        </div>

        {game.description && (
          <p className="pt-card-desc">{game.description}</p>
        )}
      </div>
    </article>
  );
}
