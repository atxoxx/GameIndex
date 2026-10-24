import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useDealsArt, useSgdbArtByName } from "./useDealsArt";

export interface DealModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Source artwork used as the hero backdrop. */
  image?: string | null;
  /** Steam AppID, when known, unlocks wide SteamGridDB hero art. */
  appId?: number | null;
  tint: string;
  badges?: ReactNode;
  /** Stat strip rendered at the top of the scroll area. */
  stats?: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * DealModalShell - the shared frame for the deal and playtest detail modals.
 *
 * Owns the parts a modal keeps getting wrong: a focus trap, Escape handling,
 * scroll-lock restoration, focus return to the invoking card, and one hero
 * treatment. Callers supply content and footer actions.
 */
export default function DealModalShell({
  open,
  onClose,
  title,
  subtitle,
  image,
  appId,
  tint,
  badges,
  stats,
  footerLeft,
  footerRight,
  children,
}: DealModalShellProps) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Name-based artwork only matters when the Steam ladder has no AppID.
  const nameArt = useSgdbArtByName(title, open && !appId);
  const art = useDealsArt({
    appId,
    image: nameArt?.heroUrl ?? image,
    variant: "hero",
  });

  // Stable across parent re-renders: the effect below must not tear down the
  // scroll lock and focus restore every time the page re-renders behind it.
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => element.offsetParent !== null || element === dialog);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop deals-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal deals-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deals-modal-title"
        tabIndex={-1}
      >
        <div
          className={`deals-modal__hero${art.url ? "" : " is-empty"}`}
          style={{ ["--deals-tint" as string]: tint }}
        >
          {art.url ? (
            <img
              className="deals-modal__hero-art"
              src={art.url}
              alt=""
              aria-hidden="true"
              onError={art.onError}
            />
          ) : (
            <div
              className="deals-modal__hero-art deals-modal__hero-art--empty"
              aria-hidden="true"
            />
          )}
          <span className="deals-modal__hero-scrim" aria-hidden="true" />

          <button
            type="button"
            className="deals-modal__close"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X size={17} aria-hidden="true" />
          </button>

          <div className="deals-modal__intro">
            {badges && <div className="deals-modal__badges">{badges}</div>}
            <h2 id="deals-modal-title" className="deals-modal__title">
              {title}
            </h2>
            {subtitle && <div className="deals-modal__subtitle">{subtitle}</div>}
          </div>
        </div>

        <div className="deals-modal__scroll">
          {stats && <div className="deals-modal__stats">{stats}</div>}
          {children}
        </div>

        {(footerLeft || footerRight) && (
          <footer className="deals-modal__footer">
            <div className="deals-modal__footer-left">{footerLeft}</div>
            <div className="deals-modal__footer-right">{footerRight}</div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface DealModalStatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "accent" | "success" | "warning";
}

/** One cell of the modal's headline numbers. */
export function DealModalStat({ label, value, hint, tone = "default" }: DealModalStatProps) {
  return (
    <div className="deals-modal__stat" data-tone={tone} title={hint}>
      <span className="deals-modal__stat-label">{label}</span>
      <span className="deals-modal__stat-value">{value}</span>
    </div>
  );
}

export interface DealModalSectionProps {
  title: string;
  children: ReactNode;
}

/** A titled block inside the modal body. */
export function DealModalSection({ title, children }: DealModalSectionProps) {
  return (
    <section className="deals-modal__section">
      <h3 className="deals-modal__section-title">{title}</h3>
      {children}
    </section>
  );
}
