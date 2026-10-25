import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, ShoppingCart, Star, Store, X } from "lucide-react";
import { Badge, Button } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { SteamDlcItem } from "../../../types/steam";
import { cleanDescription, isOnSale } from "./dlcData";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DlcModalProps {
  dlc: SteamDlcItem;
  onClose: () => void;
  onToggleWatch: (dlc: SteamDlcItem) => void;
  onToggleOwned: (dlc: SteamDlcItem) => void;
  onOpenStore: (dlc: SteamDlcItem) => void;
}

/**
 * Centered inspector for one add-on. The tab owns the catalog; this modal
 * carries the add-on's art, status, price and description, and closes back
 * to the row or card that opened it.
 */
export default function DlcModal({
  dlc,
  onClose,
  onToggleWatch,
  onToggleOwned,
  onOpenStore,
}: DlcModalProps) {
  const { t } = useLanguage();
  const headingId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const sale = isOnSale(dlc);
  const description = cleanDescription(dlc.shortDescription);

  // Remember the opener and move focus into the modal; restore on close.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => {
      window.clearTimeout(timer);
      openerRef.current?.focus();
    };
  }, []);

  // Escape closes, Tab stays inside the modal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = modalRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={modalRef}
        className="modal dlc-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div className={`dlc-modal__hero${dlc.headerImage ? "" : " is-empty"}`}>
          {dlc.headerImage && <img src={dlc.headerImage} alt="" loading="lazy" />}
          <span className="dlc-modal__scrim" aria-hidden="true" />

          <button
            ref={closeRef}
            type="button"
            className="dlc-modal__close"
            onClick={onClose}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={17} />
          </button>

          <div className="dlc-modal__intro">
            <span className="dlc-modal__eyebrow">{t("dlc.detailsTitle")}</span>
            <h2 id={headingId} className="dlc-modal__title">
              {dlc.name}
            </h2>
            <span className="dlc-modal__released">
              {dlc.releaseDate
                ? t("dlc.releasedOn", { date: dlc.releaseDate })
                : t("dlc.releaseUnknown")}
            </span>
            <div className="dlc-modal__badges">
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
                  <Star size={11} fill="currentColor" aria-hidden="true" />{" "}
                  {t("dlc.watching")}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="modal-body dlc-modal__body">
          <dl className="dlc-modal__meta">
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
                  <s className="dlc-modal__was">{dlc.initialPriceFormatted}</s>
                )}
              </dd>
            </div>
            <div>
              <dt>{t("dlc.appId")}</dt>
              <dd className="dlc-modal__mono">{dlc.appId}</dd>
            </div>
          </dl>

          <section className="dlc-modal__section">
            <h3>{t("dlc.aboutThisDlc")}</h3>
            <p>
              {description ||
                (dlc.priceFormatted
                  ? t("dlc.noDescription")
                  : t("dlc.noCatalogDescription"))}
            </p>
          </section>
        </div>

        <footer className="modal-footer">
          <div className="dlc-modal__footer-left">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenStore(dlc)}
              leftIcon={<Store size={15} />}
            >
              {t("dlc.openInStore")}
            </Button>
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
          </div>
          <div className="modal-footer-actions">
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
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
