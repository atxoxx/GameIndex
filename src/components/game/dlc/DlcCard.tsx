import { Check, ShoppingCart, Star, Store } from "lucide-react";
import { Badge, Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { SteamDlcItem } from "../../../types/steam";
import { isOnSale } from "./dlcData";

export interface DlcCardProps {
  dlc: SteamDlcItem;
  onOpen: (dlc: SteamDlcItem) => void;
  onToggleWatch: (dlc: SteamDlcItem) => void;
  onToggleOwned: (dlc: SteamDlcItem) => void;
  onOpenStore: (dlc: SteamDlcItem) => void;
}

/** Gallery tile for one add-on. */
export default function DlcCard({
  dlc,
  onOpen,
  onToggleWatch,
  onToggleOwned,
  onOpenStore,
}: DlcCardProps) {
  const { t } = useLanguage();
  const sale = isOnSale(dlc);
  const discount = dlc.discountPercent ?? 0;

  return (
    <article className={`dlc-card${dlc.isOwned ? " is-owned" : ""}`}>
      <button
        type="button"
        className="dlc-card__open"
        onClick={() => onOpen(dlc)}
        aria-label={dlc.name}
      >
        <span className="dlc-card__art">
          {dlc.headerImage ? (
            <img src={dlc.headerImage} alt="" loading="lazy" />
          ) : (
            <span className="dlc-card__art-fallback" aria-hidden="true" />
          )}
          <span className="dlc-card__badges">
            {dlc.isOwned && (
              <Badge variant="success" size="sm">
                <Check size={11} aria-hidden="true" /> {t("dlc.owned")}
              </Badge>
            )}
            {dlc.isInstalled && (
              <Badge variant="info" size="sm">
                {t("dlc.installed")}
              </Badge>
            )}
            {dlc.isFree && (
              <Badge variant="accent" size="sm">
                {t("dlc.free")}
              </Badge>
            )}
            {sale && (
              <Badge variant="warning" size="sm">
                −{discount}%
              </Badge>
            )}
          </span>
        </span>

        <span className="dlc-card__body">
          <span className="dlc-card__title" title={dlc.name}>
            {dlc.name}
          </span>
          <span className="dlc-card__meta">
            {dlc.releaseDate || t("dlc.releaseUnknown")}
          </span>
          <span className="dlc-card__price-row">
            {sale && dlc.initialPriceFormatted && (
              <s className="dlc-card__price-was">{dlc.initialPriceFormatted}</s>
            )}
            <span
              className={`dlc-card__price${dlc.isFree ? " is-free" : ""}${
                sale ? " is-sale" : ""
              }`}
            >
              {dlc.isFree
                ? t("dlc.free")
                : dlc.priceFormatted || t("dlc.priceUnknown")}
            </span>
          </span>
        </span>
      </button>

      <div className="dlc-card__actions">
        <button
          type="button"
          className={`dlc-watch${dlc.isWatched ? " is-watched" : ""}`}
          onClick={() => onToggleWatch(dlc)}
          aria-pressed={Boolean(dlc.isWatched)}
          title={dlc.isWatched ? t("dlc.unwatch") : t("dlc.watch")}
        >
          <Star size={15} fill={dlc.isWatched ? "currentColor" : "none"} />
          <span>{dlc.isWatched ? t("dlc.watching") : t("dlc.watch")}</span>
        </button>

        <span className="dlc-card__spacer" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenStore(dlc)}
          title={t("dlc.openInStore")}
          aria-label={t("dlc.openInStore")}
        >
          <Store size={14} />
        </Button>

        <Button
          variant={dlc.isOwned ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onToggleOwned(dlc)}
        >
          {dlc.isOwned ? <Check size={13} /> : <ShoppingCart size={13} />}
          <span>{dlc.isOwned ? t("dlc.owned") : t("dlc.markOwned")}</span>
        </Button>
      </div>
    </article>
  );
}
