import { Fragment } from "react";
import type {
  SortKey,
  DisplayMatch,
  SourceFilterOption,
  PlatformFilter,
  DownloadTypeFilter,
} from "./types";
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
  platformFilter,
  onPlatformFilterChange,
  typeFilter,
  onTypeFilterChange,
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
  platformFilter: PlatformFilter;
  onPlatformFilterChange: (filter: PlatformFilter) => void;
  typeFilter: DownloadTypeFilter;
  onTypeFilterChange: (filter: DownloadTypeFilter) => void;
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

  const platformOptions: { id: PlatformFilter; label: string }[] = [
    { id: "all", label: t("downloadModal.filterAll") },
    { id: "pc", label: t("downloadModal.platformPc") },
    { id: "console", label: t("downloadModal.platformConsole") },
  ];

  const typeOptions: { id: DownloadTypeFilter; label: string }[] = [
    { id: "all", label: t("downloadModal.filterAll") },
    { id: "torrent", label: t("downloadModal.filterTorrent") },
    { id: "magnet", label: t("downloadModal.filterMagnet") },
    { id: "direct", label: t("downloadModal.filterDirect") },
  ];

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

  const hasActiveFilters =
    sourceFilter !== "all" ||
    platformFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(searchQuery.trim());

  const showControls = totalRawMatchesCount > 1;
  const showPills = sourceFilterOptions.length > 2;

  return (
    <div className="dl-results-container">
      {/* Top Filter & Search Bar */}
      {showControls && (
        <div className="dl-modal-toolbar">
          {/* Row 1: Search + Sort + Count */}
          <div className="dl-modal-toolbar-top">
            {/* Quick Search */}
            <div className="dl-search-box">
              <svg
                className="dl-search-icon"
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
                className="dl-search-input"
                placeholder={t("downloadModal.filterPlaceholder")}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                aria-label={t("downloadModal.filterPlaceholder")}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="dl-search-clear-btn"
                  onClick={() => onSearchQueryChange("")}
                  aria-label="Clear filter"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Sort Control */}
            <div className="dl-sort-wrapper">
              <span className="dl-sort-label">{t("achievements.sort")}</span>
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
            </div>

            {/* Total Badge */}
            <div className="dl-results-count-badge">
              <span>{matches.length}</span>
              {matches.length !== totalRawMatchesCount && (
                <span className="dl-results-count-total">/{totalRawMatchesCount}</span>
              )}
            </div>
          </div>

          {/* Row 2: Segmented Tabs (Platform & Format) */}
          <div className="dl-modal-toolbar-filters">
            {/* Platform Segment */}
            <div className="dl-segmented-group" role="group" aria-label={t("downloadModal.filterPlatform")}>
              <div className="dl-segmented-pills">
                {platformOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`dl-segmented-tab${platformFilter === opt.id ? " active" : ""}`}
                    aria-pressed={platformFilter === opt.id}
                    onClick={() => onPlatformFilterChange(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="dl-toolbar-filter-divider" aria-hidden />

            {/* Download Type Segment */}
            <div className="dl-segmented-group" role="group" aria-label={t("downloadModal.filterType")}>
              <div className="dl-segmented-pills">
                {typeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`dl-segmented-tab${typeFilter === opt.id ? " active" : ""}`}
                    aria-pressed={typeFilter === opt.id}
                    onClick={() => onTypeFilterChange(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 3: Source Pills (Scrollable) */}
          {showPills && (
            <div className="dl-sources-scroll" role="tablist" aria-label={t("downloadModal.filterBySource")}>
              {sourceFilterOptions.map((opt) => {
                const isSelected = sourceFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`dl-source-filter-pill${isSelected ? " active" : ""}${
                      opt.provider === "plugin" ? " is-plugin" : ""
                    }`}
                    onClick={() => onSourceFilterChange(opt.id)}
                  >
                    <span className="dl-source-pill-text">{opt.label}</span>
                    <span className="dl-source-pill-num">{opt.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Results List */}
      {visible.length === 0 ? (
        <div className="dl-filter-empty-state">
          <div className="dl-filter-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="dl-filter-empty-text">{t("downloadModal.noMatchesForFilter")}</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="dl-clear-filters-btn"
              onClick={onClearFilters}
            >
              {t("downloadModal.clearFilter")}
            </button>
          )}
        </div>
      ) : (
        <div className="dl-results-scrollable-list">
          {visible.map(({ match, realIndex }, index) => {
            const prev = index > 0 ? visible[index - 1].match : undefined;
            const startsPluginBlock =
              sourceFilter === "all" &&
              match.provider === "plugin" &&
              (!prev || prev.provider !== "plugin") &&
              visible.some((v) => v.match.provider !== "plugin");

            return (
              <Fragment key={match.id ?? `${match.sourceId}-${realIndex}`}>
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
                />
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Weak Matches Accordion Toggle */}
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
