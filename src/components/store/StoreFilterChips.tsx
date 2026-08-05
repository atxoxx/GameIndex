import type { SourceLink } from "../../types/source";
import { useLanguage } from "../../context/LanguageContext";

interface StoreFilterChipsProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  /**
   * SourceLink IDs the user has selected for the download-source filter.
   * The display name is resolved against the full `sources` list so the
   * chip shows the user-friendly name rather than the opaque id.
   */
  selectedSourceIds: string[];
  /** All known sources from `useSources()` (any enabled state). */
  sources: SourceLink[];
  /**
   * Match semantics for the source filter: "all" (AND) or "any" (OR).
   * Shown on a display chip (only when >= 2 sources are selected).
   */
  sourceMatchMode?: "all" | "any";
  /**
   * When provided, the mode chip becomes clickable and toggles between
   * "any" and "all". When undefined, the chip renders as a plain span.
   */
  onToggleSourceMatchMode?: () => void;
  /**
   * Number of (game, source) checks currently in flight from
   * `useStoreSourceAvailability`. When > 0 alongside an active source
   * filter, we render a "Checking…" chip so the user knows the result
   * set is still narrowing.
   */
  sourceChecksPending: number;
  onRemoveGenre: (g: string) => void;
  onRemovePlatform: (p: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onRemoveSource: (sourceId: string) => void;
  resultCount?: number;
}

export default function StoreFilterChips({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  selectedSourceIds,
  sources,
  sourceMatchMode = "all",
  onToggleSourceMatchMode,
  sourceChecksPending,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onRemoveSource,
  resultCount,
}: StoreFilterChipsProps) {
  const { t } = useLanguage();
  const hasFilters =
    selectedGenres.length > 0 ||
    selectedPlatforms.length > 0 ||
    yearMin != null ||
    yearMax != null ||
    ratingMin != null ||
    selectedSourceIds.length > 0;

  if (!hasFilters) return null;

  // Build a name lookup so chip removal can find human-readable names
  // without having to thread the full sources list down to a callback.
  const sourceNameById = new Map<string, string>();
  for (const s of sources) {
    sourceNameById.set(s.id, s.name);
  }

  return (
    <div className="store-filter-chips">
      {resultCount != null && (
        <span className="store-filter-count">
          {t("storage.gamesCount", { count: resultCount, plural: resultCount !== 1 ? "s" : "" })}
        </span>
      )}

      {selectedGenres.map((genre) => (
        <span key={`g-${genre}`} className="store-filter-chip">
          {genre}
          <button onClick={() => onRemoveGenre(genre)} aria-label={t("store.filter.removeItem", { name: genre })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {selectedPlatforms.map((platform) => (
        <span key={`p-${platform}`} className="store-filter-chip">
          {platform}
          <button onClick={() => onRemovePlatform(platform)} aria-label={t("store.filter.removeItem", { name: platform })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {(yearMin != null || yearMax != null) && (
        <span className="store-filter-chip">
          {yearMin ?? "..."} – {yearMax ?? "..."}
          <button onClick={onRemoveYear} aria-label={t("store.filter.removeYear")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {ratingMin != null && (
        <span className="store-filter-chip">
          ⭐ {ratingMin}+
          <button onClick={onRemoveRating} aria-label={t("store.filter.removeRating")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {/* Match-mode display chip: clickable (toggles any/all) when a
          handler is wired, otherwise a plain read-only chip. The icon +
          hover/active styles make it read as a live toggle rather than a
          removable filter chip. */}
      {selectedSourceIds.length >= 2 &&
        (onToggleSourceMatchMode ? (
          <button
            key="s-mode"
            type="button"
            className="store-filter-chip store-filter-chip-mode"
            onClick={onToggleSourceMatchMode}
            aria-label={
              sourceMatchMode === "any"
                ? t("store.filter.matchModeAria", { mode: t("store.filter.matchAll") })
                : t("store.filter.matchModeAria", { mode: t("store.filter.matchAny") })
            }
          >
            <svg
              className="store-filter-chip-mode-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {sourceMatchMode === "any"
              ? t("store.filter.matchAny")
              : t("store.filter.matchAll")}
          </button>
        ) : (
          <span key="s-mode" className="store-filter-chip store-filter-chip-mode">
            <svg
              className="store-filter-chip-mode-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {sourceMatchMode === "any"
              ? t("store.filter.matchAny")
              : t("store.filter.matchAll")}
          </span>
        ))}

      {selectedSourceIds.map((sourceId) => {
        const name = sourceNameById.get(sourceId) ?? t("store.filter.unknownSource");
        return (
          <span key={`s-${sourceId}`} className="store-filter-chip store-filter-chip-source">
            <svg
              className="store-filter-chip-source-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {name}
            <button
              onClick={() => onRemoveSource(sourceId)}
              aria-label={t("store.filter.removeSource", { name })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        );
      })}

      {selectedSourceIds.length > 0 && sourceChecksPending > 0 && (
        <span className="store-filter-chip store-filter-chip-pending">
          <span className="store-filter-chip-spinner" aria-hidden="true" />
          {t("store.checking", { count: sourceChecksPending })}
        </span>
      )}
    </div>
  );
}
