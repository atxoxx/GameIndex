import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { QuickFilterPreset, SidebarQuickFilterBarProps } from "./types";

/**
 * SidebarQuickFilterBar
 * ─────────────────────
 * Segmented 1-click filter preset pills in the sidebar header.
 * Quickly filters the game list without having to open the advanced filter popover:
 *   • All: Everything in library
 *   • Installed: Only installed & playable
 *   • Favorites: Starred / Pinned games
 *   • Playing: Currently active / playing status
 */
function SidebarQuickFilterBarBase({
  activePreset,
  onSelectPreset,
  counts,
}: SidebarQuickFilterBarProps) {
  const { t } = useLanguage();

  const presets: { id: QuickFilterPreset; label: string; count: number }[] = [
    { id: "all", label: t("sidebar.quickPreset.all"), count: counts.all },
    { id: "installed", label: t("sidebar.quickPreset.installed"), count: counts.installed },
    { id: "favorites", label: t("sidebar.quickPreset.favorites"), count: counts.favorites },
    { id: "playing", label: t("sidebar.quickPreset.playing"), count: counts.playing },
  ];

  return (
    <div
      className="sidebar-quick-filters"
      role="tablist"
      aria-label={t("sidebar.quickFiltersAria")}
    >
      {presets.map((preset) => {
        const isActive = activePreset === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`sidebar-quick-filter-pill${isActive ? " active" : ""}`}
            onClick={() => onSelectPreset(preset.id)}
            title={`${preset.label} (${preset.count})`}
          >
            <span className="sidebar-quick-filter-pill__label">{preset.label}</span>
            <span className="sidebar-quick-filter-pill__count">{preset.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export const SidebarQuickFilterBar = memo(SidebarQuickFilterBarBase);
export default SidebarQuickFilterBar;
