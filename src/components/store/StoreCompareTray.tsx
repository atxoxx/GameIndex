import { createPortal } from "react-dom";
import type { StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { COMPARE_MAX } from "./storeCompare";

interface StoreCompareTrayProps {
  games: StoreGameSummary[];
  onRemove: (slug: string) => void;
  onClear: () => void;
  onOpen: () => void;
}

/**
 * StoreCompareTray: a docked strip showing the games the user has pinned
 * for comparison (up to {@link COMPARE_MAX}). The Compare button stays
 * disabled until at least two games are pinned, and explains why.
 *
 * Rendered through a portal to `document.body`: WebKitGTK keeps the
 * animated page wrappers as the containing block for `position: fixed`
 * descendants (their `transform: none` fill computes to an identity
 * matrix), which parked the tray at the bottom of the page content
 * instead of the viewport.
 */
export default function StoreCompareTray({
  games,
  onRemove,
  onClear,
  onOpen,
}: StoreCompareTrayProps) {
  const { t } = useLanguage();
  if (games.length === 0) return null;

  const canCompare = games.length >= 2;

  return createPortal(
    <div
      className="store-compare-tray ui-complete-only"
      role="region"
      aria-label={t("store.compare.trayAria")}
    >
      <span className="store-compare-tray-label">
        {t("store.compare.tray", { count: games.length, max: COMPARE_MAX })}
      </span>
      <div className="store-compare-tray-items">
        {games.map((g) => (
          <span key={g.slug} className="store-compare-chip" title={g.name}>
            {g.coverUrl && (
              <img src={g.coverUrl} alt="" className="store-compare-chip-thumb" />
            )}
            <span className="store-compare-chip-name">{g.name}</span>
            <button
              type="button"
              className="store-compare-chip-remove"
              onClick={() => onRemove(g.slug)}
              aria-label={t("store.compare.removeFromCompare", { name: g.name })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="store-compare-tray-actions">
        <button
          type="button"
          className="store-compare-open"
          onClick={onOpen}
          disabled={!canCompare}
          title={canCompare ? t("store.compare.open") : t("store.compare.trayHint")}
        >
          {t("store.compare.open")}
        </button>
        <button type="button" className="store-compare-clear" onClick={onClear}>
          {t("store.compare.clear")}
        </button>
      </div>
    </div>,
    document.body
  );
}
