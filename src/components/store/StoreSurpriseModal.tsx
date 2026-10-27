import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import StoreGameCard from "./StoreGameCard";

const SURPRISE_LIMIT = 12;

interface StoreSurpriseModalProps {
  onClose: () => void;
  onOpenGame: (game: StoreGameSummary) => void;
}

/**
 * StoreSurpriseModal: a batch of random IGDB games with a "shuffle again"
 * button that fetches a fresh set. Clicking any card opens its detail page.
 */
export default function StoreSurpriseModal({
  onClose,
  onOpenGame,
}: StoreSurpriseModalProps) {
  const { t } = useLanguage();
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  const loadRandom = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<StoreGameSummary[]>("get_random_store_games", {
        limit: SURPRISE_LIMIT,
      });
      setGames(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRandom();
  }, [loadRandom]);

  // Rendered through a portal to document.body so the fixed scrim escapes
  // the `.store-spotlight` overflow/stacking context and floats above the
  // rest of the app chrome (same pattern as the other app modals).
  return createPortal(
    <div className="store-surprise-scrim" onClick={onClose}>
      <div
        className="store-surprise-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("store.surprise.modalTitle")}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="store-surprise-modal-header">
          <div className="store-surprise-modal-heading">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            <h2>{t("store.surprise.modalTitle")}</h2>
          </div>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>}
            ref={closeRef}
            type="button"
            
            onClick={onClose}
            aria-label={t("store.surprise.close")}
          ></Button>
        </div>

        <div className="store-surprise-modal-body">
          {loading ? (
            <div className="store-surprise-status">
              <div className="store-spinner" />
              <span>{t("store.surprise.loading")}</span>
            </div>
          ) : error || games.length === 0 ? (
            <div className="store-surprise-status">
              <p>{error ? t("store.surprise.error") : t("store.surprise.empty")}</p>
            </div>
          ) : (
            <div className="store-game-grid store-surprise-grid">
              {games.map((g, i) => (
                <div
                  key={g.slug}
                  className="store-game-cell"
                  style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}
                >
                  <StoreGameCard game={g} onClick={onOpenGame} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="store-surprise-modal-footer">
          <Button
            variant="secondary"
            size="sm"
            isLoading={loading}
            onClick={loadRandom}
            leftIcon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            }
          >
            {t("store.surprise.refresh")}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
