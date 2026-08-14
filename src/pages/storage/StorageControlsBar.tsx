import { useState, useRef, useEffect } from "react";
import type { SortKey, GroupKey } from "./utils";
import { Button } from "../../components/ui";
import { BulkRecalcBar } from "./BulkRecalcBar";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";

export type StorageFilter = "all" | "sized" | "missing" | "stale" | "hasMods" | "massive" | "large" | "small";
export type StorageViewMode = "list" | "grid" | "cleanup" | "emulators";

interface Props {
  // Counts
  allCount: number;
  sizedCount: number;
  missingCount: number;
  staleCount: number;
  hasModsCount: number;
  massiveCount: number;
  largeCount: number;
  smallCount: number;
  filteredCount: number;

  // State & Handlers
  activeFilter: StorageFilter;
  onFilterChange: (filter: StorageFilter) => void;
  activeDrive: string | null;
  onClearDriveFilter: () => void;

  search: string;
  onSearchChange: (query: string) => void;

  sort: SortKey;
  onSortChange: (sort: SortKey) => void;

  groupBy: GroupKey;
  onGroupByChange: (group: GroupKey) => void;

  viewMode: StorageViewMode;
  onViewModeChange: (mode: StorageViewMode) => void;

  // Actions
  unsizedGames: Game[];
  onRecalcComplete: () => void;
  isRefreshingPaths: boolean;
  onRefreshPaths: () => void;

  selectMode: boolean;
  onToggleSelectMode: () => void;

  onExportCsv: () => void;
  onExportJson: () => void;
}

export function StorageControlsBar({
  allCount,
  sizedCount,
  missingCount,
  staleCount,
  hasModsCount,
  massiveCount,
  largeCount,
  smallCount,
  filteredCount,
  activeFilter,
  onFilterChange,
  activeDrive,
  onClearDriveFilter,
  search,
  onSearchChange,
  sort,
  onSortChange,
  groupBy,
  onGroupByChange,
  viewMode,
  onViewModeChange,
  unsizedGames,
  onRecalcComplete,
  isRefreshingPaths,
  onRefreshPaths,
  selectMode,
  onToggleSelectMode,
  onExportCsv,
  onExportJson,
}: Props) {
  const { t } = useLanguage();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Keyboard shortcut '/' to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close export menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    if (exportMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportMenuOpen]);

  const filterChips: { key: StorageFilter; label: string; count: number }[] = [
    { key: "all", label: t("storage.all"), count: allCount },
    { key: "sized", label: t("storage.sized"), count: sizedCount },
    { key: "missing", label: t("storage.missing"), count: missingCount },
    { key: "stale", label: t("storage.stale"), count: staleCount },
    { key: "hasMods", label: t("storage.filter.hasMods"), count: hasModsCount },
    { key: "massive", label: t("storage.filter.massive"), count: massiveCount },
    { key: "large", label: t("storage.filter.large"), count: largeCount },
    { key: "small", label: t("storage.filter.small"), count: smallCount },
  ];

  return (
    <div className="storage-controls-panel">
      {/* ── Top Row: View Modes + Filter Chips + Active Drive + Result Count ── */}
      <div className="storage-controls-row storage-controls-row--filters">
        {/* View Mode Switcher Tabs */}
        <div className="storage-views-segment" role="tablist" aria-label={t("storage.viewsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "list"}
            className={`storage-view-btn ${viewMode === "list" ? "storage-view-btn--active" : ""}`}
            onClick={() => onViewModeChange("list")}
            title={t("storage.view.list")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span>{t("storage.view.list")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "grid"}
            className={`storage-view-btn ${viewMode === "grid" ? "storage-view-btn--active" : ""}`}
            onClick={() => onViewModeChange("grid")}
            title={t("storage.view.grid")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>{t("storage.view.grid")}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "cleanup"}
            className={`storage-view-btn ${viewMode === "cleanup" ? "storage-view-btn--active" : ""}`}
            onClick={() => onViewModeChange("cleanup")}
            title={t("storage.view.cleanup")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span>{t("storage.view.cleanup")}</span>
            {staleCount > 0 && (
              <span className="storage-view-badge storage-view-badge--danger">{staleCount}</span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "emulators"}
            className={`storage-view-btn ${viewMode === "emulators" ? "storage-view-btn--active" : ""}`}
            onClick={() => onViewModeChange("emulators")}
            title={t("storage.view.emulators")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="6" y1="12" x2="10" y2="12" />
              <line x1="8" y1="10" x2="8" y2="14" />
              <circle cx="15" cy="13" r="1" />
              <circle cx="18" cy="11" r="1" />
            </svg>
            <span>{t("storage.view.emulators")}</span>
          </button>
        </div>

        {/* Filter Chips (Visible in list & grid view) */}
        {(viewMode === "list" || viewMode === "grid") && (
          <div className="storage-filter-chips-scroll" role="group" aria-label={t("storage.filterByStatus")}>
            {filterChips.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                className={`storage-filter-chip ${activeFilter === key ? "storage-filter-chip--active" : ""}`}
                aria-pressed={activeFilter === key}
                onClick={() => onFilterChange(key)}
              >
                <span>{label}</span>
                <span className="storage-filter-chip-count">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Active Drive Filter Chip */}
        {activeDrive && (viewMode === "list" || viewMode === "grid") && (
          <button
            type="button"
            className="storage-drive-active-chip"
            onClick={onClearDriveFilter}
            title={t("storage.clearDriveFilter", { drive: activeDrive })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
            <span>{activeDrive}</span>
            <span className="storage-drive-active-clear" aria-hidden="true">×</span>
          </button>
        )}

        {/* Result counter */}
        {(viewMode === "list" || viewMode === "grid") && (
          <span className="storage-filtered-counter">
            {t("storage.gamesCount", { count: filteredCount, plural: filteredCount === 1 ? "" : "s" })}
            {allCount !== filteredCount && ` ${t("storage.ofTotal", { total: allCount })}`}
          </span>
        )}
      </div>

      {/* ── Bottom Row: Search + Sort + Group + Density + Actions ── */}
      {(viewMode === "list" || viewMode === "grid") && (
        <div className="storage-controls-row storage-controls-row--tools">
          {/* Search bar */}
          <div className="storage-search-box">
            <svg className="storage-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="storage-search-input"
              type="text"
              placeholder={t("storage.searchPlaceholder")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={t("storage.searchAria")}
            />
            {search ? (
              <button
                type="button"
                className="storage-search-clear"
                onClick={() => onSearchChange("")}
                aria-label={t("storage.clearSearch")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : (
              <span className="storage-search-shortcut" aria-hidden="true">/</span>
            )}
          </div>

          {/* Sort Selector */}
          <div className="storage-tool-item">
            <span className="storage-tool-label">{t("storagePage.sortBy")}</span>
            <select
              className="storage-select-control"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
            >
              <option value="size:desc">{t("storagePage.sizeLargest")}</option>
              <option value="size:asc">{t("storagePage.sizeSmallest")}</option>
              <option value="name:asc">{t("storagePage.nameAZ")}</option>
              <option value="name:desc">{t("storagePage.nameZA")}</option>
              <option value="platform:asc">{t("storagePage.platform")}</option>
              <option value="detectedAt:desc">{t("storagePage.lastDetected")}</option>
              <option value="mods:desc">{t("storagePage.modsSize")}</option>
            </select>
          </div>

          {/* Group-by Segmented Control */}
          <div className="storage-tool-item">
            <span className="storage-tool-label">{t("storage.groupBy")}</span>
            <div className="storage-groupby-segment" role="group" aria-label={t("storage.groupBy")}>
              {(["none", "drive", "platform", "sizeTier"] as GroupKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`storage-groupby-btn ${groupBy === k ? "storage-groupby-btn--active" : ""}`}
                  aria-pressed={groupBy === k}
                  onClick={() => onGroupByChange(k)}
                >
                  {k === "sizeTier" ? t("storage.group.sizeTier") : t(`storage.group.${k}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons cluster */}
          <div className="storage-controls-actions">
            {/* Bulk Recalculate Missing */}
            <BulkRecalcBar unsizedGames={unsizedGames} onComplete={onRecalcComplete} />

            {/* Refresh / Re-check Paths */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshPaths}
              isLoading={isRefreshingPaths}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              }
              title={t("storage.recheckTitle")}
            >
              {t("common.refresh")}
            </Button>

            {/* Selection Mode Toggle */}
            <Button
              variant={selectMode ? "secondary" : "ghost"}
              size="sm"
              active={selectMode}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              }
              onClick={onToggleSelectMode}
              title={t("storage.batchMoveTitle")}
            >
              {t("storage.select")}
            </Button>

            {/* Export Report Menu */}
            <div className="storage-export-dropdown" ref={exportRef}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExportMenuOpen((v) => !v)}
                title={t("storage.batch.exportReport")}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                }
              >
                {t("storage.batch.exportReport")}
              </Button>

              {exportMenuOpen && (
                <div className="storage-export-popover">
                  <button
                    type="button"
                    className="storage-export-option"
                    onClick={() => {
                      onExportCsv();
                      setExportMenuOpen(false);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{t("storage.batch.exportCsv")}</span>
                  </button>
                  <button
                    type="button"
                    className="storage-export-option"
                    onClick={() => {
                      onExportJson();
                      setExportMenuOpen(false);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    <span>{t("storage.batch.exportJson")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
