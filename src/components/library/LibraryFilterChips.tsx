import type { LibraryFilters, LibraryStatus } from "../../hooks/useLibraryFilters";
import type { LibrarySource } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryFilterChipsProps {
  filters: LibraryFilters;
  resultCount: number;
  onRemoveSearch: () => void;
  onRemoveGenre: (g: string) => void;
  onRemovePlatform: (p: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onRemoveStatus: () => void;
  onRemovePlayStatus: () => void;
  onRemoveSource: () => void;
  onResetAll: () => void;
}

const statusLabelKey: Record<LibraryStatus, string> = {
  all: "common.all",
  installed: "filter.installed",
  not_installed: "filter.notInstalled",
};

// Brand names stay untranslated; "all" / "local" resolve via i18n keys.
const sourceLabel: Record<LibrarySource, string | { key: string }> = {
  all: { key: "common.all" },
  steam: "Steam",
  local: { key: "common.local" },
  gog: "GOG",
  epic: "Epic",
  humble: "Humble",
  rockstar: "Rockstar",
  ubisoft: "Ubisoft",
};

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const chipIcons: Record<string, React.ReactNode> = {
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  status: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  playStatus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  genre: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  platform: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="2" y1="9" x2="22" y2="9" />
    </svg>
  ),
  year: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  rating: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

/**
 * LibraryFilterChips: horizontal row of dismissable chips summarizing the
 * active filter set, with a live result count. Renders nothing when no
 * filters are applied.
 */
export default function LibraryFilterChips({
  filters,
  resultCount,
  onRemoveSearch,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onRemoveStatus,
  onRemovePlayStatus,
  onRemoveSource,
  onResetAll,
}: LibraryFilterChipsProps) {
  const { t } = useLanguage();
  const hasAny =
    filters.search.length > 0 ||
    filters.genres.length > 0 ||
    filters.platforms.length > 0 ||
    filters.yearMin != null ||
    filters.yearMax != null ||
    filters.ratingMin != null ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.playStatus !== "all";

  if (!hasAny) return null;

  return (
    <div className="lib-chips">
      <span className="lib-chip-count">
        {t("storage.gamesCount", { count: resultCount, plural: resultCount !== 1 ? "s" : "" })}
      </span>

      {filters.search && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.search}</span>
          &ldquo;{filters.search}&rdquo;
          <button type="button" onClick={onRemoveSearch} aria-label={t("friends.clearSearch")}>{CloseIcon}</button>
        </span>
      )}

      {filters.status !== "all" && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.status}</span>
          {t(statusLabelKey[filters.status])}
          <button type="button" onClick={onRemoveStatus} aria-label={t("library.clearStatusFilter")}>{CloseIcon}</button>
        </span>
      )}

      {filters.playStatus !== "all" && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.playStatus}</span>
          {t(PLAY_STATUS_DETAILS[filters.playStatus].labelKey)}
          <button type="button" onClick={onRemovePlayStatus} aria-label={t("library.clearPlayStatusFilter")}>{CloseIcon}</button>
        </span>
      )}

      {filters.source !== "all" && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.source}</span>
          {(() => {
            const label = sourceLabel[filters.source];
            return typeof label === "string" ? label : t(label.key);
          })()}
          <button type="button" onClick={onRemoveSource} aria-label={t("library.clearSourceFilter")}>{CloseIcon}</button>
        </span>
      )}

      {filters.genres.map((genre) => (
        <span key={`g-${genre}`} className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.genre}</span>
          {genre}
          <button type="button" onClick={() => onRemoveGenre(genre)} aria-label={t("library.removeFilter", { name: genre })}>{CloseIcon}</button>
        </span>
      ))}

      {filters.platforms.map((platform) => (
        <span key={`p-${platform}`} className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.platform}</span>
          {platform}
          <button type="button" onClick={() => onRemovePlatform(platform)} aria-label={t("library.removeFilter", { name: platform })}>{CloseIcon}</button>
        </span>
      ))}

      {(filters.yearMin != null || filters.yearMax != null) && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.year}</span>
          {filters.yearMin ?? "..."} – {filters.yearMax ?? "..."}
          <button type="button" onClick={onRemoveYear} aria-label={t("library.clearYearFilter")}>{CloseIcon}</button>
        </span>
      )}

      {filters.ratingMin != null && (
        <span className="lib-chip">
          <span className="lib-chip-icon" aria-hidden>{chipIcons.rating}</span>
          {filters.ratingMin}+
          <button type="button" onClick={onRemoveRating} aria-label={t("library.clearRatingFilter")}>{CloseIcon}</button>
        </span>
      )}

      <button type="button" className="lib-chip-reset" onClick={onResetAll}>
        {t("wishlist.clearAll")}
      </button>
    </div>
  );
}
