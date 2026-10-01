import { useLanguage } from "../../context/LanguageContext";
import type { DisplayMatch } from "./types";

/**
 * Floating tray listing the results pinned for side-by-side comparison.
 */
export function CompareTray({
  matches,
  onRemove,
  onClear,
  onOpen,
}: {
  matches: DisplayMatch[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  if (matches.length === 0) return null;

  return (
    <div className="dl-compare-tray" role="region" aria-label={t("downloadModal.compareTitle")}>
      <span className="dl-compare-tray-label">
        {t("downloadModal.compare")}
      </span>
      <div className="dl-compare-tray-chips">
        {matches.map((m) => (
          <span key={m.id} className="dl-compare-chip" title={m.title}>
            <span className="dl-compare-chip-text">{m.title}</span>
            <button
              type="button"
              className="dl-compare-chip-remove"
              onClick={() => onRemove(m.id)}
              aria-label={t("downloadModal.compareUnpin")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="dl-compare-tray-actions">
        <button type="button" className="dl-compare-clear-btn" onClick={onClear} title={t("common.clear")}>
          {t("common.clear")}
        </button>
        <button type="button" className="dl-compare-open-btn" onClick={onOpen}>
          {t("downloadModal.compareCount", { count: matches.length })}
        </button>
      </div>
    </div>
  );
}
