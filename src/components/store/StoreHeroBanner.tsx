import { ChevronDown, ChevronLeft, ChevronRight, Star } from "lucide-react";
import type { StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useProgressiveImage } from "../../hooks/useProgressiveImages";

interface StoreHeroBannerProps {
  game: StoreGameSummary | null;
  /** Rendered at all times so the sticky slot never shifts the page. */
  visible: boolean;
  /** Shows previous/next when the spotlight has more than one slide. */
  canCycle?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onExpand: () => void;
  onPickGame: (game: StoreGameSummary) => void;
}

/**
 * The collapsed state of the featured spotlight: a slim sticky banner that
 * keeps the current pick (and its CTA) reachable once the stage scrolls
 * away. It lives in a zero-height sticky slot at the top of the page, so
 * appearing and disappearing never nudges the catalogue.
 */
export default function StoreHeroBanner({
  game,
  visible,
  canCycle = false,
  onPrev,
  onNext,
  onExpand,
  onPickGame,
}: StoreHeroBannerProps) {
  const { t } = useLanguage();
  const [backdrop] = useProgressiveImage(
    visible ? game?.coverUrl ?? null : null
  );

  return (
    <div
      className={`store-hero-banner-slot${visible ? " is-visible" : ""}`}
      aria-hidden={!visible}
    >
      {visible && game && (
        <div className="store-hero-banner">
          <button
            type="button"
            className="store-hero-banner-cover"
            onClick={() => onPickGame(game)}
            aria-label={game.name}
            tabIndex={-1}
          >
            {backdrop ? (
              <img src={backdrop} alt="" aria-hidden="true" />
            ) : (
              <span className="store-hero-banner-cover-fallback" aria-hidden="true" />
            )}
          </button>

          <div className="store-hero-banner-text">
            <span className="store-hero-banner-eyebrow">
              {t("store.hero.collapsedFeatured")}
            </span>
            <button
              type="button"
              className="store-hero-banner-title"
              onClick={() => onPickGame(game)}
              title={game.name}
            >
              {game.name}
            </button>
          </div>

          <div className="store-hero-banner-meta">
            {game.rating != null && (
              <span className="store-hero-banner-stat">
                <Star size={11} fill="currentColor" aria-hidden="true" />
                {Math.round(game.rating)}%
              </span>
            )}
            {game.firstReleaseDate && (
              <span className="store-hero-banner-stat">
                {new Date(game.firstReleaseDate).getFullYear()}
              </span>
            )}
            {game.genres?.[0] && (
              <span className="store-hero-banner-genre">{game.genres[0]}</span>
            )}
          </div>

          <div className="store-hero-banner-actions">
            {canCycle && (
              <div className="store-hero-banner-nav">
                <button
                  type="button"
                  className="store-hero-banner-nav-btn"
                  onClick={onPrev}
                  aria-label={t("store.spotlight.prev")}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="store-hero-banner-nav-btn"
                  onClick={onNext}
                  aria-label={t("store.spotlight.next")}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            )}

            <button
              type="button"
              className="store-hero-banner-cta"
              onClick={() => onPickGame(game)}
            >
              {t("store.spotlight.explore")}
              <ChevronRight size={14} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="store-hero-banner-expand"
              onClick={onExpand}
              aria-label={t("store.hero.bannerExpand")}
              title={t("store.hero.bannerExpand")}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
