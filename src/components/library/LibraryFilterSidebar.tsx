import type { LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type { LibrarySource, PlayStatus } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

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
 * Source are compact segmented controls; Genres / Platforms are pill
 * toggles. Every change applies live (library filtering is local + instant).
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
  const toggleGenre = (genre: string) =>
    onGenresChange(
      selectedGenres.includes(genre)
        ? selectedGenres.filter((g) => g !== genre)
        : [...selectedGenres, genre]
    );

  const togglePlatform = (platform: string) =>
    onPlatformsChange(
      selectedPlatforms.includes(platform)
        ? selectedPlatforms.filter((p) => p !== platform)
        : [...selectedPlatforms, platform]
    );

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

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          {t("library.filter.status")}
        </h4>
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
      </div>

      <div className="lib-filter-section ui-complete-only">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          {t("edit.label.playStatus")}
        </h4>
        <div className="lib-segment">
          {PLAY_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${playStatus === opt.value ? " active" : ""}`}
              onClick={() => onPlayStatusChange(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-filter-section ui-complete-only">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="12" rx="2" />
              <path d="M2 11h20" />
              <path d="M9 16h6" />
            </svg>
          </span>
          {t("library.filter.source")}
        </h4>
        <div className="lib-segment">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${source === opt.value ? " active" : ""}`}
              onClick={() => onSourceChange(opt.value)}
            >
              {opt.labelKey ? t(opt.labelKey) : opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="14" y2="12" />
              <line x1="4" y1="18" x2="9" y2="18" />
            </svg>
          </span>
          {t("wishlist.sort")}
        </h4>
        <select
          className="lib-filter-search"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
          ))}
        </select>
      </div>

      {availableGenres.length > 0 && (
        <div className="lib-filter-section">
          <h4 className="lib-filter-heading">
            <span className="lib-filter-heading-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </span>
            {t("edit.label.genres")}
            {selectedGenres.length > 0 && (
              <span className="lib-filter-count-badge">{selectedGenres.length}</span>
            )}
          </h4>
          <div className="lib-pills">
            {availableGenres.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`lib-pill${selectedGenres.includes(genre) ? " active" : ""}`}
                onClick={() => toggleGenre(genre)}
              >
                {selectedGenres.includes(genre) && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {availablePlatforms.length > 0 && (
        <div className="lib-filter-section">
          <h4 className="lib-filter-heading">
            <span className="lib-filter-heading-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="2" y1="9" x2="22" y2="9" />
              </svg>
            </span>
            {t("store.compare.platforms")}
            {selectedPlatforms.length > 0 && (
              <span className="lib-filter-count-badge">{selectedPlatforms.length}</span>
            )}
          </h4>
          <div className="lib-pills">
            {availablePlatforms.map((platform) => (
              <button
                key={platform}
                type="button"
                className={`lib-pill${selectedPlatforms.includes(platform) ? " active" : ""}`}
                onClick={() => togglePlatform(platform)}
              >
                {selectedPlatforms.includes(platform) && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {platform}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="lib-filter-section ui-complete-only">
        <h4 className="lib-filter-heading">
          <span className="lib-filter-heading-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          {t("library.filter.releaseYear")}
        </h4>
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
      </div>

      <div className="lib-filter-section ui-complete-only">
        <div className="lib-rating-head">
          <h4 className="lib-filter-heading">
            <span className="lib-filter-heading-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </span>
            {t("library.filter.minRating")}
          </h4>
          <span className="lib-rating-value">{ratingMin ?? 0}+</span>
        </div>
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
      </div>

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
