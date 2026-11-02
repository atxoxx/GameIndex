import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Boxes,
  Check,
  CheckCircle2,
  ChevronLeft,
  Compass,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { SchematicSearchBar, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./ModsPagePreview.css";

export interface ModsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const RAIL_GAMES = [
  { name: "Cyberpunk 2077", initials: "CY", mods: "82/84 enabled", size: "7.4 GB", updates: 6, active: true },
  { name: "Skyrim Special Edition", initials: "SK", mods: "212/248 enabled", size: "34.1 GB", updates: 0, active: false },
  { name: "Baldur's Gate 3", initials: "BG", mods: "18/18 enabled", size: "3.2 GB", updates: 2, active: false },
  { name: "Fallout 4", initials: "FA", mods: "0/12 enabled", size: "1.6 GB", updates: 0, active: false },
];

const MOD_ROWS = [
  { order: 1, name: "Cyber Engine Tweaks", version: "v1.32.2", author: "yamashi", engine: "Direct", size: "2.1 MB", update: false, conflict: false, on: true },
  { order: 2, name: "RED4ext", version: "v1.25.0", author: "WopsS", engine: "Direct", size: "4.6 MB", update: true, conflict: false, on: true },
  { order: 3, name: "Native Settings UI", version: "v1.4.1", author: "psiberx", engine: "Direct", size: "1.2 MB", update: false, conflict: true, on: true },
  { order: 4, name: "ArchiveXL", version: "v1.19.3", author: "psiberx", engine: "Direct", size: "890 KB", update: true, conflict: false, on: true },
  { order: 5, name: "Legacy Textures Pack", version: "v2.0.0", author: "community", engine: "Direct", size: "812 MB", update: false, conflict: false, on: false },
];

export function ModsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: ModsPagePreviewProps) {
  const { t } = useLanguage();
  const widgetDrag = useOrderDrag(onReorderWidgets);

  const byId = useMemo(
    () => new Map(widgetItems.map((item, index) => [item.id, { item, index }])),
    [widgetItems],
  );

  const renderCard = (id: string, variant: "card" | "slot" = "card", children?: React.ReactNode) => {
    const entry = byId.get(id);
    if (!entry) return null;
    const { item, index } = entry;
    const isDragging = widgetDrag.dragIndex === index;
    const isDropTarget =
      widgetDrag.overIndex === index &&
      widgetDrag.dragIndex !== null &&
      widgetDrag.dragIndex !== index;
    const isLit = highlightedId === item.id;

    return (
      <StudioPageWidgetCard
        key={item.id}
        item={item}
        index={index}
        isDragging={isDragging}
        isDropTarget={isDropTarget}
        isLit={isLit}
        inspectMode={inspectMode}
        variant={variant}
        onStartDrag={(e) => {
          if (e.button !== 0 || inspectMode) return;
          widgetDrag.startDrag(index, { x: e.clientX, y: e.clientY });
        }}
        onToggle={() => onToggleWidget(item.id)}
        onInspect={onInspectElement}
      >
        {children}
      </StudioPageWidgetCard>
    );
  };

  return (
    <div
      className="studio-page-preview studio-page-preview--mods"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header: Discover Mods + mod sites settings */}
      <div className="studio-page-full">
        {renderCard(
          "modsHeader",
          "slot",
          <div className="studio-mods-pagehead">
            <div className="studio-mods-pagehead-text">
              <span className="studio-mods-eyebrow">{t("mods.eyebrow")}</span>
              <span className="studio-mods-title">{t("mods.title")}</span>
              <span className="studio-mods-desc">{t("mods.subtitle")}</span>
            </div>
            <div className="studio-mods-header-actions">
              <span className="studio-mods-btn">
                <Compass size={9} />
                <span>{t("mods.discover.title")}</span>
              </span>
              <span className="studio-mods-btn">
                <Settings2 size={9} />
                <span>{t("mods.openSettings")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Cockpit: modded-coverage lead figure + four metrics */}
      <div className="studio-page-full">
        {renderCard(
          "modsCockpit",
          "slot",
          <section className="studio-mods-cockpit" aria-label={t("mods.global.label")}>
            <div className="studio-mods-cockpit-lead">
              <span className="studio-mods-cockpit-lead-top">
                <Gamepad2 size={10} />
                {t("mods.global.moddedGames")}
              </span>
              <span className="studio-mods-cockpit-lead-value">
                12<span>/148</span>
              </span>
              <span className="studio-mods-cockpit-lead-detail">
                {t("mods.global.moddedDetail", { count: 148 })}
              </span>
              <Track value={8} height={3} />
              <span className="studio-mods-cockpit-summary">
                {t("mods.global.summary", { mods: 248, enabled: 218 })}
              </span>
            </div>

            <div className="studio-mods-cockpit-metrics">
              <div className="studio-mods-cockpit-metric">
                <span className="studio-mods-cockpit-label">
                  <Layers size={9} />
                  {t("mods.global.totalMods")}
                </span>
                <span className="studio-mods-cockpit-value">248</span>
                <span className="studio-mods-cockpit-detail">
                  {t("mods.global.totalModsDetail")}
                </span>
              </div>

              <div className="studio-mods-cockpit-metric">
                <span className="studio-mods-cockpit-label">
                  <CheckCircle2 size={9} />
                  {t("mods.global.activeRate")}
                </span>
                <span className="studio-mods-cockpit-value is-success">88%</span>
                <span className="studio-mods-cockpit-detail">
                  {t("mods.global.activeDetail", { enabled: 218, total: 248 })}
                </span>
                <Track value={88} height={3} />
              </div>

              <div className="studio-mods-cockpit-metric is-warning">
                <span className="studio-mods-cockpit-label">
                  <ArrowUpCircle size={9} />
                  {t("mods.global.pendingUpdates")}
                </span>
                <span className="studio-mods-cockpit-value">6</span>
                <span className="studio-mods-cockpit-detail">
                  {t("mods.global.pendingDetail")}
                </span>
              </div>

              <div className="studio-mods-cockpit-metric">
                <span className="studio-mods-cockpit-label">
                  <HardDrive size={9} />
                  {t("mods.global.totalStorage")}
                </span>
                <span className="studio-mods-cockpit-value">45.2 GB</span>
                <span className="studio-mods-cockpit-detail">
                  {t("mods.global.storageDetail")}
                </span>
              </div>
            </div>
          </section>,
        )}
      </div>

      {/* 3. Games rail + mod workspace */}
      <div className="studio-mods-page-split">
        <aside className="studio-mods-page-rail-col">
          {renderCard(
            "modsRail",
            "card",
            <div className="studio-mods-rail">
              <div className="studio-mods-rail-head">
                <span className="studio-mods-rail-title">
                  <Boxes size={10} />
                  {t("mods.gamesLibrary")}
                  <span className="studio-mods-rail-count">148</span>
                </span>
                <div className="studio-mods-rail-actions">
                  <span className="studio-mods-icon-btn" title={t("common.refresh")}>
                    <RefreshCw size={9} />
                  </span>
                  <span className="studio-mods-icon-btn" title={t("mods.rail.collapse")}>
                    <ChevronLeft size={10} />
                  </span>
                </div>
              </div>

              <SchematicSearchBar placeholder={t("mods.searchPlaceholder")} />

              <div className="studio-mods-rail-filters">
                <span className="studio-mods-rail-chip">
                  {t("mods.rail.all")}
                  <span className="studio-mods-rail-chip-count">148</span>
                </span>
                <span className="studio-mods-rail-chip is-active">
                  <Gamepad2 size={8} />
                  {t("mods.rail.modded")}
                  <span className="studio-mods-rail-chip-count">12</span>
                </span>
                <span className="studio-mods-rail-chip is-updates">
                  <ArrowUpCircle size={8} />
                  {t("mods.rail.updates")}
                  <span className="studio-mods-rail-chip-count">6</span>
                </span>
                <span className="studio-mods-icon-btn" title={t("mods.sortBy")}>
                  <Layers size={9} />
                </span>
              </div>

              <div className="studio-mods-rail-list">
                {RAIL_GAMES.map((game) => (
                  <div
                    key={game.name}
                    className={`studio-mods-rail-row${game.active ? " is-selected" : ""}`}
                  >
                    <span className="studio-mods-rail-cover" aria-hidden="true">
                      {game.initials}
                    </span>
                    <span className="studio-mods-rail-row-main">
                      <span className="studio-mods-rail-name">{game.name}</span>
                      <span className="studio-mods-rail-row-sub">
                        <span>{game.mods}</span>
                        <span className="studio-mods-rail-size">{game.size}</span>
                      </span>
                    </span>
                    {game.updates > 0 && (
                      <span
                        className="studio-mods-rail-updates"
                        title={t("mods.updatesAvailable", { count: String(game.updates) })}
                      >
                        <ArrowUpCircle size={8} />
                        {game.updates}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>,
          )}
        </aside>

        <div className="studio-mods-page-workspace-col">
          {renderCard(
            "modsWorkspace",
            "slot",
            <div className="studio-mods-ws">
              {/* Workspace header: identity + status + game page link */}
              <div className="studio-mods-ws-head">
                <div className="studio-mods-ws-identity">
                  <span className="studio-mods-ws-cover" aria-hidden="true">
                    CY
                  </span>
                  <div className="studio-mods-ws-meta">
                    <div className="studio-mods-ws-title-row">
                      <span className="studio-mods-ws-title">Cyberpunk 2077</span>
                      <span className="studio-mods-ws-platform">PC</span>
                    </div>
                    <div className="studio-mods-ws-status">
                      <span className="studio-mods-ws-stat">
                        {t("mods.enabledCount", { enabled: "82", total: "84" })}
                      </span>
                      <span className="studio-mods-ws-stat is-updates">
                        {t("mods.updatesAvailable", { count: "6" })}
                      </span>
                      <span className="studio-mods-ws-stat is-muted">7.4 GB</span>
                      <span className="studio-mods-ws-chip">3 {t("mods.presets")}</span>
                      <span className="studio-mods-ws-folder">
                        <FolderOpen size={8} />
                        <span className="studio-mods-ws-folder-text">D:\Mods\Cyberpunk 2077</span>
                      </span>
                    </div>
                  </div>
                </div>
                <span className="studio-mods-icon-btn" title={t("mods.viewGamePage")}>
                  <ExternalLink size={9} />
                </span>
              </div>

              {/* Workspace tabs */}
              <div className="studio-mods-ws-tabs" role="tablist">
                <span className="studio-mods-ws-tab is-active">
                  <Boxes size={9} />
                  {t("mods.tab.installedMods")}
                  <span className="studio-mods-ws-tab-count">84</span>
                </span>
                <span className="studio-mods-ws-tab">
                  <Compass size={9} />
                  {t("mods.discover.cta")}
                </span>
                <span className="studio-mods-ws-tab">
                  <ArrowUpCircle size={9} />
                  {t("mods.tab.updates")}
                  <span className="studio-mods-ws-tab-count">6</span>
                </span>
                <span className="studio-mods-ws-tab">
                  <AlertTriangle size={9} />
                  {t("mods.tab.conflicts")}
                  <span className="studio-mods-ws-tab-count">2</span>
                </span>
                <span className="studio-mods-ws-tab">
                  <Layers size={9} />
                  {t("mods.tab.profiles")}
                  <span className="studio-mods-ws-tab-count">3</span>
                </span>
                <span className="studio-mods-ws-tab">
                  <Wrench size={9} />
                  {t("mods.tab.mo2")}
                </span>
              </div>

              {/* Installed tab: command bar */}
              <div className="studio-mods-cmdbar">
                <div className="studio-mods-cmdbar-filters">
                  <span className="studio-mods-cmdbar-filter is-active">
                    {t("mods.filter.all")}
                    <span className="studio-mods-cmdbar-filter-count">84</span>
                  </span>
                  <span className="studio-mods-cmdbar-filter">
                    <CheckCircle2 size={8} />
                    {t("mods.filter.enabled")}
                    <span className="studio-mods-cmdbar-filter-count">82</span>
                  </span>
                  <span className="studio-mods-cmdbar-filter">
                    {t("mods.filter.disabled")}
                    <span className="studio-mods-cmdbar-filter-count">2</span>
                  </span>
                  <span className="studio-mods-cmdbar-filter is-updates">
                    <ArrowUpCircle size={8} />
                    {t("mods.filter.updates")}
                    <span className="studio-mods-cmdbar-filter-count">6</span>
                  </span>
                  <span className="studio-mods-cmdbar-filter is-conflicts">
                    {t("mods.filter.conflicts")}
                    <span className="studio-mods-cmdbar-filter-count">2</span>
                  </span>
                </div>

                <div className="studio-mods-cmdbar-search">
                  <SchematicSearchBar placeholder={t("mods.searchPlaceholder")} />
                </div>

                <span className="studio-mods-btn">
                  <SlidersHorizontal size={9} />
                  <span>{t("mods.filters")}</span>
                </span>

                <div className="studio-mods-cmdbar-actions">
                  <span className="studio-mods-btn studio-mods-btn--primary">
                    <RefreshCw size={9} />
                    <span>{t("mods.rescan")}</span>
                  </span>
                  <span className="studio-mods-btn">
                    <Plus size={9} />
                    <span>{t("mods.installMod")}</span>
                  </span>
                  <span className="studio-mods-icon-btn" title={t("mods.moreActions")}>
                    <MoreHorizontal size={10} />
                  </span>
                </div>
              </div>

              {/* Installed tab: load-order list + mod detail */}
              <div className="studio-mods-manager">
                <div className="studio-mods-list-pane">
                  <div className="studio-mods-list-head">
                    <span className="studio-mods-list-title">
                      <span className="studio-mods-checkbox" aria-hidden="true">
                        <Check size={7} />
                      </span>
                      {t("mods.loadOrder")}
                    </span>
                    <span className="studio-mods-list-hint">{t("mods.loadOrderHint")}</span>
                  </div>

                  <div className="studio-mods-list">
                    {MOD_ROWS.map((mod) => (
                      <div
                        key={mod.name}
                        className={`studio-mods-row${mod.on ? "" : " is-disabled"}${
                          mod.order === 1 ? " is-selected" : ""
                        }`}
                      >
                        <span className="studio-mods-row-check" aria-hidden="true" />
                        <span className="studio-mods-order">#{mod.order}</span>
                        <span className={`studio-mods-toggle${mod.on ? " is-on" : ""}`} aria-hidden="true">
                          <span />
                        </span>
                        <span className="studio-mods-row-main">
                          <span className="studio-mods-row-name">{mod.name}</span>
                          <span className="studio-mods-row-sub">
                            <span>{mod.version}</span>
                            <span>{mod.author}</span>
                          </span>
                        </span>
                        <span className="studio-mods-row-badges">
                          {mod.update && <span className="studio-mods-badge is-update">↑</span>}
                          {mod.conflict && <span className="studio-mods-badge is-conflict">⚠</span>}
                          <span className="studio-mods-engine-chip">{mod.engine}</span>
                          <span className="studio-mods-row-size">{mod.size}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="studio-mods-resizer" aria-hidden="true">
                  <i /><i /><i />
                </div>

                <div className="studio-mods-detail">
                  <div className="studio-mods-detail-head">
                    <span className="studio-mods-detail-title">Cyber Engine Tweaks</span>
                    <span className="studio-mods-state-pill is-on">
                      <span className="studio-mods-state-dot" />
                      {t("mods.enabled")}
                    </span>
                  </div>
                  <div className="studio-mods-detail-actions">
                    <span className="studio-mods-btn">{t("mods.disable")}</span>
                    <span className="studio-mods-btn">
                      <FolderOpen size={8} />
                      <span>{t("mods.openLocation")}</span>
                    </span>
                    <span className="studio-mods-btn is-danger">
                      <Trash2 size={8} />
                      <span>{t("mods.delete")}</span>
                    </span>
                  </div>
                  <dl className="studio-mods-detail-facts">
                    {[
                      [t("mods.version"), "1.32.2"],
                      [t("mods.latestVersion"), "1.32.2"],
                      [t("mods.author"), "yamashi"],
                      [t("mods.engine"), "Direct"],
                      [t("mods.kind"), "folder"],
                      [t("mods.order"), "#1"],
                      [t("mods.size"), "2.1 MB"],
                      [t("mods.files"), "12"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="studio-mods-detail-path">
                    <span className="studio-mods-detail-section-title">{t("mods.path")}</span>
                    <span className="studio-mods-detail-path-value">
                      …\mods\Cyber Engine Tweaks
                    </span>
                  </div>
                  <div className="studio-mods-detail-section">
                    <span className="studio-mods-detail-section-title">{t("mods.notes")}</span>
                    <span className="studio-mods-detail-note">{t("mods.notesPlaceholder")}</span>
                  </div>
                </div>
              </div>
            </div>,
          )}
        </div>
      </div>
    </div>
  );
}
