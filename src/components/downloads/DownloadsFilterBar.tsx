// Search / status-filter / sort bar for the Downloads page.
//
// Sits above the Active section (next to the bulk-action toolbar)
// and lets the user narrow a large download list. All state is
// controlled by the parent (DownloadsPage) so the same query and
// sort apply consistently to both the Active and History lists.
//
// The status pills use coarse, human-meaningful buckets (see
// `matchesStatusFilter` in types/download.ts) rather than raw
// `DownloadStatus.kind` values, so "Downloading" also surfaces
// queued / fetching-metadata downloads that the user thinks of as
// "in progress".

import type {
  DownloadSort,
  DownloadStatusFilter,
} from "../../types/download";
import { useLanguage } from "../../context/LanguageContext";

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
  /** Per-bucket counts, used to render the pill badges. */
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

export default function DownloadsFilterBar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  counts,
}: DownloadsFilterBarProps) {
  const { t } = useLanguage();
  const pills: StatusPill[] = [
    { value: "all", label: t('downloadsFilter.statusAll'), count: counts.all },
    { value: "downloading", label: t('downloadsFilter.statusActive'), count: counts.downloading },
    { value: "paused", label: t('downloadsFilter.statusPaused'), count: counts.paused },
    { value: "completed", label: t('downloadsFilter.statusCompleted'), count: counts.completed },
    { value: "error", label: t('downloadsFilter.statusErrored'), count: counts.error },
  ];

  return (
    <div className="dl-filters" role="search">
      <div className="dl-filters-search">
        <svg
          className="dl-filters-search-icon"
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
          className="dl-filters-search-input"
          type="text"
          placeholder={t('downloadsFilter.searchPlaceholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('downloadsFilter.searchLabel')}
        />
        {query && (
          <button
            className="dl-filters-search-clear"
            onClick={() => onQueryChange("")}
            aria-label={t('downloadsFilter.clearSearch')}
            title={t('downloadsFilter.clearSearch')}
            type="button"
          >
            ×
          </button>
        )}
      </div>

      <div
        className="dl-filters-pills"
        role="group"
        aria-label={t('downloadsFilter.filterByStatus')}
      >
        {pills.map((pill) => (
          <button
            key={pill.value}
            type="button"
            className={`dl-filters-pill${statusFilter === pill.value ? " active" : ""}`}
            onClick={() => onStatusFilterChange(pill.value)}
            aria-pressed={statusFilter === pill.value}
          >
            {pill.label}
            {pill.count > 0 && (
              <span className="dl-filters-pill-count">{pill.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="dl-filters-sort">
        <label className="dl-filters-sort-label" htmlFor="dl-sort-select">
          {t('downloadsFilter.sort')}
        </label>
        <select
          id="dl-sort-select"
          className="dl-filters-sort-select"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as DownloadSort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
