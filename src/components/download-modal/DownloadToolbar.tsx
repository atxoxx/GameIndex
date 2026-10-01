import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type {
  DownloadTypeFilter,
  PlatformFilter,
  SortKey,
  SourceFilterOption,
} from "./types";
import { FilterPresetBar } from "./FilterPresetBar";
import type { DownloadFilters, FilterPreset } from "./useFilterPresets";

/**
 * Results toolbar: search, filter popover, sort, presets, and the batch
 * selection toggle.
 */
export function DownloadToolbar({
  filters,
  onChange,
  onClearFilters,
  sourceFilterOptions,
  groupOptions,
  installedVersion,
  newerCount,
  shownCount,
  totalCount,
  presets,
  activePresetId,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  batchMode,
  onToggleBatchMode,
  selectedCount,
}: {
  filters: DownloadFilters;
  onChange: (patch: Partial<DownloadFilters>) => void;
  onClearFilters: () => void;
  sourceFilterOptions: SourceFilterOption[];
  groupOptions: string[];
  installedVersion?: string | null;
  newerCount: number;
  shownCount: number;
  totalCount: number;
  presets: FilterPreset[];
  activePresetId: string | null;
  onApplyPreset: (preset: FilterPreset) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  batchMode: boolean;
  onToggleBatchMode: () => void;
  selectedCount: number;
}) {
  const { t } = useLanguage();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const platformOptions: { id: PlatformFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: t("downloadModal.filterAll") },
      { id: "pc", label: t("downloadModal.platformPc") },
      { id: "console", label: t("downloadModal.platformConsole") },
    ],
    [t],
  );

  const typeOptions: { id: DownloadTypeFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: t("downloadModal.filterAll") },
      { id: "torrent", label: t("downloadModal.filterTorrent") },
      { id: "magnet", label: t("downloadModal.filterMagnet") },
      { id: "direct", label: t("downloadModal.filterDirect") },
    ],
    [t],
  );

  const sortOptions: { id: SortKey; label: string }[] = useMemo(
    () => [
      { id: "recommended", label: t("downloadModal.sortRecommended") },
      { id: "date", label: t("downloads.sortDateNewest") },
      { id: "relevance", label: t("downloads.sortRelevance") },
      { id: "size_desc", label: t("downloadModal.sortSizeDesc") },
      { id: "size_asc", label: t("downloadModal.sortSizeAsc") },
      { id: "seeds", label: t("downloadModal.sortSeeds") },
      { id: "source", label: t("downloads.sortSource") },
    ],
    [t],
  );

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.sourceFilter !== "all") n++;
    if (filters.groupFilter !== "all") n++;
    if (filters.platformFilter !== "all") n++;
    if (filters.typeFilter !== "all") n++;
    if (filters.updatesOnly) n++;
    return n;
  }, [filters]);

  // "/" or Ctrl/Cmd+F focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        (e.key === "/" || (e.key === "f" && (e.ctrlKey || e.metaKey))) &&
        document.activeElement !== searchInputRef.current &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(tag)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="dl-modal-toolbar">
      <div className="dl-modal-toolbar-top">
        <div className="dl-search-box" title={t("downloadModal.searchSyntaxHint")}>
          <svg className="dl-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            className="dl-search-input"
            placeholder={t("downloadModal.filterPlaceholder")}
            value={filters.searchQuery}
            onChange={(e) => onChange({ searchQuery: e.target.value })}
            aria-label={t("downloadModal.filterPlaceholder")}
          />
          {!filters.searchQuery && <kbd className="dl-search-kbd" title="Press / to search">/</kbd>}
          {filters.searchQuery && (
            <button
              type="button"
              className="dl-search-clear-btn"
              onClick={() => onChange({ searchQuery: "" })}
              aria-label={t("downloadsFilter.clearSearch")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="dl-toolbar-top-right">
          {installedVersion && (
            <div
              className="dl-installed-version-chip"
              title={t("downloadModal.installedVersion", { version: installedVersion })}
            >
              <span className="dl-installed-version-dot" aria-hidden />
              <span className="dl-installed-version-label">{t("downloadModal.installedVersionLabel")}:</span>
              <span className="dl-installed-version-text">{installedVersion}</span>
            </div>
          )}

          <div className="dl-results-count-badge">
            <span>{shownCount}</span>
            {shownCount !== totalCount && <span className="dl-results-count-total">/{totalCount}</span>}
          </div>

          <button
            type="button"
            className={`dl-toolbar-filter-toggle${filtersOpen ? " is-open" : ""}${
              activeFilterCount > 0 ? " has-active" : ""
            }`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>{t("downloadModal.filtersButton")}</span>
            {activeFilterCount > 0 && (
              <span className="dl-toolbar-filter-count">
                {t("downloadModal.filtersActiveCount", { count: activeFilterCount })}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`dl-toolbar-batch-toggle${batchMode ? " is-active" : ""}`}
            onClick={onToggleBatchMode}
            aria-pressed={batchMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>
              {batchMode
                ? selectedCount > 0
                  ? t("downloadModal.batchSelected", { count: selectedCount })
                  : t("downloadModal.batchModeExit")
                : t("downloadModal.batchMode")}
            </span>
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="dl-filter-popover">
          <div className="dl-filter-popover-grid">
            <div className="dl-filter-group">
              <span className="dl-filter-group-label">{t("downloadModal.filterPlatform")}</span>
              <div className="dl-segmented-pills">
                {platformOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`dl-segmented-tab${filters.platformFilter === opt.id ? " active" : ""}`}
                    aria-pressed={filters.platformFilter === opt.id}
                    onClick={() => onChange({ platformFilter: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="dl-filter-group">
              <span className="dl-filter-group-label">{t("downloadModal.filterType")}</span>
              <div className="dl-segmented-pills">
                {typeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`dl-segmented-tab${filters.typeFilter === opt.id ? " active" : ""}`}
                    aria-pressed={filters.typeFilter === opt.id}
                    onClick={() => onChange({ typeFilter: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="dl-filter-group">
              <span className="dl-filter-group-label">{t("downloadModal.filterBySource")}</span>
              <select
                className="dl-toolbar-select"
                value={filters.sourceFilter}
                onChange={(e) => onChange({ sourceFilter: e.target.value })}
                aria-label={t("downloadModal.filterBySource")}
              >
                {sourceFilterOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} ({opt.count})
                  </option>
                ))}
              </select>
            </div>

            {groupOptions.length > 0 && (
              <div className="dl-filter-group">
                <span className="dl-filter-group-label">{t("downloadModal.filterByGroup")}</span>
                <select
                  className="dl-toolbar-select"
                  value={filters.groupFilter}
                  onChange={(e) => onChange({ groupFilter: e.target.value })}
                  aria-label={t("downloadModal.filterByGroup")}
                >
                  <option value="all">{t("downloadModal.allGroups")}</option>
                  {groupOptions.map((grp) => (
                    <option key={grp} value={grp}>
                      {grp}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="dl-filter-group">
              <span className="dl-filter-group-label">{t("downloads.sort")}</span>
              <select
                className="dl-toolbar-select"
                value={filters.sortBy}
                onChange={(e) => onChange({ sortBy: e.target.value as SortKey })}
                aria-label={t("downloads.sortResultsAria")}
              >
                {sortOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="dl-filter-popover-footer">
            {installedVersion && (
              <button
                type="button"
                className={`dl-update-filter-btn${filters.updatesOnly ? " active" : ""}`}
                onClick={() => onChange({ updatesOnly: !filters.updatesOnly })}
                title={t("downloadModal.filterUpdatesOnlyTitle")}
                aria-pressed={Boolean(filters.updatesOnly)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
                <span>{t("downloadModal.filterUpdatesOnly")}</span>
                {newerCount > 0 && <span className="dl-update-filter-count">{newerCount}</span>}
              </button>
            )}
            {activeFilterCount > 0 && (
              <button type="button" className="dl-clear-filters-btn" onClick={onClearFilters}>
                {t("downloadModal.clearFilter")}
              </button>
            )}
          </div>
        </div>
      )}

      <FilterPresetBar
        presets={presets}
        activeId={activePresetId}
        canSave={activeFilterCount > 0 || Boolean(filters.searchQuery.trim()) || filters.sortBy !== "recommended"}
        onApply={onApplyPreset}
        onSave={onSavePreset}
        onDelete={onDeletePreset}
      />
    </div>
  );
}
