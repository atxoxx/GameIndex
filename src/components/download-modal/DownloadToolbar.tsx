import { useEffect, useId, useMemo, useRef, useState } from "react";
import "../../styles/download-modal-filters.css";
import { useLanguage } from "../../context/LanguageContext";
import type {
  DownloadTypeFilter,
  PlatformFilter,
  SortKey,
  SourceFilterOption,
} from "./types";
import { FilterPresetBar } from "./FilterPresetBar";
import type { DownloadFilters, FilterPreset } from "./useFilterPresets";

/** One removable summary chip for an active result filter. */
type ActiveFilterChip = {
  key: string;
  /** Spoken category, from an existing label key. */
  category: string;
  /** Short value shown on the chip. */
  value: string;
  clear: () => void;
};

/**
 * Results toolbar: search, active-filter summary, filter popover, sort, presets,
 * and the batch selection toggle.
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
  cacheAvailable = false,
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
  cacheAvailable?: boolean;
}) {
  const { t } = useLanguage();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

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

  const sortOptions: { id: SortKey; label: string }[] = useMemo(() => {
    const options: { id: SortKey; label: string }[] = [
      { id: "recommended", label: t("downloadModal.sortRecommended") },
      { id: "date", label: t("downloads.sortDateNewest") },
      { id: "relevance", label: t("downloads.sortRelevance") },
      { id: "name_asc", label: t("downloadModal.sortNameAsc") },
      { id: "size_desc", label: t("downloadModal.sortSizeDesc") },
      { id: "size_asc", label: t("downloadModal.sortSizeAsc") },
      { id: "seeds", label: t("downloadModal.sortSeeds") },
      { id: "source", label: t("downloads.sortSource") },
    ];
    if (cacheAvailable) {
      options.splice(1, 0, { id: "cached", label: t("downloadModal.sortCached") });
    }
    return options;
  }, [t, cacheAvailable]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.sourceFilter !== "all") n++;
    if (filters.groupFilter !== "all") n++;
    if (filters.platformFilter !== "all") n++;
    if (filters.typeFilter !== "all") n++;
    if (filters.cacheFilter !== "all") n++;
    if (filters.updatesOnly) n++;
    return n;
  }, [filters]);

  // Summary of every active filter, each with its own reset action. Values are
  // resolved from the same option lists the popover renders, so the chips never
  // invent a filter the data cannot express.
  const activeChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];

    if (filters.sourceFilter !== "all") {
      const option = sourceFilterOptions.find((o) => o.id === filters.sourceFilter);
      chips.push({
        key: "source",
        category: t("downloadModal.filterBySource"),
        value: option?.label ?? filters.sourceFilter,
        clear: () => onChange({ sourceFilter: "all" }),
      });
    }

    if (filters.groupFilter !== "all") {
      chips.push({
        key: "group",
        category: t("downloadModal.filterByGroup"),
        value: filters.groupFilter,
        clear: () => onChange({ groupFilter: "all" }),
      });
    }

    if (filters.platformFilter !== "all") {
      const option = platformOptions.find((o) => o.id === filters.platformFilter);
      if (option) {
        chips.push({
          key: "platform",
          category: t("downloadModal.filterPlatform"),
          value: option.label,
          clear: () => onChange({ platformFilter: "all" }),
        });
      }
    }

    if (filters.typeFilter !== "all") {
      const option = typeOptions.find((o) => o.id === filters.typeFilter);
      if (option) {
        chips.push({
          key: "type",
          category: t("downloadModal.filterType"),
          value: option.label,
          clear: () => onChange({ typeFilter: "all" }),
        });
      }
    }

    if (filters.cacheFilter !== "all") {
      chips.push({
        key: "availability",
        category: t("downloadModal.filterAvailability"),
        value: t("downloadModal.filterCachedOnly"),
        clear: () => onChange({ cacheFilter: "all" }),
      });
    }

    if (filters.updatesOnly) {
      chips.push({
        key: "updates",
        category: t("downloadModal.filterUpdatesOnlyTitle"),
        value: t("downloadModal.filterUpdatesOnly"),
        clear: () => onChange({ updatesOnly: false }),
      });
    }

    return chips;
  }, [filters, sourceFilterOptions, platformOptions, typeOptions, onChange, t]);

  // "/" or Ctrl/Cmd+F focuses the search box. Typing "/" inside a field or with
  // a modifier stays with the field/browser instead of jumping to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      const isEditable =
        Boolean(active?.isContentEditable) ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      const searchShortcut =
        e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const findShortcut =
        (e.key === "f" || e.key === "F") && (e.ctrlKey || e.metaKey);

      if ((searchShortcut || findShortcut) && !isEditable && !e.isComposing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalResultsLabel = t("downloadModal.sourceResults", {
    count: totalCount,
    s: totalCount === 1 ? "" : "s",
  });

  return (
    <div className="dl-modal-toolbar dlm-toolbar-refined">
      <div className="dlm-toolbar-search-row">
        <div
          className={`dl-search-box${searchFocused ? " is-focused" : ""}`}
          title={t("downloadModal.searchSyntaxHint")}
        >
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
            value={filters.searchQuery}
            onChange={(e) => onChange({ searchQuery: e.target.value })}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label={t("downloadModal.filterPlaceholder")}
            aria-describedby={searchFocused ? `${popoverId}-search-hint` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {filters.searchQuery ? (
            <button
              type="button"
              className="dl-search-clear-btn"
              onClick={() => {
                onChange({ searchQuery: "" });
                searchInputRef.current?.focus();
              }}
              aria-label={t("downloadsFilter.clearSearch")}
              title={t("downloadsFilter.clearSearch")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : (
            <kbd className="dl-search-kbd" aria-hidden>
              /
            </kbd>
          )}
        </div>

        <div className="dlm-toolbar-meta">
          {installedVersion && (
            <div
              className="dl-installed-version-chip"
              title={t("downloadModal.installedVersion", { version: installedVersion })}
            >
              <span className="dl-installed-version-dot" aria-hidden />
              <span className="dl-installed-version-label">
                {t("downloadModal.installedVersionLabel")}:
              </span>
              <span className="dl-installed-version-text">{installedVersion}</span>
            </div>
          )}

          <div
            className="dl-results-count-badge"
            aria-live="polite"
            title={totalResultsLabel}
          >
            <span className="dlm-results-shown">{shownCount}</span>
            {shownCount !== totalCount && (
              <>
                <span className="dlm-results-sep" aria-hidden>
                  /
                </span>
                <span className="dl-results-count-total">{totalCount}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {searchFocused && (
        <p className="dlm-search-hint" id={`${popoverId}-search-hint`}>
          {t("downloadModal.searchSyntaxHint")}
        </p>
      )}

      {activeChips.length > 0 && (
        <div className="dlm-toolbar-chips">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="dlm-filter-chip"
              title={`${chip.category}: ${chip.value}`}
            >
              <span className="dlm-filter-chip-value">{chip.value}</span>
              <button
                type="button"
                className="dlm-filter-chip-remove"
                onClick={chip.clear}
                aria-label={`${t("common.remove")}: ${chip.category} ${chip.value}`}
                title={`${t("common.remove")}: ${chip.category}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
          <button
            type="button"
            className="dlm-clear-all-btn"
            onClick={onClearFilters}
            title={t("downloadModal.clearFilter")}
          >
            {t("common.clear")} {t("downloadModal.filtersButton")}
          </button>
        </div>
      )}

      <div
        className="dlm-toolbar-controls"
        onKeyDown={(e) => {
          if (e.key === "Escape" && filtersOpen) {
            e.preventDefault();
            setFiltersOpen(false);
            filterButtonRef.current?.focus();
          }
        }}
      >
        <div className="dlm-toolbar-actions">
          <button
            ref={filterButtonRef}
            type="button"
            className={`dl-toolbar-filter-toggle${filtersOpen ? " is-open" : ""}${
              activeFilterCount > 0 ? " has-active" : ""
            }`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls={popoverId}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>{t("downloadModal.filtersButton")}</span>
            {activeFilterCount > 0 && (
              <span className="dl-toolbar-filter-count">
                {t("downloadModal.filtersActiveCount", { count: activeFilterCount })}
              </span>
            )}
          </button>

          <div className="dlm-sort-field">
            <svg
              className="dlm-sort-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="7" y1="4" x2="7" y2="20" />
              <polyline points="3 8 7 4 11 8" />
              <line x1="17" y1="20" x2="17" y2="4" />
              <polyline points="13 16 17 20 21 16" />
            </svg>
            <span className="dlm-sort-label">{t("downloads.sort")}</span>
            <select
              className="dl-toolbar-select dlm-sort-select"
              value={filters.sortBy}
              onChange={(e) => onChange({ sortBy: e.target.value as SortKey })}
              aria-label={t("downloads.sortResultsAria")}
              title={t("downloads.sortResultsAria")}
            >
              {sortOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={`dl-toolbar-batch-toggle${batchMode ? " is-active" : ""}`}
            onClick={onToggleBatchMode}
            aria-pressed={batchMode}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
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

        {filtersOpen && (
          <div
            id={popoverId}
            className="dl-filter-popover"
            role="group"
            aria-label={t("downloadModal.filtersButton")}
          >
            <div className="dl-filter-popover-grid">
              <div className="dl-filter-group">
                <span className="dl-filter-group-label">
                  {t("downloadModal.filterPlatform")}
                </span>
                <div className="dl-segmented-pills">
                  {platformOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`dl-segmented-tab${
                        filters.platformFilter === opt.id ? " active" : ""
                      }`}
                      aria-pressed={filters.platformFilter === opt.id}
                      onClick={() => onChange({ platformFilter: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dl-filter-group">
                <span className="dl-filter-group-label">
                  {t("downloadModal.filterType")}
                </span>
                <div className="dl-segmented-pills">
                  {typeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`dl-segmented-tab${
                        filters.typeFilter === opt.id ? " active" : ""
                      }`}
                      aria-pressed={filters.typeFilter === opt.id}
                      onClick={() => onChange({ typeFilter: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {cacheAvailable && (
                <div className="dl-filter-group">
                  <span className="dl-filter-group-label">
                    {t("downloadModal.filterAvailability")}
                  </span>
                  <div className="dl-segmented-pills">
                    <button
                      type="button"
                      className={`dl-segmented-tab${
                        filters.cacheFilter === "all" ? " active" : ""
                      }`}
                      aria-pressed={filters.cacheFilter === "all"}
                      onClick={() => onChange({ cacheFilter: "all" })}
                    >
                      {t("downloadModal.filterAll")}
                    </button>
                    <button
                      type="button"
                      className={`dl-segmented-tab${
                        filters.cacheFilter === "cached" ? " active" : ""
                      }`}
                      aria-pressed={filters.cacheFilter === "cached"}
                      onClick={() => onChange({ cacheFilter: "cached" })}
                    >
                      {t("downloadModal.filterCachedOnly")}
                    </button>
                  </div>
                </div>
              )}

              <div className="dl-filter-group">
                <span className="dl-filter-group-label">
                  {t("downloadModal.filterBySource")}
                </span>
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
                  <span className="dl-filter-group-label">
                    {t("downloadModal.filterByGroup")}
                  </span>
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
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                  <span>{t("downloadModal.filterUpdatesOnly")}</span>
                  {newerCount > 0 && (
                    <span className="dl-update-filter-count">{newerCount}</span>
                  )}
                </button>
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="dl-clear-filters-btn"
                  onClick={onClearFilters}
                >
                  {t("downloadModal.clearFilter")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <FilterPresetBar
        presets={presets}
        activeId={activePresetId}
        canSave={
          activeFilterCount > 0 ||
          Boolean(filters.searchQuery.trim()) ||
          filters.sortBy !== "recommended"
        }
        onApply={onApplyPreset}
        onSave={onSavePreset}
        onDelete={onDeletePreset}
      />
    </div>
  );
}
