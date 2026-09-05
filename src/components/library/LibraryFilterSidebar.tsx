import type { LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type { LibrarySource, PlayStatus } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import FilterSection from "../filters/FilterSection";
import MultiSelectDropdown from "../ui/MultiSelectDropdown";

const STATUS_OPTIONS: readonly { value: LibraryStatus; labelKey: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "installed", labelKey: "filter.installed" },
  { value: "not_installed", labelKey: "filter.notInstalled" },
];

// Brand names (Steam, GOG, Epic, Humble, …) stay untranslated.
const SOURCE_OPTIONS: readonly { value: LibrarySource; label?: string; labelKey?: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "steam", label: "Steam" },
  { value: "local", labelKey: "common.local" },
  { value: "gog", label: "GOG" },
  { value: "epic", label: "Epic" },
  { value: "humble", label: "Humble" },
  { value: "rockstar", label: "Rockstar" },
  { value: "ubisoft", label: "Ubisoft" },
];

const PLAY_STATUS_OPTIONS: readonly { value: PlayStatus | "all"; labelKey: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "backlog", labelKey: "game.status.backlog" },
  { value: "playing", labelKey: "game.status.playing" },
  { value: "completed", labelKey: "game.status.completed" },
  { value: "abandoned", labelKey: "game.status.abandoned" },
  { value: "on_hold", labelKey: "game.status.onHold" },
];

interface LibraryFilterSidebarProps {
  search: string;
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  status: LibraryStatus;
  playStatus: PlayStatus | "all";
  availableGenres: string[];
  availablePlatforms: string[];
  source: LibrarySource;
  sort: LibrarySort;
  onSearchChange: (q: string) => void;
  onGenresChange: (g: string[]) => void;
  onPlatformsChange: (p: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (r: number | null) => void;
  onStatusChange: (s: LibraryStatus) => void;
  onPlayStatusChange: (ps: PlayStatus | "all") => void;
  onSourceChange: (s: LibrarySource) => void;
  onSortChange: (s: LibrarySort) => void;
  onReset: () => void;
}

/**
 * LibraryFilterSidebar: the left-rail filter panel. Status / Play Status /
 * Source are compact segmented controls or selects; Genres / Platforms are
 * multi-select dropdowns. Every change applies live (library filtering is
 * local + instant).
 */
export default function LibraryFilterSidebar({
  search,
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  status,
  playStatus,
  availableGenres,
  availablePlatforms,
  source,
  sort,
  onSearchChange,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onStatusChange,
  onPlayStatusChange,
  onSourceChange,
  onSortChange,
  onReset,
}: LibraryFilterSidebarProps) {
  const { t } = useLanguage();

  return (
    <aside className="lib-filter" aria-label={t("library.filtersAria")}>
      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          {t("library.filter.search")}
        </h4>
        <input
          type="text"
          className="lib-filter-search"
          placeholder={t("library.filter.searchPlaceholder")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <FilterSection
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
        title={t("library.filter.status")}
      >
        <div className="lib-segment">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${status === opt.value ? " active" : ""}`}
              onClick={() => onStatusChange(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        className="ui-complete-only"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        }
        title={t("edit.label.playStatus")}
      >
        <select
          className="lib-filter-search"
          value={playStatus}
          onChange={(e) => onPlayStatusChange(e.target.value as PlayStatus | "all")}
          aria-label={t("edit.label.playStatus")}
        >
          {PLAY_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection
        className="ui-complete-only"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="12" rx="2" />
            <path d="M2 11h20" />
            <path d="M9 16h6" />
          </svg>
        }
        title={t("library.filter.source")}
      >
        <select
          className="lib-filter-search"
          value={source}
          onChange={(e) => onSourceChange(e.target.value as LibrarySource)}
          aria-label={t("library.filter.source")}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelKey ? t(opt.labelKey) : opt.label}
            </option>
          ))}
        </select>
      </FilterSection>

      <FilterSection
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="14" y2="12" />
            <line x1="4" y1="18" x2="9" y2="18" />
          </svg>
        }
        title={t("wishlist.sort")}
      >
        <select
          className="lib-filter-search"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
          ))}
        </select>
      </FilterSection>

      {availableGenres.length > 0 && (
        <FilterSection
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          }
          title={t("edit.label.genres")}
          count={selectedGenres.length}
        >
          <MultiSelectDropdown
            label={t("edit.label.genres")}
            placeholder={t("common.all")}
            options={availableGenres}
            selected={selectedGenres}
            onChange={onGenresChange}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchGenres")}
            noResultsLabel={t("common.noResults")}
          />
        </FilterSection>
      )}

      {availablePlatforms.length > 0 && (
        <FilterSection
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="9" x2="22" y2="9" />
            </svg>
          }
          title={t("store.compare.platforms")}
          count={selectedPlatforms.length}
        >
          <MultiSelectDropdown
            label={t("store.compare.platforms")}
            placeholder={t("common.all")}
            options={availablePlatforms}
            selected={selectedPlatforms}
            onChange={onPlatformsChange}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchPlatforms")}
            noResultsLabel={t("common.noResults")}
          />
        </FilterSection>
      )}

      <FilterSection
        className="ui-complete-only"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        }
        title={t("library.filter.releaseYear")}
      >
        <div className="lib-year-row">
          <input
            type="number"
            className="lib-year-input"
            placeholder={t("library.filter.yearFrom")}
            value={yearMin ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              onYearRangeChange(raw ? Number(raw) : null, yearMax);
            }}
            min={1970}
            max={2030}
          />
          <span className="lib-year-sep">–</span>
          <input
            type="number"
            className="lib-year-input"
            placeholder={t("library.filter.yearTo")}
            value={yearMax ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              onYearRangeChange(yearMin, raw ? Number(raw) : null);
            }}
            min={1970}
            max={2030}
          />
        </div>
      </FilterSection>

      <FilterSection
        className="ui-complete-only"
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        }
        title={
          <span className="lib-rating-head">
            {t("library.filter.minRating")}
            <span className="lib-rating-value">{ratingMin ?? 0}+</span>
          </span>
        }
      >
        <input
          type="range"
          className="lib-rating-slider"
          min={0}
          max={100}
          step={5}
          value={ratingMin ?? 0}
          onChange={(e) =>
            onRatingMinChange(Number(e.target.value) > 0 ? Number(e.target.value) : null)
          }
          style={{
            background: `linear-gradient(90deg, var(--color-accent) ${ratingMin ?? 0}%, var(--color-border) ${ratingMin ?? 0}%)`,
          }}
        />
      </FilterSection>

      <button className="lib-filter-reset" onClick={onReset}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {t("bigscreen.library.resetFilters")}
      </button>
    </aside>
  );
}
