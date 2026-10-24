import type { MouseEvent, ReactNode } from "react";
import { Check, Copy, ExternalLink, Heart, Tag } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import { useDealsArt } from "./useDealsArt";

export type DealsCardKind = "deal" | "gamepass" | "giveaway" | "playtester";

export interface DealsCardAction {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}

export interface DealsCardProps {
  kind: DealsCardKind;
  title: string;
  subtitle?: string | null;
  image?: string | null;
  appId?: number | null;
  /** Store/kind label drawn on the no-artwork fallback. */
  fallbackLabel?: string | null;
  /** Store/brand accent used by fallback art and the store dot. */
  tint: string;
  discount?: number | null;
  price?: string | null;
  originalPrice?: string | null;
  priceNote?: string | null;
  meta?: ReactNode;
  topBadges?: ReactNode;
  status?: { label: string; tone: "success" | "warning" | "danger" | "muted" } | null;
  actions?: {
    wishlist?: DealsCardAction;
    copy?: DealsCardAction & { done?: boolean };
    open?: DealsCardAction;
  };
  menu?: ReactNode;
  onOpen: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  ariaLabel: string;
  index: number;
  density: ViewDensity;
}

/**
 * DealsCard - the single card shell for every deals source.
 *
 * Landscape art keeps the price and store information readable at a glance,
 * which portrait posters could not do once a card had to show a best price, a
 * cross-store count and a countdown. Source cards supply the strings and
 * handlers; the shell owns art fallbacks, hover motion and quick actions.
 */
export default function DealsCard({
  kind,
  title,
  subtitle,
  image,
  appId,
  fallbackLabel,
  tint,
  discount,
  price,
  originalPrice,
  priceNote,
  meta,
  topBadges,
  status,
  actions,
  menu,
  onOpen,
  onContextMenu,
  ariaLabel,
  index,
  density,
}: DealsCardProps) {
  const art = useDealsArt({ appId, image });
  const showArt = Boolean(art.url);

  return (
    <article
      className={`deals-tile deals-tile--${kind}`}
      data-density={density}
      style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={onContextMenu}
    >
      <div
        className={`deals-tile__art${showArt ? " has-art" : ""}`}
        style={{ ["--deals-tint" as string]: tint }}
      >
        {showArt ? (
          <img
            className="deals-tile__img"
            src={art.url ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            onError={art.onError}
          />
        ) : (
          <div className="deals-tile__art-fallback" aria-hidden="true">
            <Tag size={26} strokeWidth={1.5} />
            {fallbackLabel && (
              <span className="deals-tile__art-label">{fallbackLabel}</span>
            )}
          </div>
        )}

        <span className="deals-tile__art-scrim" aria-hidden="true" />

        {topBadges && <div className="deals-tile__badges">{topBadges}</div>}

        {discount != null && discount > 0 && (
          <span
            className={`deals-tile__discount${
              discount >= 75 ? " is-hot" : ""
            }`}
          >
            -{discount}%
          </span>
        )}

        {status && (
          <span className={`deals-tile__status deals-tile__status--${status.tone}`}>
            <i aria-hidden="true" />
            {status.label}
          </span>
        )}

        {(actions?.wishlist || actions?.copy || actions?.open) && (
          <div className="deals-tile__actions">
            {actions?.wishlist && (
              <button
                type="button"
                className={`deals-tile__action${actions.wishlist.active ? " is-active" : ""}`}
                title={actions.wishlist.label}
                aria-label={actions.wishlist.label}
                aria-pressed={actions.wishlist.active}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.wishlist?.onClick(event);
                }}
              >
                <Heart
                  size={15}
                  fill={actions.wishlist.active ? "currentColor" : "none"}
                />
              </button>
            )}

            {actions?.copy && (
              <button
                type="button"
                className={`deals-tile__action${actions.copy.done ? " is-done" : ""}`}
                title={actions.copy.label}
                aria-label={actions.copy.label}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.copy?.onClick(event);
                }}
              >
                {actions.copy.done ? <Check size={15} /> : <Copy size={15} />}
              </button>
            )}

            {actions?.open && (
              <button
                type="button"
                className="deals-tile__action"
                title={actions.open.label}
                aria-label={actions.open.label}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.open?.onClick(event);
                }}
              >
                <ExternalLink size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="deals-tile__body">
        <h3 className="deals-tile__title" title={title}>
          {title}
        </h3>

        {subtitle && (
          <p className="deals-tile__subtitle" title={subtitle}>
            {subtitle}
          </p>
        )}

        {(price || priceNote) && (
          <div className="deals-tile__price-row">
            {price && <span className="deals-tile__price">{price}</span>}
            {originalPrice && (
              <span className="deals-tile__price-old">{originalPrice}</span>
            )}
            {priceNote && <span className="deals-tile__price-note">{priceNote}</span>}
          </div>
        )}

        {meta && <div className="deals-tile__meta">{meta}</div>}
      </div>

      {menu}
    </article>
  );
}
