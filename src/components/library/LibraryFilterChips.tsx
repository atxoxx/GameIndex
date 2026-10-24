import { Bookmark, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { LibraryFilters, LibraryStatus } from "../../hooks/useLibraryFilters";
import { PLAY_STATUS_DETAILS, type LibrarySource } from "../../types/game";
import { shelfDisplayName, type Shelf } from "../../types/shelf";
import { sourceLabel } from "./librarySources";

interface LibraryFilterChipsProps {
  filters: LibraryFilters;
  resultCount: number;
  /** Applied shelf, shown as its own dismissable chip. */
  activeShelf: Shelf | null;
  onRemoveSearch: () => void;
  onRemoveGenre: (genre: string) => void;
  onRemovePlatform: (platform: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onRemoveStatus: () => void;
  onRemovePlayStatus: () => void;
  onRemoveSource: () => void;
  onRemoveVrOnly: () => void;
  onClearShelf: () => void;
  onSaveAsShelf: () => void;
  onResetAll: () => void;
}

const STATUS_LABEL_KEYS: Record<LibraryStatus, string> = {
  all: "common.all",
  installed: "filter.installed",
  not_installed: "filter.notInstalled",
};

/**
 * LibraryFilterChips — the dismissable summary of everything currently
 * narrowing the grid, including the applied shelf.
 *
 * The row only exists while a filter is active, so the page never spends
 * vertical space on an empty band. Chips remove one facet at a time; "Save as
 * shelf" turns the whole set into a reusable collection.
 */
export default function LibraryFilterChips({
  filters,
  resultCount,
  activeShelf,
  onRemoveSearch,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onRemoveStatus,
  onRemovePlayStatus,
  onRemoveSource,
  onRemoveVrOnly,
  onClearShelf,
  onSaveAsShelf,
  onResetAll,
}: LibraryFilterChipsProps) {
  const { t } = useLanguage();

  const hasAny =
    activeShelf !== null ||
    filters.search.length > 0 ||
    filters.genres.length > 0 ||
    filters.platforms.length > 0 ||
    filters.yearMin != null ||
    filters.yearMax != null ||
    filters.ratingMin != null ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.playStatus !== "all" ||
    filters.vrOnly;

  if (!hasAny) return null;

  const chip = (key: string, label: string, onRemove: () => void) => (
    <span key={key} className="library-chip">
      <span className="library-chip-label" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="library-chip-remove"
        onClick={onRemove}
        aria-label={`${t("library.removeFilter")}: ${label}`}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );

  const sourceChipLabel = (source: LibrarySource) => sourceLabel(source, t);

  return (
    <div className="library-chips" role="group" aria-label={t("library.filtersAria")}>
      <span className="library-chips-count">
        {t("storage.gamesCount", {
          count: resultCount,
          plural: resultCount !== 1 ? "s" : "",
        })}
      </span>

      <div className="library-chips-list">
        {activeShelf &&
          chip(
            `shelf-${activeShelf.id}`,
            t("library.chips.shelf", { name: shelfDisplayName(activeShelf.name, t) }),
            onClearShelf
          )}

        {filters.search &&
          chip("search", `“${filters.search}”`, onRemoveSearch)}

        {filters.playStatus !== "all" &&
          chip(
            "playStatus",
            t(PLAY_STATUS_DETAILS[filters.playStatus].labelKey),
            onRemovePlayStatus
          )}

        {filters.status !== "all" &&
          chip("status", t(STATUS_LABEL_KEYS[filters.status]), onRemoveStatus)}

        {filters.source !== "all" &&
          chip("source", sourceChipLabel(filters.source), onRemoveSource)}

        {filters.genres.map((genre) => chip(`genre-${genre}`, genre, () => onRemoveGenre(genre)))}

        {filters.platforms.map((platform) =>
          chip(`platform-${platform}`, platform, () => onRemovePlatform(platform))
        )}

        {(filters.yearMin != null || filters.yearMax != null) &&
          chip(
            "year",
            `${filters.yearMin ?? "…"} – ${filters.yearMax ?? "…"}`,
            onRemoveYear
          )}

        {filters.ratingMin != null &&
          chip("rating", `${filters.ratingMin}+`, onRemoveRating)}

        {filters.vrOnly && chip("vr", t("library.filter.vrOnly"), onRemoveVrOnly)}
      </div>

      <div className="library-chips-actions">
        <button
          type="button"
          className="library-chips-action"
          onClick={onSaveAsShelf}
          title={t("shelves.createFromFilters")}
        >
          <Bookmark size={13} aria-hidden="true" />
          <span>{t("library.chips.saveAsShelf")}</span>
        </button>
        <button type="button" className="library-chips-action" onClick={onResetAll}>
          {t("page.library.clearFilters")}
        </button>
      </div>
    </div>
  );
}
