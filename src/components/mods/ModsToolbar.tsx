import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { ENGINE_LABELS, type ModEngine } from "../../types/mods";
import type { FilterTab } from "./ModsHeroStats";

export type ModSortOption = "order" | "name" | "size:desc" | "size:asc";

interface ModsToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  filterTab: FilterTab;
  onFilterTabChange: (tab: FilterTab) => void;
  selectedEngine: string | null;
  onEngineChange: (engine: string | null) => void;
  availableEngines: string[];
  modSort: ModSortOption;
  onSortChange: (sort: ModSortOption) => void;
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  updateCount: number;
  conflictCount: number;
  canScan: boolean;
  scanning: boolean;
  checkingUpdates: boolean;
  onScan: () => void;
  onCancelScan: () => void;
  onCheckUpdates: () => void;
  onInstallMod: () => void;
  onOpenPresets: () => void;
  onOpenExport: () => void;
  onOpenFolder?: () => void;
  onPickFolder: () => void;
  hasModsRoot: boolean;
  customRootTitle?: string;
  nexusOpen: boolean;
  onToggleNexus: () => void;
}

export default function ModsToolbar({
  search,
  onSearchChange,
  filterTab,
  onFilterTabChange,
  selectedEngine,
  onEngineChange,
  availableEngines,
  modSort,
  onSortChange,
  totalCount,
  enabledCount,
  disabledCount,
  updateCount,
  conflictCount,
  canScan,
  scanning,
  checkingUpdates,
  onScan,
  onCancelScan,
  onCheckUpdates,
  onInstallMod,
  onOpenPresets,
  onOpenExport,
  onOpenFolder,
  onPickFolder,
  hasModsRoot,
  customRootTitle,
  nexusOpen,
  onToggleNexus,
}: ModsToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="mods-toolbar-container">
      {/* Upper row: Filter tabs, search, and sort */}
      <div className="mods-toolbar-row">
        {/* Quick Filter Status Tabs */}
        <div className="mods-quick-filters" role="tablist" aria-label={t("mods.filter.all")}>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "all"}
            className={`mods-filter-btn ${filterTab === "all" ? "active" : ""}`}
            onClick={() => onFilterTabChange("all")}
          >
            {t("mods.filter.all")}
            <span className="mods-filter-badge">{totalCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "enabled"}
            className={`mods-filter-btn ${filterTab === "enabled" ? "active" : ""}`}
            onClick={() => onFilterTabChange("enabled")}
          >
            {t("mods.filter.enabled")}
            <span className="mods-filter-badge">{enabledCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === "disabled"}
            className={`mods-filter-btn ${filterTab === "disabled" ? "active" : ""}`}
            onClick={() => onFilterTabChange("disabled")}
          >
            {t("mods.filter.disabled")}
            <span className="mods-filter-badge">{disabledCount}</span>
          </button>
          {updateCount > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={filterTab === "updates"}
              className={`mods-filter-btn mods-filter-btn--updates ${filterTab === "updates" ? "active" : ""}`}
              onClick={() => onFilterTabChange("updates")}
            >
              {t("mods.filter.updates")}
              <span className="mods-filter-badge">{updateCount}</span>
            </button>
          )}
          {conflictCount > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={filterTab === "conflicts"}
              className={`mods-filter-btn mods-filter-btn--conflicts ${filterTab === "conflicts" ? "active" : ""}`}
              onClick={() => onFilterTabChange("conflicts")}
            >
              {t("mods.filter.conflicts")}
              <span className="mods-filter-badge">{conflictCount}</span>
            </button>
          )}
        </div>

        {/* Search & Sort Controls */}
        <div className="mods-toolbar-group">
          <div className="mods-search-input-wrapper mods-search-input-wrapper--fixed">
            <svg className="mods-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t("mods.searchPlaceholder")}
              aria-label={t("mods.searchPlaceholder")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="mods-search-clear"
                onClick={() => onSearchChange("")}
                title={t("common.clearSearch")}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <select
            className="mods-sort-select"
            value={modSort}
            onChange={(e) => onSortChange(e.target.value as ModSortOption)}
            title={t("mods.sortBy")}
            aria-label={t("mods.sortBy")}
          >
            <option value="order">{t("mods.sort.order")}</option>
            <option value="name">{t("mods.sort.name")}</option>
            <option value="size:desc">{t("mods.sort.sizeDesc")}</option>
            <option value="size:asc">{t("mods.sort.sizeAsc")}</option>
          </select>
        </div>
      </div>

      {/* Engine chips row (when more than one engine or engine exists) */}
      {availableEngines.length > 0 && (
        <div className="mods-engines-filter-row">
          <button
            type="button"
            className={`mods-engine-filter-chip ${selectedEngine === null ? "active" : ""}`}
            onClick={() => onEngineChange(null)}
          >
            {t("mods.engineFilter.all")}
          </button>
          {availableEngines.map((eng) => {
            const label = ENGINE_LABELS[eng as ModEngine] ?? eng;
            const isSelected = selectedEngine === eng;
            return (
              <button
                key={eng}
                type="button"
                className={`mods-engine-filter-chip mods-engine-${eng} ${isSelected ? "active" : ""}`}
                onClick={() => onEngineChange(isSelected ? null : eng)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons row */}
      <div className="mods-toolbar-row mods-toolbar-row--actions">
        <div className="mods-toolbar-actions">
          {/* Scan button */}
          <span className="mods-scan-wrap" title={!canScan ? t("mods.scanDisabledHint") : undefined}>
            <Button
              variant="primary"
              size="sm"
              onClick={scanning ? onCancelScan : onScan}
              isLoading={scanning}
              disabled={!canScan}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              {scanning ? t("mods.cancelScan") : totalCount > 0 ? t("mods.rescan") : t("mods.scan")}
            </Button>
          </span>

          {/* Check Updates */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onCheckUpdates}
            isLoading={checkingUpdates}
            title={t("mods.checkUpdates")}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            }
          >
            {checkingUpdates ? t("mods.checkingUpdates") : t("mods.checkUpdates")}
          </Button>

          {/* Install Mod */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onInstallMod}
            title={t("mods.installModHint")}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            {t("mods.installMod")}
          </Button>

          {/* Presets / Profiles */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenPresets}
            title={t("mods.presets.subtitle")}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <line x1="7" y1="8" x2="17" y2="8" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="7" y1="16" x2="13" y2="16" />
              </svg>
            }
          >
            {t("mods.presets")}
          </Button>

          {/* Export List */}
          {totalCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenExport}
              title={t("mods.export.subtitle")}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              }
            >
              {t("mods.export")}
            </Button>
          )}

          {/* Open Folder */}
          {hasModsRoot && onOpenFolder && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenFolder}
              title={t("mods.openFolder")}
              leftIcon={
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              }
            >
              {t("mods.openFolder")}
            </Button>
          )}

          {/* Set Custom Folder */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onPickFolder}
            title={customRootTitle ?? t("mods.setFolder")}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            }
          >
            {t("mods.setFolder")}
          </Button>

          {/* Nexus Integration Drawer Toggle */}
          <Button
            variant="ghost"
            size="sm"
            active={nexusOpen}
            onClick={onToggleNexus}
            leftIcon={
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            }
          >
            {t("mods.nexus")}
          </Button>
        </div>
      </div>
    </div>
  );
}
