import { useSources } from "../../context/SourceContext";
import type { SourceLink } from "../../types/source";
import { useLanguage } from "../../context/LanguageContext";

export const GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Shooter",
  "Simulation",
  "Puzzle",
  "Racing",
  "Sports",
  "Fighting",
  "Platform",
  "Indie",
  "Horror",
  "Visual Novel",
];

const PLATFORMS = [
  "PC (Microsoft Windows)",
  "PlayStation 5",
  "PlayStation 4",
  "Xbox Series X|S",
  "Xbox One",
  "Nintendo Switch",
];

interface StoreFilterSidebarProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  selectedSourceIds: string[];
  onGenresChange: (genres: string[]) => void;
  onPlatformsChange: (platforms: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (rating: number | null) => void;
  onSourcesChange: (sourceIds: string[]) => void;
  onApply: () => void;
  onReset: () => void;
  /** Real per-source match counts from `useSourceAvailabilityCache`. */
  sourceCounts?: Record<string, { checked: number; available: number }>;
  /** Match semantics for the source filter: "all" (AND) or "any" (OR). */
  sourceMatchMode?: "all" | "any";
  /** Called when the user flips the match-mode toggle. */
  onSourceMatchModeChange?: (m: "all" | "any") => void;
}

export default function StoreFilterSidebar({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  selectedSourceIds,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onSourcesChange,
  onApply,
  onReset,
  sourceCounts,
  sourceMatchMode = "all",
  onSourceMatchModeChange,
}: StoreFilterSidebarProps) {
  const { t } = useLanguage();
  // Hook up to the live source list so the sidebar re-renders when the
  // user adds/removes/toggles a source in Settings. Only enabled
  // sources are surfaced — a disabled source wouldn't contribute to
  // any download-search call, so showing it as a filter option would
  // be misleading.
  const { sources } = useSources();
  const enabledSources: SourceLink[] = sources.filter((s) => s.enabled);

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

  const handleSourceToggle = (sourceId: string) => {
    if (selectedSourceIds.includes(sourceId)) {
      onSourcesChange(selectedSourceIds.filter((s) => s !== sourceId));
    } else {
      onSourcesChange([...selectedSourceIds, sourceId]);
    }
  };

  return (
    <aside className="store-filter-sidebar">
      <div className="store-filter-section">
        <h4 className="store-filter-heading">
          {t("store.compare.genres")}
          {selectedGenres.length > 0 && (
            <span className="store-filter-count-badge">{selectedGenres.length}</span>
          )}
        </h4>
        <div className="store-filter-pills">
          {GENRES.map((genre) => (
            <button
              key={genre}
              type="button"
              className={`store-filter-pill${selectedGenres.includes(genre) ? " active" : ""}`}
              onClick={() => handleGenreToggle(genre)}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">
          {t("store.compare.platforms")}
          {selectedPlatforms.length > 0 && (
            <span className="store-filter-count-badge">{selectedPlatforms.length}</span>
          )}
        </h4>
        <div className="store-filter-pills">
          {PLATFORMS.map((platform) => (
            <button
              key={platform}
              type="button"
              className={`store-filter-pill${selectedPlatforms.includes(platform) ? " active" : ""}`}
              onClick={() => handlePlatformToggle(platform)}
            >
              {platform}
            </button>
          ))}
        </div>
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">{t("store.filter.releaseYear")}</h4>
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

      <div className="store-filter-section">
        <div className="store-filter-rating-head">
          <h4 className="store-filter-heading">{t("store.filter.minRating")}</h4>
          <span className="store-filter-rating-value">{ratingMin ?? 0}+</span>
        </div>
        <input
          type="range"
          className="store-filter-slider"
          min={0}
          max={100}
          step={5}
          value={ratingMin ?? 0}
          onChange={(e) =>
            onRatingMinChange(
              Number(e.target.value) > 0 ? Number(e.target.value) : null
            )
          }
        />
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">
          {t("store.filter.downloadSources")}
          {selectedSourceIds.length > 0 && (
            <span className="store-filter-count-badge">{selectedSourceIds.length}</span>
          )}
        </h4>
        {enabledSources.length === 0 ? (
          <p className="store-filter-empty-text">
            {t("store.filter.noSources")}
          </p>
        ) : (
          <>
            {/* Match-mode toggle: OR (any) vs AND (all) semantics.
                De-emphasized while fewer than two sources are selected —
                with 0 or 1 sources the two modes behave identically, so
                the control is kept visible for discoverability but reads
                as inert until it actually does something. */}
            <div
              className={`store-filter-match-mode${selectedSourceIds.length < 2 ? " store-filter-match-mode--idle" : ""}`}
              role="group"
              aria-label={t("store.filter.downloadSources")}
              title={selectedSourceIds.length < 2 ? t("store.filter.matchModeHint") : undefined}
            >
              <button
                type="button"
                className={`store-filter-match-mode-btn${sourceMatchMode === "any" ? " active" : ""}`}
                aria-pressed={sourceMatchMode === "any"}
                onClick={() => onSourceMatchModeChange?.("any")}
              >
                {t("store.filter.matchAny")}
              </button>
              <button
                type="button"
                className={`store-filter-match-mode-btn${sourceMatchMode === "all" ? " active" : ""}`}
                aria-pressed={sourceMatchMode === "all"}
                onClick={() => onSourceMatchModeChange?.("all")}
              >
                {t("store.filter.matchAll")}
              </button>
            </div>
            <div className="store-filter-pills store-filter-pills-sources">
              {enabledSources.map((source) => {
                // Prefer the real per-source match count once the
                // availability cache covers this source; fall back to the
                // static config count (from the source fetch) otherwise.
                const realCount = sourceCounts?.[source.id];
                const hasRealCount = realCount !== undefined && realCount.checked > 0;
                const count = hasRealCount ? realCount.available : source.gameCount;
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`store-filter-pill store-filter-source-pill${selectedSourceIds.includes(source.id) ? " active" : ""}`}
                    onClick={() => handleSourceToggle(source.id)}
                    title={source.url}
                  >
                    {source.name}
                    {(hasRealCount || count > 0) && (
                      <span
                        className={`store-filter-source-count${hasRealCount ? " store-filter-source-count--real" : ""}`}
                      >
                        {count >= 1000
                          ? `${(count / 1000).toFixed(1)}k`
                          : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="store-filter-actions">
        <button className="store-filter-btn apply" onClick={onApply}>
          {t("store.filter.applyFilters")}
        </button>
        <button className="store-filter-btn reset" onClick={onReset}>
          {t("common.reset")}
        </button>
      </div>
    </aside>
  );
}
