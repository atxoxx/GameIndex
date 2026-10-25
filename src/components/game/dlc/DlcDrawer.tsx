import { Check, ShoppingCart, Star, Store } from "lucide-react";
import { Badge, Button, DetailDrawer } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { SteamDlcItem } from "../../../types/steam";
import { cleanDescription, isOnSale } from "./dlcData";

export interface DlcDrawerProps {
  dlc: SteamDlcItem | null;
  onClose: () => void;
  onToggleWatch: (dlc: SteamDlcItem) => void;
  onToggleOwned: (dlc: SteamDlcItem) => void;
  onOpenStore: (dlc: SteamDlcItem) => void;
}

/** Right-hand inspector for one add-on. */
export default function DlcDrawer({
  dlc,
  onClose,
  onToggleWatch,
  onToggleOwned,
  onOpenStore,
}: DlcDrawerProps) {
  const { t } = useLanguage();
  if (!dlc) return null;

  const sale = isOnSale(dlc);
  const description = cleanDescription(dlc.shortDescription);

  return (
    <DetailDrawer
      open
      onClose={onClose}
      closeLabel={t("common.close")}
      eyebrow={t("dlc.detailsTitle")}
      title={dlc.name}
      description={
        dlc.releaseDate
          ? t("dlc.releasedOn", { date: dlc.releaseDate })
          : t("dlc.releaseUnknown")
      }
      media={
        dlc.headerImage ? (
          <img src={dlc.headerImage} alt="" loading="lazy" />
        ) : null
      }
      badges={
        <>
          {dlc.isOwned && (
            <Badge variant="success" size="sm">
              {t("dlc.owned")}
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
              −{dlc.discountPercent ?? 0}%
            </Badge>
          )}
          {dlc.isWatched && (
            <Badge variant="default" size="sm">
              <Star size={11} fill="currentColor" aria-hidden="true" /> {t("dlc.watching")}
            </Badge>
          )}
        </>
      }
      actions={
        <Button
          variant={dlc.isWatched ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onToggleWatch(dlc)}
          leftIcon={
            <Star size={14} fill={dlc.isWatched ? "currentColor" : "none"} />
          }
        >
          {dlc.isWatched ? t("dlc.watching") : t("dlc.watch")}
        </Button>
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenStore(dlc)}
            leftIcon={<Store size={15} />}
          >
            {t("dlc.openInStore")}
          </Button>
          <span className="dlc-drawer__spacer" />
          <Button
            variant={dlc.isOwned ? "secondary" : "primary"}
            size="sm"
            onClick={() => onToggleOwned(dlc)}
            leftIcon={
              dlc.isOwned ? <Check size={15} /> : <ShoppingCart size={15} />
            }
          >
            {dlc.isOwned ? t("dlc.unmarkOwned") : t("dlc.markOwned")}
          </Button>
        </>
      }
    >
      <dl className="dlc-drawer__meta">
        <div>
          <dt>{t("dlc.status")}</dt>
          <dd>{dlc.isOwned ? t("dlc.owned") : t("dlc.unowned")}</dd>
        </div>
        <div>
          <dt>{t("dlc.installed")}</dt>
          <dd>{dlc.isInstalled ? t("dlc.installed") : t("dlc.notInstalled")}</dd>
        </div>
        <div>
          <dt>{t("dlc.priceLabel")}</dt>
          <dd className={sale ? "is-sale" : undefined}>
            {dlc.isFree
              ? t("dlc.free")
              : dlc.priceFormatted || t("dlc.priceUnknown")}
            {sale && dlc.initialPriceFormatted && (
              <s className="dlc-drawer__was">{dlc.initialPriceFormatted}</s>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("dlc.appId")}</dt>
          <dd className="dlc-drawer__mono">{dlc.appId}</dd>
        </div>
      </dl>

      <section className="dlc-drawer__section">
        <h3>{t("dlc.aboutThisDlc")}</h3>
        <p>
          {description ||
            (dlc.priceFormatted
              ? t("dlc.noDescription")
              : t("dlc.noCatalogDescription"))}
        </p>
      </section>
    </DetailDrawer>
  );
}
