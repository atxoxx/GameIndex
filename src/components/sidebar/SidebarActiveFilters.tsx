import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS, type PlayStatus } from "../../types/game";
import type { SidebarActiveFiltersProps } from "./types";

/**
 * SidebarActiveFilters
 * ────────────────────
 * The horizontal strip of removable chips below the search row.
 * Each chip represents one advanced filter facet (status, source,
 * play status, genres, platforms, year, rating) plus a virtual
 * "Clear all" affordance at the start when more than one chip is
 * active. The strip scrolls horizontally on overflow rather than
 * wrapping, so it never pushes the divider down. Hidden entirely
 * when no filters are active.
 */
function SidebarActiveFiltersBase({
  filterState,
  onRemoveStatus,
  onRemoveSource,
  onRemovePlayStatus,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onReset,
}: SidebarActiveFiltersProps) {
  const { t } = useLanguage();
  const chips: { key: string; label: string; remove: () => void }[] = [];

  if (filterState.status !== "all") {
    chips.push({
      key: "status",
      label:
        filterState.status === "installed"
          ? t("filter.installed")
          : t("filter.uninstalled"),
      remove: onRemoveStatus,
    });
  }

  if (filterState.source !== "all") {
    chips.push({
      key: `source-${filterState.source}`,
      label: t("sidebar.sourceChip", { value: filterState.source }),
      remove: onRemoveSource,
    });
  }

  if (filterState.playStatus !== "all") {
    const meta = PLAY_STATUS_DETAILS[filterState.playStatus as PlayStatus];
    chips.push({
      key: "play-status",
      label: meta ? t(meta.labelKey) : filterState.playStatus,
      remove: onRemovePlayStatus,
    });
  }

  for (const g of filterState.genres) {
    chips.push({ key: `g-${g}`, label: g, remove: () => onRemoveGenre(g) });
  }

  for (const p of filterState.platforms) {
    chips.push({ key: `p-${p}`, label: p, remove: () => onRemovePlatform(p) });
  }

  if (filterState.yearMin != null || filterState.yearMax != null) {
    chips.push({
      key: "year",
      label: `${filterState.yearMin ?? "any"}–${filterState.yearMax ?? "any"}`,
      remove: onRemoveYear,
    });
  }

  if (filterState.ratingMin != null) {
    chips.push({
      key: "rating",
      label: `≥${filterState.ratingMin}%`,
      remove: onRemoveRating,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      className="sidebar-active-filters"
      role="region"
      aria-label={t("sidebar.activeAdvancedFilters")}
    >
      {chips.length > 1 && (
        <span className="sidebar-active-filter">
          {t("wishlist.clearAll")}
          <button
            type="button"
            onClick={onReset}
            className="sidebar-active-filter__remove"
            aria-label={t("sidebar.clearAllFilters")}
            title={t("sidebar.clearFilters")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </span>
      )}
      {chips.map((c) => (
        <span key={c.key} className="sidebar-active-filter">
          {c.label}
          <button
            type="button"
            onClick={c.remove}
            className="sidebar-active-filter__remove"
            aria-label={t("sidebar.removeFilter", { name: c.label })}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}

export const SidebarActiveFilters = memo(SidebarActiveFiltersBase);
export default SidebarActiveFilters;
