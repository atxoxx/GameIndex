import { Fragment, useContext, useState, memo, type MouseEvent } from "react";
import { useProgressiveImage } from "../../hooks/useProgressiveImages";
import { useCrackWatch } from "../../context/CrackWatchContext";
import { usePrice } from "../../context/PriceContext";
import { WishlistContext } from "../../context/WishlistContext";
import { DensityContext } from "../../context/DensityContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import type { StoreGameSummary, ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import StoreHighlightText from "./StoreHighlightText";

interface StoreGameCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
  searchQuery?: string;
  density?: ViewDensity;
  wishlisted?: boolean;
  onToggleWishlist?: (game: StoreGameSummary, event: MouseEvent) => void;
  inLibrary?: boolean;
  onHide?: (game: StoreGameSummary, event: MouseEvent) => void;
  onCompare?: (game: StoreGameSummary, event: MouseEvent) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: StoreGameSummary, event: MouseEvent) => void;
}

function ratingColor(score: number): string {
  if (score >= 75) return "var(--color-success)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-danger)";
}

function StoreGameCardBase({
  game,
  onClick,
  searchQuery,
  density: densityProp,
  wishlisted: wishlistedProp,
  onToggleWishlist: onToggleWishlistProp,
  inLibrary = false,
  onHide,
  onCompare,
  selectable = false,
  selected = false,
  onToggleSelect,
}: StoreGameCardProps) {
  const wishlistCtx = useContext(WishlistContext);
  const densityCtx = useContext(DensityContext);

  const density: ViewDensity = densityProp ?? densityCtx?.density ?? "cozy";
  const wishlisted: boolean =
    wishlistedProp ?? wishlistCtx?.isWishlisted(game.slug) ?? false;

  const onToggleWishlist =
    onToggleWishlistProp ??
    (wishlistCtx
      ? (g: StoreGameSummary) => {
          wishlistCtx.toggle(g);
        }
      : undefined);

  const crackStatus = useCrackWatch(game.name);
  const price = usePrice(game.name);
  const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl);
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);

  const isList = density === "list";
  const { displayUrl, staticPosterUrl, animatedPosterUrl, isIcon, handleError } = useGameCardArt({
    game,
    defaultCoverUrl: coverUrl,
    isHovered: hovered,
    isListOrSmall: isList,
  });

  const showBody = density !== "compact";
  const genresToShow = density === "cinematic" ? 4 : density === "list" ? 3 : 2;
  const showHeart = Boolean(onToggleWishlist);

  const releaseYear = game.firstReleaseDate
    ? new Date(game.firstReleaseDate).getFullYear()
    : null;

  // List view representation
  if (density === "list") {
    return (
      <div
        className={`store-game-card store-game-card-list${selectable ? " selectable" : ""}${selected ? " selected" : ""}`}
        onClick={(e) => {
          if (selectable && onToggleSelect) {
            onToggleSelect(game, e);
          } else {
            onClick(game);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selectable && onToggleSelect) {
              onToggleSelect(game, e as unknown as MouseEvent);
            } else {
              onClick(game);
            }
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`${game.name}${game.rating != null ? `, ${t("store.gameCard.rated", { rating: Math.round(game.rating) })}` : ""}`}
      >
        {selectable && (
          <span className={`store-card-select${selected ? " checked" : ""}`} aria-hidden="true">
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}

        <div className={`store-card-list-thumb${isIcon ? " has-icon" : ""}`}>
          {displayUrl ? (
            <img
              ref={displayUrl === coverUrl ? imgRef : undefined}
              src={displayUrl}
              alt={game.name}
              loading="lazy"
              onError={handleError}
              className={isIcon ? "store-card-icon-img" : "store-card-poster-img"}
            />
          ) : (
            <div className="store-card-cover-skeleton" />
          )}
        </div>

        <div className="store-card-list-info">
          <h3 className="store-card-name" title={game.name}>
            <StoreHighlightText text={game.name} query={searchQuery} />
          </h3>
          <div className="store-card-list-sub">
            {releaseYear && <span className="store-card-list-year">{releaseYear}</span>}
            {inLibrary && (
              <span className="store-card-inlib-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("store.inLibrary")}
              </span>
            )}
          </div>
        </div>

        <div className="store-card-list-genres">
          {game.genres && game.genres.length > 0 ? (
            game.genres.slice(0, 3).map((g) => (
              <span key={g} className="store-card-genre">
                <StoreHighlightText text={g} query={searchQuery} />
              </span>
            ))
          ) : (
            <span className="store-card-empty-dash">–</span>
          )}
        </div>

        <div className="store-card-list-platforms" title={game.platforms?.join(", ")}>
          {game.platforms && game.platforms.length > 0 ? (
            game.platforms.slice(0, 2).map((p, idx, arr) => (
              <Fragment key={p}>
                <StoreHighlightText text={p} query={searchQuery} />
                {idx < arr.length - 1 ? " · " : null}
              </Fragment>
            ))
          ) : (
            <span className="store-card-empty-dash">–</span>
          )}
        </div>

        <div className="store-card-list-badges">
          {game.rating != null ? (
            <span
              className="store-card-rating"
              style={{ background: ratingColor(game.rating) }}
              title={`IGDB: ${Math.round(game.rating)}%`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {Math.round(game.rating)}%
            </span>
          ) : (
            <span className="store-card-empty-dash">–</span>
          )}

          {crackStatus && (
            <span
              className={`store-card-cw-badge${crackStatus.isCracked ? " cw-cracked" : " cw-uncracked"}`}
              title={crackStatus.isCracked ? t("store.gameCard.cracked") : t("store.gameCard.uncracked")}
            >
              {crackStatus.isCracked ? t("crackwatch.cracked") : t("crackwatch.uncracked")}
            </span>
          )}
        </div>

        <div className="store-card-list-price">
          {price && price.salePrice != null ? (
            <>
              {price.isOnSale && price.discountPercent > 0 && (
                <span className="store-card-price-discount">
                  -{price.discountPercent}%
                </span>
              )}
              <span className="store-card-price-now">
                ${price.salePrice.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="store-card-empty-dash">–</span>
          )}
        </div>

        <div className="store-card-list-actions" onClick={(e) => e.stopPropagation()}>
          {onCompare && (
            <button
              type="button"
              className="store-card-action-btn"
              onClick={(e) => onCompare(game, e)}
              title={t("store.addToCompare")}
              aria-label={t("store.addToCompare")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </button>
          )}

          {showHeart && (
            <button
              type="button"
              className={`store-card-action-btn${wishlisted ? " active" : ""}`}
              onClick={(e) => onToggleWishlist!(game, e)}
              title={wishlisted ? t("store.spotlight.wishlisted") : t("store.spotlight.addToWishlist")}
              aria-pressed={wishlisted}
            >
              <svg
                viewBox="0 0 24 24"
                fill={wishlisted ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="14"
                height="14"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Grid/Cinematic/Compact view representation
  return (
    <div
      className={`store-game-card density-${density}${selectable ? " selectable" : ""}${selected ? " selected" : ""}`}
      onClick={(e) => {
        if (selectable && onToggleSelect) {
          onToggleSelect(game, e);
        } else {
          onClick(game);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectable && onToggleSelect) {
            onToggleSelect(game, e as unknown as MouseEvent);
          } else {
            onClick(game);
          }
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${game.name}${game.rating != null ? `, ${t("store.gameCard.rated", { rating: Math.round(game.rating) })}` : ""}${inLibrary ? `, ${t("storeCard.inLibrary")}` : ""}`}
      data-density={density}
      data-wishlisted={wishlisted ? "true" : "false"}
    >
      <div className="store-card-cover">
        {selectable && (
          <span
            className={`store-card-select${selected ? " checked" : ""}`}
            aria-hidden="true"
          >
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}

        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              ref={displayUrl === coverUrl ? imgRef : undefined}
              src={staticPosterUrl || displayUrl!}
              alt={game.name}
              loading="lazy"
              decoding="async"
              onError={handleError}
              className="store-card-cover-static"
            />
            {animatedPosterUrl && hovered && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="store-card-cover-animated is-active"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="store-card-cover-skeleton">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity={0.3}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}

        {game.rating != null && (
          <span
            className="store-card-rating"
            style={{ background: ratingColor(game.rating) }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="10"
              height="10"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {Math.round(game.rating)}%
          </span>
        )}

        {crackStatus && (
          <span
            className={`store-card-cw-badge ui-complete-only${crackStatus.isCracked ? " cw-cracked" : " cw-uncracked"}`}
            title={crackStatus.isCracked ? t("store.gameCard.cracked") : t("store.gameCard.uncracked")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="10"
              height="10"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {crackStatus.isCracked ? t("crackwatch.cracked") : t("crackwatch.uncracked")}
          </span>
        )}

        {inLibrary && (
          <span className="store-card-inlib" title={t("storeCard.inLibrary")}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="10"
              height="10"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t("store.inLibrary")}
          </span>
        )}

        {onHide && (
          <button
            type="button"
            className="store-card-hide"
            aria-label={t("store.gameCard.hideAria", { name: game.name })}
            title={t("store.notInterested")}
            onClick={(e) => {
              e.stopPropagation();
              onHide(game, e);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        )}

        {onCompare && (
          <button
            type="button"
            className="store-card-compare ui-complete-only"
            aria-label={t("store.gameCard.addToCompareAria", { name: game.name })}
            title={t("store.addToCompare")}
            onClick={(e) => {
              e.stopPropagation();
              onCompare(game, e);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
        )}

        {showHeart && (
          <button
            type="button"
            className={`store-card-heart${wishlisted ? " active" : ""}`}
            aria-label={
              wishlisted
                ? t("store.gameCard.removeWishlistAria", { name: game.name })
                : t("store.gameCard.addWishlistAria", { name: game.name })
            }
            aria-pressed={wishlisted}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWishlist!(game, e);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill={wishlisted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {showBody && (
        <div className="store-card-body">
          <h3 className="store-card-name" title={game.name}>
            <StoreHighlightText text={game.name} query={searchQuery} />
          </h3>

          {(game.genres?.length ?? 0) > 0 && (
            <div className="store-card-genres">
              {game.genres!.slice(0, genresToShow).map((g) => (
                <span key={g} className="store-card-genre">
                  <StoreHighlightText text={g} query={searchQuery} />
                </span>
              ))}
            </div>
          )}

          <div className="store-card-platforms">
            {(game.platforms?.length ?? 0) > 0 ? (
              game.platforms!.slice(0, 3).map((p, idx, arr) => (
                <Fragment key={p}>
                  <StoreHighlightText text={p} query={searchQuery} />
                  {idx < arr.length - 1 ? " · " : null}
                </Fragment>
              ))
            ) : (
              (releaseYear ?? "")
            )}
          </div>

          {price && price.salePrice != null && (
            <div className="store-card-price">
              {price.isOnSale && price.discountPercent > 0 && (
                <span className="store-card-price-discount">
                  -{price.discountPercent}%
                </span>
              )}
              <span className="store-card-price-now">
                ${price.salePrice.toFixed(2)}
              </span>
              {price.isOnSale && price.normalPrice != null && (
                <span className="store-card-price-was">
                  ${price.normalPrice.toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const StoreGameCard = memo(StoreGameCardBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.searchQuery === next.searchQuery &&
    prev.density === next.density &&
    prev.wishlisted === next.wishlisted &&
    prev.inLibrary === next.inLibrary &&
    prev.selectable === next.selectable &&
    prev.selected === next.selected
  );
});

export default StoreGameCard;
