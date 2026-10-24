import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

export type StoreFilterChipType = "genre" | "platform" | "year" | "rating";

interface StoreFilterChipsProps {
  genres: string[];
  platforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  onRemove: (type: StoreFilterChipType, value?: string) => void;
  onClearAll: () => void;
  onOpenFilters: () => void;
}

/**
 * Always-visible summary of the active catalogue filters. Chips are
 * removable in place, so refining a search never means reopening the
 * drawer; the empty state doubles as a second entry point to it.
 */
export default function StoreFilterChips({
  genres,
  platforms,
  yearMin,
  yearMax,
  ratingMin,
  onRemove,
  onClearAll,
  onOpenFilters,
}: StoreFilterChipsProps) {
  const { t } = useLanguage();

  const yearLabel =
    yearMin != null && yearMax != null
      ? t("store.chips.range", { from: yearMin, to: yearMax })
      : yearMin != null
        ? t("store.chips.from", { year: yearMin })
        : yearMax != null
          ? t("store.chips.until", { year: yearMax })
          : null;

  const chip = (label: string, type: StoreFilterChipType, value?: string) => (
    <span className="store-chip" key={`${type}:${value ?? "range"}`}>
      <span className="store-chip-label">{label}</span>
      <button
        type="button"
        className="store-chip-remove"
        onClick={() => onRemove(type, value)}
        aria-label={t("store.chips.remove", { label })}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </span>
  );

  const hasFilters =
    genres.length > 0 ||
    platforms.length > 0 ||
    yearLabel != null ||
    (ratingMin != null && ratingMin > 0);

  return (
    <div className="store-chips" role="group" aria-label={t("store.chips.label")}>
      <span className="store-chips-icon" aria-hidden="true">
        <SlidersHorizontal size={13} />
      </span>

      {hasFilters ? (
        <div className="store-chips-list">
          {genres.map((g) => chip(g, "genre", g))}
          {platforms.map((p) => chip(p, "platform", p))}
          {yearLabel && chip(yearLabel, "year")}
          {ratingMin != null && ratingMin > 0 &&
            chip(t("store.chips.rating", { rating: ratingMin }), "rating")}
        </div>
      ) : (
        <span className="store-chips-empty">{t("store.chips.empty")}</span>
      )}

      <div className="store-chips-actions">
        <button
          type="button"
          className="store-chips-add"
          onClick={onOpenFilters}
        >
          <Plus size={12} aria-hidden="true" />
          {t("store.chips.add")}
        </button>
        {hasFilters && (
          <button
            type="button"
            className="store-chips-clear"
            onClick={onClearAll}
          >
            {t("store.chips.clearAll")}
          </button>
        )}
      </div>
    </div>
  );
}
