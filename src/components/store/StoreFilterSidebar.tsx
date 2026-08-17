import { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { StoreGameSummary } from "../../types/game";

// Complete IGDB genre list (https://api.igdb.com/v4/genres), using IGDB's
// canonical names so the labels match the `genres.name` values the scraper
// returns — that's what the per-genre match counts compare against.
export const GENRES = [
  "Action",
  "Adventure",
  "Arcade",
  "Audio",
  "Card & Board Game",
  "Education",
  "Fighting",
  "Hobby",
  "Horror",
  "Indie",
  "Metroidvania",
  "MOBA",
  "Music",
  "Music-based",
  "Pinball",
  "Platform",
  "Point-and-click",
  "Puzzle",
  "Quiz/Trivia",
  "Racing",
  "Real Time Strategy (RTS)",
  "Real Time Tactics (RTT)",
  "Role-playing (RPG)",
  "Shooter",
  "Simulator",
  "Sport",
  "Strategy",
  "Tactical",
  "Turn-based strategy (TBS)",
  "Visual Novel",
];

const YEAR_PRESETS = [
  { label: "All Years", min: null, max: null },
  { label: "2024–2026", min: 2024, max: 2026 },
  { label: "2020–2023", min: 2020, max: 2023 },
  { label: "2010s", min: 2010, max: 2019 },
  { label: "2000s", min: 2000, max: 2009 },
  { label: "Retro (< 2000)", min: 1970, max: 1999 },
];

/**
 * Whether `g` passes every facet filter EXCEPT the one being counted. Used
 * for the live per-option match counts: each option's number reflects "how
 * many games would remain if I added just this filter", i.e. the impact of
 * toggling it against the current selection.
 */
function matchesFacetFilters(
  g: StoreGameSummary,
  genres: string[],
  platforms: string[],
  yearMin: number | null,
  yearMax: number | null,
  ratingMin: number | null,
  exclude: "genre" | "platform" | "year" | "rating"
): boolean {
  if (
    exclude !== "genre" &&
    genres.length > 0 &&
    !genres.some((x) => g.genres.includes(x))
  ) {
    return false;
  }
  if (
    exclude !== "platform" &&
    platforms.length > 0 &&
    !platforms.some((x) => g.platforms.includes(x))
  ) {
    return false;
  }
  if (exclude !== "year" && (yearMin != null || yearMax != null)) {
    const y = g.firstReleaseDate
      ? new Date(g.firstReleaseDate).getFullYear()
      : null;
    if (y == null) return false;
    if (yearMin != null && y < yearMin) return false;
    if (yearMax != null && y > yearMax) return false;
  }
  if (
    exclude !== "rating" &&
    ratingMin != null &&
    (g.rating == null || g.rating < ratingMin)
  ) {
    return false;
  }
  return true;
}

interface StoreFilterSidebarProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  /** All IGDB platform names (fetched live) to offer as filter pills. */
  platformNames?: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  selectedSourceIds?: string[];
  onGenresChange: (genres: string[]) => void;
  onPlatformsChange: (platforms: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (rating: number | null) => void;
  onSourcesChange?: (sourceIds: string[]) => void;
  onApply: () => void;
  onReset: () => void;
  sourceCounts?: Record<string, { checked: number; available: number }>;
  sourceMatchMode?: "all" | "any";
  onSourceMatchModeChange?: (m: "all" | "any") => void;
  /**
   * The game list the live per-option match counts are computed against
   * (e.g. the currently displayed results). When omitted, no counts render.
   */
  countSource?: StoreGameSummary[];
}

export default function StoreFilterSidebar({
  selectedGenres,
  selectedPlatforms,
  platformNames = [],
  yearMin,
  yearMax,
  ratingMin,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onApply,
  onReset,
  countSource = [],
}: StoreFilterSidebarProps) {
  const { t } = useLanguage();

  const [genreSearch, setGenreSearch] = useState("");
  const [platformSearch, setPlatformSearch] = useState("");

  // Live per-option match counts over `countSource`. Each facet's numbers
  // are computed against all OTHER active filters, so a pill's badge shows
  // how many games would remain if that option were toggled on.
  const counts = useMemo(() => {
    const genres: Record<string, number> = {};
    const platforms: Record<string, number> = {};
    const years = YEAR_PRESETS.map(() => 0);
    const presets = { highRated: 0, newReleases: 0 };
    const ratingTicks = [0, 0, 0]; // 50 / 75 / 90

    for (const g of countSource) {
      if (
        matchesFacetFilters(
          g,
          selectedGenres,
          selectedPlatforms,
          yearMin,
          yearMax,
          ratingMin,
          "genre"
        )
      ) {
        for (const genre of g.genres) {
          genres[genre] = (genres[genre] ?? 0) + 1;
        }
      }
      if (
        matchesFacetFilters(
          g,
          selectedGenres,
          selectedPlatforms,
          yearMin,
          yearMax,
          ratingMin,
          "platform"
        )
      ) {
        for (const p of g.platforms) platforms[p] = (platforms[p] ?? 0) + 1;
      }
      if (
        matchesFacetFilters(
          g,
          selectedGenres,
          selectedPlatforms,
          yearMin,
          yearMax,
          ratingMin,
          "year"
        )
      ) {
        const y = g.firstReleaseDate
          ? new Date(g.firstReleaseDate).getFullYear()
          : null;
        if (y != null) {
          YEAR_PRESETS.forEach((preset, i) => {
            if (preset.min != null && y < preset.min) return;
            if (preset.max != null && y > preset.max) return;
            years[i] += 1;
          });
          if (y >= 2024 && y <= 2026) presets.newReleases += 1;
        }
      }
      if (
        matchesFacetFilters(
          g,
          selectedGenres,
          selectedPlatforms,
          yearMin,
          yearMax,
          ratingMin,
          "rating"
        )
      ) {
        if (g.rating != null) {
          if (g.rating >= 80) presets.highRated += 1;
          if (g.rating >= 50) ratingTicks[0] += 1;
          if (g.rating >= 75) ratingTicks[1] += 1;
          if (g.rating >= 90) ratingTicks[2] += 1;
        }
      }
    }
    return { genres, platforms, years, presets, ratingTicks };
  }, [
    countSource,
    selectedGenres,
    selectedPlatforms,
    yearMin,
    yearMax,
    ratingMin,
  ]);

  const handleGenreToggle = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const handlePlatformToggle = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      onPlatformsChange(selectedPlatforms.filter((p) => p !== platform));
    } else {
      onPlatformsChange([...selectedPlatforms, platform]);
    }
  };

  const filteredGenres = GENRES.filter((g) =>
    g.toLowerCase().includes(genreSearch.toLowerCase())
  );

  const filteredPlatforms = platformNames.filter((p) =>
    p.toLowerCase().includes(platformSearch.toLowerCase())
  );

  return (
    <aside className="store-filter-sidebar" aria-label={t("store.filters")}>
      {/* Quick Presets Section */}
      <div className="store-filter-section store-filter-section--presets">
        <h4 className="store-filter-heading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {t("store.filters.presetTitle")}
        </h4>
        <div className="store-filter-presets">
          <button
            type="button"
            className={`store-filter-preset-btn${ratingMin === 80 ? " active" : ""}`}
            onClick={() => onRatingMinChange(ratingMin === 80 ? null : 80)}
          >
            {t("store.filters.presetHighRated")}
            {counts.presets.highRated > 0 && (
              <span className="store-filter-match-count">{counts.presets.highRated}</span>
            )}
          </button>
          <button
            type="button"
            className={`store-filter-preset-btn${yearMin === 2024 && yearMax === 2026 ? " active" : ""}`}
            onClick={() => {
              if (yearMin === 2024 && yearMax === 2026) {
                onYearRangeChange(null, null);
              } else {
                onYearRangeChange(2024, 2026);
              }
            }}
          >
            {t("store.filters.presetNew")}
            {counts.presets.newReleases > 0 && (
              <span className="store-filter-match-count">{counts.presets.newReleases}</span>
            )}
          </button>
        </div>
      </div>

      {/* Genres Section with inline search */}
      <div className="store-filter-section">
        <div className="store-filter-section-header">
          <h4 className="store-filter-heading">
            {t("store.compare.genres")}
            {selectedGenres.length > 0 && (
              <span className="store-filter-count-badge">{selectedGenres.length}</span>
            )}
          </h4>
          {selectedGenres.length > 0 && (
            <button
              type="button"
              className="store-filter-section-clear"
              onClick={() => onGenresChange([])}
            >
              {t("common.clear")}
            </button>
          )}
        </div>

        <div className="store-filter-inline-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t("store.filters.searchGenres")}
            value={genreSearch}
            onChange={(e) => setGenreSearch(e.target.value)}
          />
          {genreSearch && (
            <button type="button" onClick={() => setGenreSearch("")} aria-label="Clear">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="store-filter-pills">
          {filteredGenres.map((genre) => {
            const count = counts.genres[genre] ?? 0;
            return (
              <button
                key={genre}
                type="button"
                className={`store-filter-pill${selectedGenres.includes(genre) ? " active" : ""}`}
                onClick={() => handleGenreToggle(genre)}
              >
                {genre}
                {count > 0 && (
                  <span className="store-filter-match-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Platforms Section with inline search */}
      <div className="store-filter-section">
        <div className="store-filter-section-header">
          <h4 className="store-filter-heading">
            {t("store.compare.platforms")}
            {selectedPlatforms.length > 0 && (
              <span className="store-filter-count-badge">{selectedPlatforms.length}</span>
            )}
          </h4>
          {selectedPlatforms.length > 0 && (
            <button
              type="button"
              className="store-filter-section-clear"
              onClick={() => onPlatformsChange([])}
            >
              {t("common.clear")}
            </button>
          )}
        </div>

        <div className="store-filter-inline-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t("store.filters.searchPlatforms")}
            value={platformSearch}
            onChange={(e) => setPlatformSearch(e.target.value)}
          />
          {platformSearch && (
            <button type="button" onClick={() => setPlatformSearch("")} aria-label="Clear">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="store-filter-pills">
          {filteredPlatforms.map((platform) => {
            const count = counts.platforms[platform] ?? 0;
            return (
              <button
                key={platform}
                type="button"
                className={`store-filter-pill${selectedPlatforms.includes(platform) ? " active" : ""}`}
                onClick={() => handlePlatformToggle(platform)}
              >
                {platform}
                {count > 0 && (
                  <span className="store-filter-match-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Release Year Section */}
      <div className="store-filter-section">
        <div className="store-filter-section-header">
          <h4 className="store-filter-heading">{t("store.filter.releaseYear")}</h4>
          {(yearMin != null || yearMax != null) && (
            <button
              type="button"
              className="store-filter-section-clear"
              onClick={() => onYearRangeChange(null, null)}
            >
              {t("common.clear")}
            </button>
          )}
        </div>

        <div className="store-filter-year-presets">
          {YEAR_PRESETS.map((preset, idx) => {
            const isMatch = yearMin === preset.min && yearMax === preset.max;
            const count = counts.years[idx];
            return (
              <button
                key={preset.label}
                type="button"
                className={`store-filter-preset-pill${isMatch ? " active" : ""}`}
                onClick={() => onYearRangeChange(preset.min, preset.max)}
              >
                {preset.label}
                {count > 0 && (
                  <span className="store-filter-match-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="store-filter-year-row">
          <input
            type="number"
            className="store-filter-year-input"
            placeholder={t("store.filter.yearFrom")}
            value={yearMin ?? ""}
            onChange={(e) =>
              onYearRangeChange(
                e.target.value ? Number(e.target.value) : null,
                yearMax
              )
            }
            min={1970}
            max={2030}
          />
          <span className="store-filter-year-sep">–</span>
          <input
            type="number"
            className="store-filter-year-input"
            placeholder={t("store.filter.yearTo")}
            value={yearMax ?? ""}
            onChange={(e) =>
              onYearRangeChange(
                yearMin,
                e.target.value ? Number(e.target.value) : null
              )
            }
            min={1970}
            max={2030}
          />
        </div>
      </div>

      {/* Minimum Rating Slider */}
      <div className="store-filter-section">
        <div className="store-filter-rating-head">
          <h4 className="store-filter-heading">{t("store.filter.minRating")}</h4>
          <span className="store-filter-rating-value">
            {ratingMin != null && ratingMin > 0 ? `${ratingMin}%+` : t("common.all")}
          </span>
        </div>
        <input
          type="range"
          className="store-filter-slider"
          min={0}
          max={95}
          step={5}
          value={ratingMin ?? 0}
          onChange={(e) =>
            onRatingMinChange(
              Number(e.target.value) > 0 ? Number(e.target.value) : null
            )
          }
        />
        <div className="store-filter-slider-ticks">
          <span>0%</span>
          <span>50%{counts.ratingTicks[0] > 0 ? ` · ${counts.ratingTicks[0]}` : ""}</span>
          <span>75%{counts.ratingTicks[1] > 0 ? ` · ${counts.ratingTicks[1]}` : ""}</span>
          <span>90%+{counts.ratingTicks[2] > 0 ? ` · ${counts.ratingTicks[2]}` : ""}</span>
        </div>
      </div>

      {/* Live-count footnote: counts are over loaded results, not the
          whole IGDB catalog, so a zero badge only means "no match among
          games loaded so far". */}
      {countSource.length > 0 && (
        <p className="store-filter-counts-note">{t("store.filters.countsNote")}</p>
      )}

      {/* Actions */}
      <div className="store-filter-actions">
        <button type="button" className="store-filter-btn apply" onClick={onApply}>
          {t("store.filter.applyFilters")}
        </button>
        <button type="button" className="store-filter-btn reset" onClick={onReset}>
          {t("common.reset")}
        </button>
      </div>
    </aside>
  );
}
