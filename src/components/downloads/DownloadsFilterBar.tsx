import React from "react";
import { Search } from "lucide-react";
import type {
  DownloadSort,
  DownloadStatusFilter,
} from "../../types/download";
import { useLanguage } from "../../context/LanguageContext";
import { ListViewIcon, GridViewIcon, CompactViewIcon } from "./DownloadIcons";

export type DownloadViewMode = "detailed" | "grid" | "compact";

interface StatusChip {
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

const VIEW_MODES: { value: DownloadViewMode; labelKey: string; Icon: typeof ListViewIcon }[] = [
  { value: "detailed", labelKey: "downloadsFilter.viewDetailed", Icon: ListViewIcon },
  { value: "grid", labelKey: "downloadsFilter.viewGrid", Icon: GridViewIcon },
  { value: "compact", labelKey: "downloadsFilter.viewCompact", Icon: CompactViewIcon },
];

/**
 * One toolbar above the queue: the status chips read as a single segmented
 * control with live counts, and search, sort and view mode sit together on
 * the right as quiet controls.
 */
const DownloadsFilterBar: React.FC<DownloadsFilterBarProps> = ({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  counts,
}) => {
  const { t } = useLanguage();

  const chips: StatusChip[] = [
    { value: "all", label: t("downloadsFilter.statusAll"), count: counts.all },
    { value: "downloading", label: t("downloadsFilter.statusActive"), count: counts.downloading },
    { value: "seeding", label: t("downloadRow.badgeSeeding"), count: counts.seeding },
    { value: "queued", label: t("download.status.queued"), count: counts.queued },
    { value: "paused", label: t("downloadsFilter.statusPaused"), count: counts.paused },
    { value: "completed", label: t("downloadsFilter.statusCompleted"), count: counts.completed },
    { value: "error", label: t("downloadsFilter.statusErrored"), count: counts.error },
  ];

  return (
    <div className="dlfb">
      <div className="dlfb-chips" role="group" aria-label={t("downloadsFilter.filterByStatus")}>
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`dlfb-chip dlfb-chip--${chip.value}${
              statusFilter === chip.value ? " is-active" : ""
            }`}
            aria-pressed={statusFilter === chip.value}
            onClick={() => onStatusFilterChange(chip.value)}
          >
            <span className="dlfb-chip-dot" aria-hidden="true" />
            <span className="dlfb-chip-label">{chip.label}</span>
            <span className="dlfb-chip-count">{chip.count}</span>
          </button>
        ))}
      </div>

      <div className="dlfb-tools">
        <div className="dlfb-search">
          <Search size={14} className="dlfb-search-icon" aria-hidden="true" />
          <input
            className="dlfb-search-input"
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
              className="dlfb-search-clear"
              onClick={() => onQueryChange("")}
              aria-label={t("downloadsFilter.clearSearch")}
              title={t("downloadsFilter.clearSearch")}
              type="button"
            >
              ×
            </button>
          )}
        </div>

        <label className="dlfb-sort" title={t("downloadsFilter.sort")}>
          <select
            className="dlfb-sort-select"
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
          <svg
            className="dlfb-sort-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </label>

        <div className="dlfb-views" role="group" aria-label={t("downloadsFilter.viewMode")}>
          {VIEW_MODES.map(({ value, labelKey, Icon }) => (
            <button
              key={value}
              type="button"
              className={`dlfb-view${viewMode === value ? " is-active" : ""}`}
              onClick={() => onViewModeChange(value)}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              aria-pressed={viewMode === value}
            >
              <Icon style={{ width: 14, height: 14 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(DownloadsFilterBar);
