import { Fragment } from "react";
import type { DisplayMatch } from "./types";
import { ResultRow } from "./ResultRow";
import { useLanguage } from "../../context/LanguageContext";
import type { ParsedQuery } from "./searchQuery";
import type { SourceReliability } from "./reliability";

export function ResultsPane({
  matches,
  selectedId,
  onSelect,
  isDownloaded,
  installedVersion,
  highlightQuery,
  reliabilityFor,
  recommendedId,
  batchMode,
  batchSelected,
  onToggleBatch,
  compareIds,
  onToggleCompare,
  totalRawMatchesCount,
  searchProgress,
  hasActiveFilters,
  onClearFilters,
  weakCount,
  showWeakMatches,
  onToggleWeak,
}: {
  matches: DisplayMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isDownloaded: (title: string) => boolean;
  installedVersion?: string | null;
  highlightQuery?: ParsedQuery;
  reliabilityFor: (sourceName: string) => SourceReliability | undefined;
  recommendedId: string | null;
  batchMode: boolean;
  batchSelected: Set<string>;
  onToggleBatch: (id: string) => void;
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
  totalRawMatchesCount: number;
  searchProgress?: {
    completed: number;
    total: number;
    activeSource: string;
    isDone: boolean;
  } | null;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  weakCount: number;
  showWeakMatches: boolean;
  onToggleWeak: () => void;
}) {
  const { t } = useLanguage();

  if (totalRawMatchesCount === 0) {
    if (searchProgress && searchProgress.total > 1 && !searchProgress.isDone) {
      return (
        <div className="dl-results-empty">
          <div className="dl-search-progress-bar dl-search-progress-bar--standalone">
            <div className="dl-search-progress-header">
              <div className="dl-search-progress-label">
                <span className="dl-spinner-mini" aria-hidden />
                <span>
                  {searchProgress.activeSource
                    ? t("downloadModal.searchingSourceActive", {
                        source: searchProgress.activeSource,
                        completed: searchProgress.completed,
                        total: searchProgress.total,
                      })
                    : t("downloadModal.searchingSources", {
                        completed: searchProgress.completed,
                        total: searchProgress.total,
                      })}
                </span>
              </div>
              <span className="dl-search-progress-percent">
                {Math.round((searchProgress.completed / searchProgress.total) * 100)}%
              </span>
            </div>
            <div className="dl-search-progress-track">
              <div
                className="dl-search-progress-fill"
                style={{
                  width: `${Math.max(6, (searchProgress.completed / searchProgress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
          <p className="dl-results-empty-hint">{t("downloadModal.stepSearching")}</p>
        </div>
      );
    }

    return (
      <div className="dl-results-empty">
        <div className="dl-results-empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <h4 className="dl-results-empty-title">{t("downloads.noMatchesFound")}</h4>
        <p className="dl-results-empty-hint">{t("downloadModal.addMoreSources")}</p>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="dl-filter-empty-state">
        <div className="dl-filter-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <p className="dl-filter-empty-text">{t("downloadModal.noMatchesForFilter")}</p>
        {hasActiveFilters && (
          <button type="button" className="dl-clear-filters-btn" onClick={onClearFilters}>
            {t("downloadModal.clearFilter")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="dl-results-scrollable-list">
      {matches.map((match, index) => {
        const prev = index > 0 ? matches[index - 1] : undefined;
        const startsPluginBlock =
          match.provider === "plugin" && (!prev || prev.provider !== "plugin");

        return (
          <Fragment key={match.id ?? `${match.sourceId}-${index}`}>
            {startsPluginBlock && (
              <div className="dl-group-divider">
                <div className="dl-group-divider-line" />
                <span className="dl-group-divider-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  {t("downloadModal.pluginResults")}
                </span>
                <div className="dl-group-divider-line" />
              </div>
            )}
            <ResultRow
              match={match}
              selected={selectedId === (match.id ?? null)}
              onSelect={onSelect}
              isDownloaded={isDownloaded}
              installedVersion={installedVersion}
              highlightQuery={highlightQuery}
              reliability={reliabilityFor(match.sourceName)}
              recommended={match.id === recommendedId}
              batchMode={batchMode}
              batchChecked={batchSelected.has(match.id)}
              onToggleBatch={onToggleBatch}
              comparePinned={compareIds.has(match.id)}
              onToggleCompare={onToggleCompare}
            />
          </Fragment>
        );
      })}

      {weakCount > 0 && (
        <button
          type="button"
          className="dl-weak-matches-toggle"
          onClick={onToggleWeak}
          aria-expanded={showWeakMatches}
        >
          <svg
            className={`dl-weak-chevron${showWeakMatches ? " open" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>
            {showWeakMatches
              ? t("downloadModal.hideWeakMatches")
              : t("downloadModal.showWeakMatches", {
                  count: weakCount,
                  plural: weakCount !== 1 ? "es" : "",
                })}
          </span>
        </button>
      )}
    </div>
  );
}
