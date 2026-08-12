import { Fragment } from "react";
import type { SortKey, DisplayMatch } from "./types";
import { ResultRow } from "./ResultRow";
import { useLanguage } from "../../context/LanguageContext";

export function ResultsList({
  matches,
  selectedId,
  onSelect,
  showWeakMatches,
  onToggleWeak,
  isDownloaded,
  sortBy,
  onSortChange,
}: {
  matches: DisplayMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showWeakMatches: boolean;
  onToggleWeak: () => void;
  isDownloaded: (title: string) => boolean;
  sortBy: SortKey;
  onSortChange: (sortBy: SortKey) => void;
}) {
  const { t } = useLanguage();

  if (matches.length === 0) {
    return (
      <div className="dl-results-empty">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p>{t("downloads.noMatchesFound")}</p>
        <p className="dl-results-empty-hint">
          {t("downloadModal.addMoreSources")}
        </p>
        <p className="dl-results-empty-hint">
          {t("downloadModal.jsonFormatHint")}
        </p>
      </div>
    );
  }

  // Keep the high-confidence matches (>= 0.4) always visible; collapse
  // the weaker ones behind a toggle so a wall of "Possible" results
  // doesn't bury the good hit. `realIndex` maps back into `matches`.
  // Plugin rows are exempt from the collapse: they are a deliberate,
  // backend-ordered block and must stay visible as a unit.
  const visible = matches
    .map((match, realIndex) => ({ match, realIndex }))
    .filter(
      ({ match }) =>
        showWeakMatches || match.matchScore >= 0.4 || match.provider === "plugin",
    );
  const weakCount = matches.filter(
    (m) => m.matchScore < 0.4 && m.provider !== "plugin",
  ).length;

  return (
    <div>
      <div className="dl-results-header">
        <span className="dl-results-header-title">{t("downloads.sources")}</span>
        <label className="dl-sort">
          <span className="dl-sort-label">{t("downloads.sort")}</span>
          <select
            className="dl-sort-select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            aria-label={t("downloads.sortResultsAria")}
          >
            <option value="date">{t("downloads.sortDateNewest")}</option>
            <option value="source">{t("downloads.sortSource")}</option>
            <option value="relevance">{t("downloads.sortRelevance")}</option>
          </select>
        </label>
      </div>

      <div className="dl-results-list">
        {visible.map(({ match, realIndex }, index) => {
          const prev = index > 0 ? visible[index - 1].match : undefined;
          const startsPluginBlock =
            match.provider === "plugin" && (!prev || prev.provider !== "plugin");
          return (
            <Fragment key={match.id ?? `${match.sourceId}-${realIndex}`}>
              {startsPluginBlock && (
                <div className="dl-results-group-divider">
                  <span>{t("downloadModal.pluginResults")}</span>
                </div>
              )}
              <ResultRow
                match={match}
                selected={selectedId === (match.id ?? null)}
                onSelect={onSelect}
                isDownloaded={isDownloaded}
              />
            </Fragment>
          );
        })}
      </div>

      {weakCount > 0 && (
        <button
          type="button"
          className="dl-toggle-weak"
          onClick={onToggleWeak}
          aria-expanded={showWeakMatches}
        >
          {showWeakMatches
            ? t("downloadModal.hideWeakMatches")
            : t("downloadModal.showWeakMatches", {
                count: weakCount,
                plural: weakCount !== 1 ? "es" : "",
              })}
        </button>
      )}
    </div>
  );
}
