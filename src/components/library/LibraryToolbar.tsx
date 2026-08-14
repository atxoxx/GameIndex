import type { LibrarySort } from "../../hooks/useLibraryFilters";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import DensityToggle from "../DensityToggle";
import LibrarySortMenu from "./LibrarySortMenu";

export type LibraryGroupBy = "none" | "platform" | "playStatus" | "genre" | "releaseYear" | "alphabetical";

interface LibraryToolbarProps {
  title: string;
  count?: string | number | null;
  search: string;
  onSearchChange: (q: string) => void;
  sort: LibrarySort;
  onSortChange: (s: LibrarySort) => void;
  groupBy?: LibraryGroupBy;
  onGroupByChange?: (g: LibraryGroupBy) => void;
  density: ViewDensity;
  onDensityChange: (d: ViewDensity) => void;
  bulkMode?: boolean;
  onToggleBulkMode?: () => void;
  onExport: () => void;
}

const GROUP_BY_OPTIONS: readonly { value: LibraryGroupBy; labelKey: string }[] = [
  { value: "none", labelKey: "library.groupBy.none" },
  { value: "platform", labelKey: "library.groupBy.platform" },
  { value: "playStatus", labelKey: "library.groupBy.playStatus" },
  { value: "genre", labelKey: "library.groupBy.genre" },
  { value: "releaseYear", labelKey: "library.groupBy.releaseYear" },
  { value: "alphabetical", labelKey: "library.groupBy.alphabetical" },
];

export default function LibraryToolbar({
  title,
  count,
  search,
  onSearchChange,
  sort,
  onSortChange,
  groupBy = "none",
  onGroupByChange,
  density,
  onDensityChange,
  bulkMode = false,
  onToggleBulkMode,
  onExport,
}: LibraryToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="lib-toolbar">
      <div className="lib-toolbar-title">
        <h2>{title}</h2>
        {count != null && count !== "" && (
          <span className="lib-toolbar-count">{count}</span>
        )}
      </div>

      <div className="lib-toolbar-controls">
        {/* Search input */}
        <div className={`lib-search${search ? " has-value" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("page.library.searchPlaceholder")}
            aria-label={t("page.library.searchLabel")}
          />
          {search.length > 0 && (
            <button
              type="button"
              className="lib-search-clear"
              onClick={() => onSearchChange("")}
              aria-label={t("friends.clearSearch")}
              title={t("friends.clearSearch")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Group By selector */}
        {onGroupByChange && (
          <div className="lib-groupby-wrap">
            <label htmlFor="lib-groupby-select" className="lib-groupby-label" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </label>
            <select
              id="lib-groupby-select"
              className="lib-groupby-select"
              value={groupBy}
              onChange={(e) => onGroupByChange(e.target.value as LibraryGroupBy)}
              aria-label={t("library.groupBy.label")}
            >
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sort Menu */}
        <LibrarySortMenu value={sort} onChange={onSortChange} />

        {/* Bulk select mode toggle */}
        {onToggleBulkMode && (
          <button
            type="button"
            className={`lib-bulk-toggle-btn${bulkMode ? " active" : ""}`}
            onClick={onToggleBulkMode}
            title={bulkMode ? t("library.bulk.clearSelection") : t("storeToolbar.selectMultiple")}
            aria-pressed={bulkMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>{t("store.selectLabel")}</span>
          </button>
        )}

        {/* Export trigger */}
        <button
          type="button"
          className="lib-export-trigger"
          onClick={onExport}
          title={t("libraryExport.export")}
          aria-label={t("libraryExport.export")}
        >
          <span className="lib-export-trigger-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
          </span>
          <span>{t("libraryExport.export")}</span>
        </button>

        {/* Density toggle */}
        <div className="lib-toolbar-group" role="radiogroup" aria-label={t("libraryPage.layoutDensity")}>
          <DensityToggle density={density} onChange={onDensityChange} />
        </div>
      </div>
    </div>
  );
}
