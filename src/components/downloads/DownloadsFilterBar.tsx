import React from "react";
import type {
  DownloadSort,
  DownloadStatusFilter,
} from "../../types/download";
import { useLanguage } from "../../context/LanguageContext";
import { ListViewIcon, GridViewIcon, CompactViewIcon } from "./DownloadIcons";

export type DownloadViewMode = "detailed" | "grid" | "compact";

interface StatusPill {
  value: DownloadStatusFilter;
  label: string;
  count: number;
}

interface DownloadsFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: DownloadStatusFilter;
  onStatusFilterChange: (value: DownloadStatusFilter) => void;
  sort: DownloadSort;
  onSortChange: (value: DownloadSort) => void;
  viewMode: DownloadViewMode;
  onViewModeChange: (mode: DownloadViewMode) => void;
  counts: Record<DownloadStatusFilter, number>;
}

const SORT_OPTIONS: { value: DownloadSort; labelKey: string }[] = [
  { value: "added-desc", labelKey: "downloadsFilter.sortNewest" },
  { value: "added-asc", labelKey: "downloadsFilter.sortOldest" },
  { value: "name-asc", labelKey: "downloadsFilter.sortNameAZ" },
  { value: "size-desc", labelKey: "downloadsFilter.sortLargest" },
  { value: "progress-desc", labelKey: "downloadsFilter.sortMostComplete" },
  { value: "speed-desc", labelKey: "downloadsFilter.sortFastest" },
];

export const DownloadsFilterBar = React.memo(function DownloadsFilterBar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  counts,
}: DownloadsFilterBarProps) {
  const { t } = useLanguage();

  const pills: StatusPill[] = [
    { value: "all", label: t("downloadsFilter.statusAll"), count: counts.all },
    { value: "downloading", label: t("downloadsFilter.statusActive"), count: counts.downloading },
    { value: "seeding", label: t("downloadRow.badgeSeeding"), count: counts.seeding },
    { value: "queued", label: t("download.status.queued"), count: counts.queued },
    { value: "paused", label: t("downloadsFilter.statusPaused"), count: counts.paused },
    { value: "completed", label: t("downloadsFilter.statusCompleted"), count: counts.completed },
    { value: "error", label: t("downloadsFilter.statusErrored"), count: counts.error },
  ];

  return (
    <div className="dl-filter-bar-container">
      {/* Status Filter Dropdown */}
      <div className="dl-filters-status-wrapper">
        <select
          className="dl-filters-sort-select"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as DownloadStatusFilter)}
          aria-label={t("downloadsFilter.filterByStatus")}
        >
          {pills.map((pill) => (
            <option key={pill.value} value={pill.value}>
              {pill.label} ({pill.count})
            </option>
          ))}
        </select>
      </div>

      {/* Right Controls: Search, Sort, and View Mode (never wraps internally) */}
      <div className="dl-filters-controls-row">
        {/* Search Input */}
        <div className="dl-filters-search">
          <svg
            className="dl-filters-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="dl-filters-search-input"
            type="text"
            placeholder={t("downloadsFilter.searchPlaceholder")}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("downloadsFilter.searchLabel")}
          />
          {query && (
            <button
              className="dl-filters-search-clear"
              onClick={() => onQueryChange("")}
              aria-label={t("downloadsFilter.clearSearch")}
              title={t("downloadsFilter.clearSearch")}
              type="button"
            >
              ×
            </button>
          )}
        </div>

        {/* Sort Select with Sort Icon */}
        <div className="dl-filters-sort-wrapper">
          <svg
            className="dl-filters-sort-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M6 12h12m-9 6h6" />
          </svg>
          <select
            id="dl-sort-select"
            className="dl-filters-sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as DownloadSort)}
            aria-label={t("downloadsFilter.sort")}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode Segmented Switcher */}
        <div className="dl-view-toggle-group" role="group" aria-label={t("downloadsFilter.viewMode")}>
          <button
            type="button"
            className={`dl-view-toggle-btn${viewMode === "detailed" ? " active" : ""}`}
            onClick={() => onViewModeChange("detailed")}
            title={t("downloadsFilter.viewDetailed")}
            aria-pressed={viewMode === "detailed"}
          >
            <ListViewIcon style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className={`dl-view-toggle-btn${viewMode === "grid" ? " active" : ""}`}
            onClick={() => onViewModeChange("grid")}
            title={t("downloadsFilter.viewGrid")}
            aria-pressed={viewMode === "grid"}
          >
            <GridViewIcon style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            className={`dl-view-toggle-btn${viewMode === "compact" ? " active" : ""}`}
            onClick={() => onViewModeChange("compact")}
            title={t("downloadsFilter.viewCompact")}
            aria-pressed={viewMode === "compact"}
          >
            <CompactViewIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default DownloadsFilterBar;
