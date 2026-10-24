import { useLanguage } from "../../context/LanguageContext";
import type { LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABEL_KEYS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type {
  SidebarDensity,
  SidebarGroupBy,
  SidebarViewOptions,
} from "./types";

export interface SidebarViewOptionsPanelProps {
  groupBy: SidebarGroupBy;
  onGroupByChange: (groupBy: SidebarGroupBy) => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  sortDirection: "asc" | "desc";
  onToggleSortDirection: () => void;
  density: SidebarDensity;
  onDensityChange: (density: SidebarDensity) => void;
  viewOptions: SidebarViewOptions;
  onToggleOption: (key: keyof SidebarViewOptions) => void;
  onExpandAllGroups?: () => void;
  onCollapseAllGroups?: () => void;
  hasGroups: boolean;
}

const GROUP_BY_OPTIONS: { id: SidebarGroupBy; labelKey: string }[] = [
  { id: "none", labelKey: "sidebar.groupBy.none" },
  { id: "platform", labelKey: "sidebar.groupBy.platform" },
  { id: "play_status", labelKey: "sidebar.groupBy.status" },
  { id: "genre", labelKey: "sidebar.groupBy.genre" },
  { id: "letter", labelKey: "sidebar.groupBy.letter" },
  { id: "installed", labelKey: "sidebar.groupBy.installed" },
  { id: "decade", labelKey: "sidebar.groupBy.decade" },
  { id: "vr", labelKey: "sidebar.groupBy.vr" },
];

const DENSITY_OPTIONS: { id: SidebarDensity; labelKey: string }[] = [
  { id: "compact", labelKey: "sidebar.density.compact" },
  { id: "standard", labelKey: "sidebar.density.standard" },
  { id: "detailed", labelKey: "sidebar.density.detailed" },
];

/**
 * ViewOptionsPanel
 * ────────────────
 * The grouping / sorting / density / metadata controls, rendered inline inside
 * the rail's "…" panel. It used to be a second floating panel anchored to the
 * same button, which meant a click could close the menu and show nothing if the
 * anchor or the open state was stale. Inline, the controls simply appear where
 * they were asked for.
 */
export default function SidebarViewOptionsPanel({
  groupBy,
  onGroupByChange,
  sort,
  onSortChange,
  sortDirection,
  onToggleSortDirection,
  density,
  onDensityChange,
  viewOptions,
  onToggleOption,
  onExpandAllGroups,
  onCollapseAllGroups,
  hasGroups,
}: SidebarViewOptionsPanelProps) {
  const { t } = useLanguage();

  return (
    <div className="sbn-view-panel" role="group" aria-label={t("sidebar.viewOptionsTitle")}>
      <div className="sbn-view-section">
        <span className="sbn-view-label">{t("sidebar.groupByLabel")}</span>
        <div className="sbn-view-pills">
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`sbn-view-pill${groupBy === opt.id ? " is-active" : ""}`}
              aria-pressed={groupBy === opt.id}
              onClick={() => onGroupByChange(opt.id)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
        {hasGroups && (
          <div className="sbn-view-actions">
            <button type="button" className="sbn-view-link" onClick={onExpandAllGroups}>
              {t("sidebar.expandAllGroups")}
            </button>
            <button type="button" className="sbn-view-link" onClick={onCollapseAllGroups}>
              {t("sidebar.collapseAllGroups")}
            </button>
          </div>
        )}
      </div>

      <div className="sbn-view-section">
        <span className="sbn-view-label">{t("sidebarFilter.sort")}</span>
        <div className="sbn-view-sort">
          <select
            className="sbn-view-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as LibrarySort)}
            aria-label={t("sidebarFilter.sort")}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(SORT_LABEL_KEYS[opt])}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`sbn-view-dir${sortDirection === "desc" ? " is-desc" : ""}`}
            onClick={onToggleSortDirection}
            title={
              sortDirection === "asc"
                ? t("sidebar.sortDirection.ascending")
                : t("sidebar.sortDirection.descending")
            }
            aria-label={
              sortDirection === "asc"
                ? t("sidebar.sortDirection.ascending")
                : t("sidebar.sortDirection.descending")
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sbn-view-section">
        <span className="sbn-view-label">{t("sidebar.densityLabel")}</span>
        <div className="sbn-view-pills sbn-view-pills--tri">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`sbn-view-pill${density === opt.id ? " is-active" : ""}`}
              aria-pressed={density === opt.id}
              onClick={() => onDensityChange(opt.id)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="sbn-view-section">
        <span className="sbn-view-label">{t("sidebar.visibleMetadataLabel")}</span>
        <div className="sbn-view-toggles">
          <label className="sbn-view-toggle">
            <span>{t("sidebar.metaShowPlaytime")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showPlaytime}
              onChange={() => onToggleOption("showPlaytime")}
            />
          </label>
          <label className="sbn-view-toggle">
            <span>{t("sidebar.metaShowPlatform")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showPlatformBadge}
              onChange={() => onToggleOption("showPlatformBadge")}
            />
          </label>
          <label className="sbn-view-toggle">
            <span>{t("sidebar.metaShowRatings")}</span>
            <input
              type="checkbox"
              checked={viewOptions.showRatings}
              onChange={() => onToggleOption("showRatings")}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
