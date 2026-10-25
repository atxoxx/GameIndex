import { Check, Star, Store } from "lucide-react";
import { Badge, Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { SteamDlcItem } from "../../../types/steam";
import { isOnSale } from "./dlcData";

export interface DlcTableProps {
  dlcs: SteamDlcItem[];
  onOpen: (dlc: SteamDlcItem) => void;
  onToggleWatch: (dlc: SteamDlcItem) => void;
  onToggleOwned: (dlc: SteamDlcItem) => void;
  onOpenStore: (dlc: SteamDlcItem) => void;
}

/** Dense list view for large catalogs and bulk scanning. */
export default function DlcTable({
  dlcs,
  onOpen,
  onToggleWatch,
  onToggleOwned,
  onOpenStore,
}: DlcTableProps) {
  const { t } = useLanguage();

  return (
    <div className="dlc-table-wrap">
      <table className="dlc-table">
        <thead>
          <tr>
            <th scope="col">{t("dlc.tableAddon")}</th>
            <th scope="col">{t("dlc.status")}</th>
            <th scope="col" className="dlc-table__price-col">
              {t("dlc.tablePrice")}
            </th>
            <th
              scope="col"
              className="dlc-table__actions-col"
              aria-label={t("dlc.tableActions")}
            />
          </tr>
        </thead>
        <tbody>
          {dlcs.map((dlc) => {
            const sale = isOnSale(dlc);
            return (
              <tr key={dlc.appId} className={dlc.isOwned ? "is-owned" : undefined}>
                <td>
                  <button
                    type="button"
                    className="dlc-table__name"
                    onClick={() => onOpen(dlc)}
                  >
                    <span className="dlc-table__thumb" aria-hidden="true">
                      {dlc.headerImage ? (
                        <img src={dlc.headerImage} alt="" loading="lazy" />
                      ) : null}
                    </span>
                    <span className="dlc-table__text">
                      <span className="dlc-table__title">{dlc.name}</span>
                      <span className="dlc-table__release">
                        {dlc.releaseDate || t("dlc.releaseUnknown")}
                      </span>
                    </span>
                  </button>
                </td>
                <td>
                  <span className="dlc-table__badges">
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
                    {!dlc.isOwned && !sale && !dlc.isFree && (
                      <span className="dlc-table__muted">{t("dlc.unowned")}</span>
                    )}
                  </span>
                </td>
                <td className="dlc-table__price-col">
                  <span className={`dlc-table__price${sale ? " is-sale" : ""}`}>
                    {dlc.isFree
                      ? t("dlc.free")
                      : dlc.priceFormatted || t("dlc.priceUnknown")}
                  </span>
                  {sale && dlc.initialPriceFormatted && (
                    <s className="dlc-table__was">{dlc.initialPriceFormatted}</s>
                  )}
                </td>
                <td>
                  <div className="dlc-table__actions">
                    <button
                      type="button"
                      className={`dlc-watch dlc-watch--icon${
                        dlc.isWatched ? " is-watched" : ""
                      }`}
                      onClick={() => onToggleWatch(dlc)}
                      aria-pressed={Boolean(dlc.isWatched)}
                      title={dlc.isWatched ? t("dlc.unwatch") : t("dlc.watch")}
                      aria-label={dlc.isWatched ? t("dlc.unwatch") : t("dlc.watch")}
                    >
                      <Star size={14} fill={dlc.isWatched ? "currentColor" : "none"} />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenStore(dlc)}
                      aria-label={t("dlc.openInStore")}
                      title={t("dlc.openInStore")}
                    >
                      <Store size={14} />
                    </Button>
                    <Button
                      variant={dlc.isOwned ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => onToggleOwned(dlc)}
                      aria-label={dlc.isOwned ? t("dlc.unmarkOwned") : t("dlc.markOwned")}
                      title={dlc.isOwned ? t("dlc.unmarkOwned") : t("dlc.markOwned")}
                    >
                      <Check size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
