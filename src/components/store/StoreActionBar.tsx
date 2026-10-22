import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { formatSteamPrice, useSteamGameStats } from "../../hooks/useSteamGameStats";
import DownloadButton from "../DownloadButton";

interface StoreActionBarProps {
  /** The bar only exists once the hero action cluster has scrolled away. */
  visible: boolean;
  title: string;
  coverUrl?: string | null;
  steamAppId?: number;
  isInLibrary: boolean;
  libraryGameId?: string;
  wishlisted: boolean;
  onToggleWishlist: () => void;
  onAdd: () => void;
  adding: boolean;
  onOpenLibrary: () => void;
}

/**
 * StoreActionBar
 * ──────────────
 * Docked action bar for the store detail page. The purchase / download pair
 * only lives in the hero today, so scrolling into the description or the
 * reviews leaves the page without a way to act on the game. This bar fades in
 * once the hero leaves the viewport and repeats the same three actions with
 * the Steam price (when the title has one) for context.
 *
 * Rendered through a portal to `document.body` — the same approach as
 * `StoreBulkBar` — so the fixed positioning is not trapped by a transformed
 * ancestor inside the page.
 */
export default function StoreActionBar({
  visible,
  title,
  coverUrl,
  steamAppId,
  isInLibrary,
  libraryGameId,
  wishlisted,
  onToggleWishlist,
  onAdd,
  adding,
  onOpenLibrary,
}: StoreActionBarProps) {
  const { t } = useLanguage();
  const { data: steamStats } = useSteamGameStats(steamAppId);
  const price = steamStats?.details
    ? formatSteamPrice(
        steamStats.details.priceCents,
        steamStats.details.currency,
        steamStats.details.isFree,
      )
    : null;
  const showPrice = !isInLibrary && price != null && price !== "—";

  if (!visible) return null;

  return createPortal(
    <div
      className="store-action-bar"
      role="region"
      aria-label={t("store.actionsBar")}
    >
      <div className="store-action-bar__identity">
        {coverUrl && (
          <img
            className="store-action-bar__cover"
            src={coverUrl}
            alt=""
            loading="lazy"
          />
        )}
        <div className="store-action-bar__text">
          <span className="store-action-bar__title" title={title}>
            {title}
          </span>
          {showPrice && (
            <span className="store-action-bar__price">{price}</span>
          )}
        </div>
      </div>

      <div className="store-action-bar__actions">
        <button
          type="button"
          className={`store-action-bar__wish${wishlisted ? " is-active" : ""}`}
          onClick={onToggleWishlist}
          aria-pressed={wishlisted}
          aria-label={
            wishlisted
              ? t("store.gameCard.removeWishlistAria", { name: title })
              : t("store.gameCard.addWishlistAria", { name: title })
          }
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
          <span>
            {wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}
          </span>
        </button>

        {isInLibrary ? (
          <button
            type="button"
            className="game-launch-btn store-action-bar__primary"
            onClick={onOpenLibrary}
            disabled={!libraryGameId}
          >
            {t("store.viewInLibrary")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="store-add-btn store-action-bar__primary"
              onClick={onAdd}
              disabled={adding}
            >
              {adding ? t("store.adding") : t("store.addToLibrary")}
            </button>
            <DownloadButton
              gameName={title}
              gamePoster={coverUrl ?? undefined}
              steamAppId={steamAppId}
              className="store-action-bar__download"
              label={t("game.findDownload")}
            />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
