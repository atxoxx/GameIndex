import { useState, type RefObject } from "react";
import { gameDisplayName, type Game } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Button } from "../../ui";
import { IconStar, IconX } from "../icons";

interface RatingsHeroProps {
  game: Game;
  headingId: string;
  /** Source labels already present for this game. */
  sources: string[];
  onClose?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

function releaseYear(value?: string): string | null {
  if (!value) return null;
  return value.match(/^(\d{4})/)?.[1] ?? null;
}

/**
 * Game-art header for the ratings sheet. Mirrors the HLTB hero so the two
 * detail sheets feel like siblings: blurred banner, cover poster, title
 * and the sources this game actually has.
 */
export function RatingsHero({
  game,
  headingId,
  sources,
  onClose,
  closeButtonRef,
}: RatingsHeroProps) {
  const { t } = useLanguage();
  const [bannerFailed, setBannerFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const banner = (game.bannerUrl ?? game.coverArtUrl) || null;
  const cover = game.coverArtUrl || null;
  const year = releaseYear(game.releaseDate);
  const meta = [game.developer, year, game.genres?.slice(0, 2).join(" · ")]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="rt-hero">
      {banner && !bannerFailed && (
        <img
          className="rt-hero__backdrop"
          src={banner}
          alt=""
          aria-hidden="true"
          onError={() => setBannerFailed(true)}
        />
      )}
      <div className="rt-hero__scrim" aria-hidden="true" />

      <div className="rt-hero__content">
        {cover && !coverFailed && (
          <div className="rt-hero__poster">
            <img src={cover} alt="" onError={() => setCoverFailed(true)} />
          </div>
        )}

        <div className="rt-hero__main">
          <div className="rt-hero__kicker">
            <span className="rt-hero__source">
              <IconStar size={12} />
              {t("ratings.modalTitle")}
            </span>
            {sources.map((source) => (
              <Badge key={source} variant="default">
                {source}
              </Badge>
            ))}
          </div>

          <h2 className="rt-hero__title" id={headingId}>
            {gameDisplayName(game)}
          </h2>

          {meta && <p className="rt-hero__meta">{meta}</p>}
        </div>
      </div>

      {onClose && (
        <Button
          ref={closeButtonRef}
          className="rt-hero__close"
          variant="ghost"
          size="sm"
          iconOnly
          leftIcon={<IconX size={18} />}
          onClick={onClose}
          aria-label={t("common.close")}
          type="button"
        />
      )}
    </header>
  );
}

export default RatingsHero;
