import { Fragment, useMemo, useRef, useEffect } from "react";
import type {
  SortKey,
  DisplayMatch,
  SourceFilterOption,
  PlatformFilter,
  DownloadTypeFilter,
} from "./types";
import { ResultRow } from "./ResultRow";
import { useLanguage } from "../../context/LanguageContext";
import { extractReleaseGroups } from "./helpers";

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
  groupFilter = "all",
  onGroupFilterChange,
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
  groupFilter?: string;
  onGroupFilterChange?: (group: string) => void;
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  // Extract available scene/repack groups from raw matches
  const availableGroups = useMemo(() => extractReleaseGroups(matches), [matches]);

  // Global / shortcut to focus search input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || (e.key === "f" && (e.ctrlKey || e.metaKey))) &&
        document.activeElement !== searchInputRef.current &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            width="28"
            height="28"
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
        sourceFilter !== "all" ||
        groupFilter !== "all",
    );

  const weakCount = matches.filter(
    (m) =>
      m.matchScore < 0.4 &&
      m.provider !== "plugin" &&
      sourceFilter === "all" &&
      groupFilter === "all",
  ).length;

  const hasActiveFilters =
    sourceFilter !== "all" ||
    groupFilter !== "all" ||
    platformFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(searchQuery.trim());

  const showControls = totalRawMatchesCount > 1;

  return (
    <div className="dl-results-container">
      {/* Top Filter & Search Bar */}
      {showControls && (
        <div className="dl-modal-toolbar">
          {/* Row 1: Search + Count Badge */}
          <div className="dl-modal-toolbar-top">
            {/* Quick Search with shortcut hint */}
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
                ref={searchInputRef}
                type="text"
                className="dl-search-input"
                placeholder={t("downloadModal.filterPlaceholder")}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                aria-label={t("downloadModal.filterPlaceholder")}
              />
              {!searchQuery && (
                <kbd className="dl-search-kbd" title="Press / to search">/</kbd>
              )}
              {searchQuery && (
                <button
                  type="button"
                  className="dl-search-clear-btn"
                  onClick={() => onSearchQueryChange("")}
                  aria-label={t("downloadsFilter.clearSearch")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Total Badge */}
            <div className="dl-results-count-badge">
              <span>{matches.length}</span>
              {matches.length !== totalRawMatchesCount && (
                <span className="dl-results-count-total">/{totalRawMatchesCount}</span>
              )}
            </div>
          </div>

          {/* Row 2: Segmented Tabs (Platform & Format) + Source & Group Dropdowns + Sort */}
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

            <div className="dl-toolbar-filter-divider" aria-hidden />

            {/* Source Dropdown */}
            <div className="dl-toolbar-select-wrapper" title={t("downloadModal.filterBySource")}>
              <select
                className="dl-toolbar-select"
                value={sourceFilter}
                onChange={(e) => onSourceFilterChange(e.target.value)}
                aria-label={t("downloadModal.filterBySource")}
              >
                {sourceFilterOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} ({opt.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Group Dropdown */}
            {availableGroups.length > 0 && (
              <div className="dl-toolbar-select-wrapper" title={t("downloadModal.filterByGroup")}>
                <select
                  className="dl-toolbar-select"
                  value={groupFilter}
                  onChange={(e) => onGroupFilterChange?.(e.target.value)}
                  aria-label={t("downloadModal.filterByGroup")}
                >
                  <option value="all">{t("downloadModal.allGroups")}</option>
                  {availableGroups.map((grp) => (
                    <option key={grp} value={grp}>
                      {grp}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort Dropdown */}
            <div className="dl-toolbar-select-wrapper" title={t("achievements.sort")}>
              <select
                className="dl-toolbar-select"
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortKey)}
                aria-label={t("downloads.sortResultsAria")}
              >
                <option value="date">{t("downloads.sortDateNewest")}</option>
                <option value="relevance">{t("downloads.sortRelevance")}</option>
                <option value="size_desc">{t("downloadModal.sortSizeDesc")}</option>
                <option value="size_asc">{t("downloadModal.sortSizeAsc")}</option>
                <option value="seeds">{t("downloadModal.sortSeeds")}</option>
                <option value="source">{t("downloads.sortSource")}</option>
              </select>
            </div>

            {/* Reset Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                className="dl-toolbar-reset-btn"
                onClick={onClearFilters}
                title={t("downloadModal.clearFilter")}
                aria-label={t("downloadModal.clearFilter")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
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
