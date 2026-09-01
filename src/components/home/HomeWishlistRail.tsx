import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWishlistContext } from "../../context/WishlistContext";
import { useLanguage } from "../../context/LanguageContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import type { WishlistEntry } from "../../types/game";
import HomeSection from "./HomeSection";

const MAX_ITEMS = 10;

/**
 * HomeWishlistRail — a compact horizontal strip of the newest wishlisted
 * titles, each card linking to its store detail page. Renders nothing
 * when the wishlist is empty.
 */
export default function HomeWishlistRail() {
  const { wishlist } = useWishlistContext();
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (wishlist.length === 0) return null;

  const items = wishlist.slice(0, MAX_ITEMS);

  return (
    <HomeSection
      className="home-wishlist"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" />
        </svg>
      }
      title={t("home.wishlist.title")}
      subtitle={t("home.wishlist.subtitle", { count: wishlist.length })}
      viewAllPath="/wishlist"
    >
      <div className="home-rail-track">
        {items.map((entry) => (
          <HomeWishlistCard
            key={entry.slug}
            entry={entry}
            onClick={() => navigate(`/store/${entry.slug}`)}
          />
        ))}
      </div>
    </HomeSection>
  );
}


function HomeWishlistCard({
  entry,
  onClick,
}: {
  entry: WishlistEntry;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { displayUrl, staticPosterUrl, animatedPosterUrl, handleError } = useGameCardArt({
    game: entry,
    defaultCoverUrl: entry.coverUrl,
    isHovered: hovered,
  });

  return (
    <button
      type="button"
      className="home-rail-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={entry.name}
      aria-label={entry.name}
    >
      <div className="home-rail-card__cover">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              src={staticPosterUrl || displayUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              onError={handleError}
              className="home-rail-card__cover-static"
            />
            {animatedPosterUrl && hovered && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="home-rail-card__cover-animated is-active"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="home-rail-card__placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
      </div>
      <span className="home-rail-card__name">{entry.name}</span>
    </button>
  );
}
