import { Fragment } from "react";
import type { SortKey, DisplayMatch, SourceFilterOption } from "./types";
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
  sourceFilter,
  onSourceFilterChange,
  sourceFilterOptions,
  searchQuery,
  onSearchQueryChange,
  totalRawMatchesCount,
  onClearFilters,
  searchProgress,
}: {
  matches: DisplayMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showWeakMatches: boolean;
  onToggleWeak: () => void;
  isDownloaded: (title: string) => boolean;
  sortBy: SortKey;
  onSortChange: (sortBy: SortKey) => void;
  sourceFilter: string;
  onSourceFilterChange: (filter: string) => void;
  sourceFilterOptions: SourceFilterOption[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  totalRawMatchesCount: number;
  onClearFilters: () => void;
  searchProgress?: {
    completed: number;
    total: number;
    activeSource: string;
    isDone: boolean;
  } | null;
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
        </div>
        <h4 className="dl-results-empty-title">{t("downloads.noMatchesFound")}</h4>
        <p className="dl-results-empty-hint">
          {t("downloadModal.addMoreSources")}
        </p>
      </div>
    );
  }

  // Keep high-confidence matches (>= 0.4) always visible; collapse weaker ones behind toggle
  const visible = matches
    .map((match, realIndex) => ({ match, realIndex }))
    .filter(
      ({ match }) =>
        showWeakMatches ||
        match.matchScore >= 0.4 ||
        match.provider === "plugin" ||
        sourceFilter !== "all",
    );

  const weakCount = matches.filter(
    (m) => m.matchScore < 0.4 && m.provider !== "plugin" && sourceFilter === "all",
  ).length;

  const hasActiveFilters = sourceFilter !== "all" || Boolean(searchQuery.trim());
  const showControls = totalRawMatchesCount > 1;
  const showPills = sourceFilterOptions.length > 2;
  const showSearch = totalRawMatchesCount > 3 || Boolean(searchQuery.trim());

  return (
    <div className="dl-results-container">
      {/* Header Toolbar */}
      <div className="dl-results-header">
        <div className="dl-results-header-left">
          <span className="dl-results-header-title">{t("downloads.sources")}</span>
          <span className="dl-results-total-badge">
            {matches.length}
            {matches.length !== totalRawMatchesCount && (
              <span className="dl-results-total-sub">/{totalRawMatchesCount}</span>
            )}
          </span>
        </div>

        {showControls && (
          <div className="dl-results-header-controls">
            {/* Quick Search */}
            {showSearch && (
              <div className="dl-quick-filter-wrap">
                <svg
                  className="dl-quick-filter-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="dl-quick-filter-input"
                  placeholder={t("downloadModal.filterPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  aria-label={t("downloadModal.filterPlaceholder")}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="dl-quick-filter-clear"
                    onClick={() => onSearchQueryChange("")}
                    aria-label="Clear filter"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            {/* Sort Selector */}
            <label className="dl-sort">
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
        )}
      </div>

      {/* Live Search Progress Bar (when searching multiple sources) */}
      {searchProgress && searchProgress.total > 1 && !searchProgress.isDone && (
        <div
          className="dl-search-progress-bar"
          role="progressbar"
          aria-valuenow={searchProgress.completed}
          aria-valuemin={0}
          aria-valuemax={searchProgress.total}
        >
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
      )}

      {/* Multi-Source Selection Pill Bar (only if multiple sources available) */}
      {showPills && (
        <div className="dl-source-pills-bar" role="tablist" aria-label={t("downloadModal.filterBySource")}>
          {sourceFilterOptions.map((opt) => {
            const isSelected = sourceFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`dl-source-pill${isSelected ? " selected" : ""}${
                  opt.provider === "plugin" ? " dl-source-pill--plugin" : ""
                }`}
                onClick={() => onSourceFilterChange(opt.id)}
              >
                <span className="dl-source-pill-label">{opt.label}</span>
                <span className="dl-source-pill-count">{opt.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Results List or Empty Filter State */}
      {visible.length === 0 ? (
        <div className="dl-filter-empty-state">
          <p>{t("downloadModal.noMatchesForFilter")}</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="dl-clear-filter-btn"
              onClick={onClearFilters}
            >
              {t("downloadModal.clearFilter")}
            </button>
          )}
        </div>
      ) : (
        <div className="dl-results-list scrollable">
          {visible.map(({ match, realIndex }, index) => {
            const prev = index > 0 ? visible[index - 1].match : undefined;
            const startsPluginBlock =
              sourceFilter === "all" &&
              match.provider === "plugin" &&
              (!prev || prev.provider !== "plugin") &&
              visible.some((v) => v.match.provider !== "plugin"); // Only show divider if mixed
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
      )}

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

