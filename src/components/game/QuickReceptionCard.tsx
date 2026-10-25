import type { SteamGameReviews } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { IconStar, IconSteam } from "./icons";
import { scoreTone, steamPositivePercent } from "./ratings/ratingsShared";

interface QuickReceptionCardProps {
  /** IGDB or critic score, 0–100. */
  rating: number | null;
  /** Short source label for the rating, e.g. "IGDB" or "Critics". */
  ratingLabel?: string | null;
  /** Longer source line used when Steam has no reviews. */
  ratingMeta?: string | null;
  steam: SteamGameReviews | null;
}

/**
 * The overview's reception highlight: one compact card for the headline
 * score and the Steam positive share, with a sentiment bar. It replaces
 * the old tile that spread the same three values over a mostly empty box.
 */
export function QuickReceptionCard({
  rating,
  ratingLabel,
  ratingMeta,
  steam,
}: QuickReceptionCardProps) {
  const { t } = useLanguage();
  const steamPercent = steamPositivePercent(steam);
  const tone = scoreTone(rating) ?? scoreTone(steamPercent) ?? "success";

  if (rating == null && steamPercent == null) return null;

  const meta = steam
    ? t("ratings.steamBasedOn", {
        count: steam.totalReviews.toLocaleString(),
      })
    : ratingMeta;

  return (
    <article className={`game-reception game-reception--${tone}`}>
      <div className="game-reception__head">
        <span className="game-reception__icon" aria-hidden="true">
          <IconStar size={18} />
        </span>
        <span className="game-reception__title">{t("game.quickStats.reception")}</span>
        {ratingLabel && <span className="game-reception__source">{ratingLabel}</span>}
      </div>

      <div className="game-reception__body">
        {rating != null && (
          <div className="game-reception__score">
            <span className="game-reception__value">{Math.round(rating)}</span>
            <span className="game-reception__unit">/ 100</span>
          </div>
        )}

        {steamPercent != null && (
          <div className="game-reception__steam">
            <span className="game-reception__pct">
              <IconSteam size={12} />
              {steamPercent}%
            </span>
            <span className="game-reception__steam-label">
              {t("review.positive")}
            </span>
          </div>
        )}
      </div>

      <div className="game-reception__bar" aria-hidden="true">
        {steamPercent != null ? (
          <>
            <span
              className="game-reception__bar-positive"
              style={{ width: `${steamPercent}%` }}
            />
            <span
              className="game-reception__bar-negative"
              style={{ width: `${100 - steamPercent}%` }}
            />
          </>
        ) : (
          <span
            className="game-reception__bar-score"
            style={{ width: `${Math.max(0, Math.min(100, rating ?? 0))}%` }}
          />
        )}
      </div>

      {meta && <span className="game-reception__meta">{meta}</span>}
    </article>
  );
}

export default QuickReceptionCard;
