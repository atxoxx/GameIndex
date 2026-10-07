// ModCommandBar — the single control strip for the installed-mods manager.
// Replaces the old two-row toolbar + hero stats bar: one segmented status
// filter, search, a Filters popover (sort + engine), the two primary actions,
// and one overflow menu for everything else.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { ENGINE_LABELS, type ModEngine, type ModFilterTab, type ModSortOption } from "../../types/mods";

interface ModCommandBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filterTab: ModFilterTab;
  onFilterTabChange: (tab: ModFilterTab) => void;
  modSort: ModSortOption;
  onSortChange: (sort: ModSortOption) => void;
  selectedEngine: string | null;
  onEngineChange: (engine: string | null) => void;
  availableEngines: string[];
  counts: {
    total: number;
    enabled: number;
    disabled: number;
    updates: number;
    conflicts: number;
  };
  canScan: boolean;
  scanning: boolean;
  checkingUpdates: boolean;
  onScan: () => void;
  onCancelScan: () => void;
  onInstallMod: () => void;
  onCheckUpdates: () => void;
  onOpenPresets: () => void;
  onOpenExport: () => void;
  onOpenFolder?: () => void;
  onPickFolder: () => void;
  hasModsRoot: boolean;
  customRootTitle?: string;
  nexusOpen: boolean;
  onToggleNexus: () => void;
  onUndo: () => void;
}

export default function ModCommandBar({
  search,
  onSearchChange,
  filterTab,
  onFilterTabChange,
  modSort,
  onSortChange,
  selectedEngine,
  onEngineChange,
  availableEngines,
  counts,
  canScan,
  scanning,
  checkingUpdates,
  onScan,
  onCancelScan,
  onInstallMod,
  onCheckUpdates,
  onOpenPresets,
  onOpenExport,
  onOpenFolder,
  onPickFolder,
  hasModsRoot,
  customRootTitle,
  nexusOpen,
  onToggleNexus,
  onUndo,
}: ModCommandBarProps) {
  const { t } = useLanguage();
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filtersRef.current?.contains(e.target as Node)) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const activeFilterCount =
    (selectedEngine ? 1 : 0) + (modSort !== "order" ? 1 : 0);

  const filterTabs: { id: ModFilterTab; label: string; count: number }[] = [
    { id: "all", label: t("mods.filter.all"), count: counts.total },
    { id: "enabled", label: t("mods.filter.enabled"), count: counts.enabled },
    { id: "disabled", label: t("mods.filter.disabled"), count: counts.disabled },
  ];
  if (counts.updates > 0) {
    filterTabs.push({ id: "updates", label: t("mods.filter.updates"), count: counts.updates });
  }
  if (counts.conflicts > 0) {
    filterTabs.push({
      id: "conflicts",
      label: t("mods.filter.conflicts"),
      count: counts.conflicts,
    });
  }

  const openMore = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
  };

  const moreItems: ContextMenuItem[] = useMemo(() => {
    const items: ContextMenuItem[] = [
      {
        id: "check-updates",
        label: checkingUpdates ? t("mods.checkingUpdates") : t("mods.checkUpdates"),
        icon: <ArrowUpCircle size={15} />,
        disabled: checkingUpdates,
        onSelect: () => {
          setMoreMenu(null);
          onCheckUpdates();
        },
      },
      {
        id: "undo",
        label: t("mods.undoLast"),
        icon: <Undo2 size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onUndo();
        },
      },
      { id: "sep-1", separator: true },
      {
        id: "presets",
        label: t("mods.presets"),
        icon: <Layers size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onOpenPresets();
        },
      },
      {
        id: "export",
        label: t("mods.export"),
        icon: <Download size={15} />,
        disabled: counts.total === 0,
        onSelect: () => {
          setMoreMenu(null);
          onOpenExport();
        },
      },
      { id: "sep-2", separator: true },
    ];
    if (hasModsRoot && onOpenFolder) {
      items.push({
        id: "open-folder",
        label: t("mods.openFolder"),
        icon: <FolderOpen size={15} />,
        onSelect: () => {
          setMoreMenu(null);
          onOpenFolder();
        },
      });
    }
    items.push({
      id: "set-folder",
      label: customRootTitle ?? t("mods.setFolder"),
      icon: <FolderOpen size={15} />,
      onSelect: () => {
        setMoreMenu(null);
        onPickFolder();
      },
    });
    items.push({
      id: "nexus",
      label: t("mods.nexus"),
      icon: <Settings2 size={15} />,
      active: nexusOpen,
      onSelect: () => {
        setMoreMenu(null);
        onToggleNexus();
      },
    });
    return items;
  }, [
    t,
    checkingUpdates,
    counts.total,
    hasModsRoot,
    customRootTitle,
    nexusOpen,
    onCheckUpdates,
    onUndo,
    onOpenPresets,
    onOpenExport,
    onOpenFolder,
    onPickFolder,
    onToggleNexus,
  ]);

  return (
    <div className="mods-cmdbar">
      <div className="mods-cmdbar__filters" role="tablist" aria-label={t("mods.filter.all")}>
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filterTab === tab.id}
            className={`mods-cmdbar__filter${
              filterTab === tab.id ? " is-active" : ""
            }${tab.id === "updates" ? " mods-cmdbar__filter--updates" : ""}${
              tab.id === "conflicts" ? " mods-cmdbar__filter--conflicts" : ""
            }`}
            onClick={() => onFilterTabChange(tab.id)}
          >
            {tab.id === "updates" && <ArrowUpCircle size={12} />}
            {tab.id === "enabled" && <CheckCircle2 size={12} />}
            {tab.label}
            <span className="mods-cmdbar__filter-count">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="mods-cmdbar__search">
        <Search size={15} className="mods-cmdbar__search-icon" />
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
            className="mods-cmdbar__search-clear"
            onClick={() => onSearchChange("")}
            title={t("common.clearSearch")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="mods-cmdbar__filters-wrap" ref={filtersRef}>
        <button
          type="button"
          className={`mods-cmdbar__filters-btn${filtersOpen ? " is-open" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          title={t("mods.sortBy")}
        >
          <SlidersHorizontal size={14} />
          <span>{t("mods.filters")}</span>
          {activeFilterCount > 0 && (
            <span className="mods-cmdbar__filters-count">{activeFilterCount}</span>
          )}
        </button>

        {filtersOpen && (
          <div className="mods-cmdbar__popover" role="dialog" aria-label={t("mods.filters")}>
            <label className="mods-cmdbar__field">
              <span>{t("mods.sortBy")}</span>
              <select
                className="mods-select"
                value={modSort}
                onChange={(e) => onSortChange(e.target.value as ModSortOption)}
              >
                <option value="order">{t("mods.sort.order")}</option>
                <option value="name">{t("mods.sort.name")}</option>
                <option value="size:desc">{t("mods.sort.sizeDesc")}</option>
                <option value="size:asc">{t("mods.sort.sizeAsc")}</option>
              </select>
            </label>

            {availableEngines.length > 1 && (
              <label className="mods-cmdbar__field">
                <span>{t("mods.engine")}</span>
                <select
                  className="mods-select"
                  value={selectedEngine ?? "all"}
                  onChange={(e) =>
                    onEngineChange(e.target.value === "all" ? null : e.target.value)
                  }
                >
                  <option value="all">{t("mods.engineFilter.all")}</option>
                  {availableEngines.map((eng) => (
                    <option key={eng} value={eng}>
                      {ENGINE_LABELS[eng as ModEngine] ?? eng}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      <div className="mods-cmdbar__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={scanning ? onCancelScan : onScan}
          isLoading={scanning}
          disabled={!canScan}
          title={!canScan ? t("mods.scanDisabledHint") : undefined}
          leftIcon={<RefreshCw size={14} />}
        >
          {scanning
            ? t("mods.cancelScan")
            : counts.total > 0
              ? t("mods.rescan")
              : t("mods.scan")}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onInstallMod}
          title={t("mods.installModHint")}
          leftIcon={<Plus size={14} />}
        >
          {t("mods.installMod")}
        </Button>

        <button
          ref={moreBtnRef}
          type="button"
          className="mods-cmdbar__more"
          onClick={openMore}
          title={t("mods.moreActions")}
          aria-label={t("mods.moreActions")}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={moreItems}
          onClose={() => setMoreMenu(null)}
          ariaLabel={t("mods.moreActions")}
        />
      )}
    </div>
  );
}
