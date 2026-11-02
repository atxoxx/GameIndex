import { useMemo } from "react";
import {
  Archive,
  Clock,
  Database,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { MiniTile, SchematicSearchBar } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./SavesPagePreview.css";

export interface SavesPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const RAIL_GAMES = [
  {
    initials: "CY",
    name: "Cyberpunk 2077",
    meta: "3 locations · 2 days ago",
    state: "protected",
    verdict: "Protected",
    active: true,
  },
  {
    initials: "BG",
    name: "Baldur's Gate 3",
    meta: "2 locations · 5 days ago",
    state: "stale",
    verdict: "Snapshot stale",
    active: false,
  },
  {
    initials: "EL",
    name: "Elden Ring",
    meta: "1 location · never backed up",
    state: "never",
    verdict: "Never backed up",
    active: false,
  },
  {
    initials: "HO",
    name: "Hollow Knight",
    meta: "2 locations · path missing",
    state: "missing",
    verdict: "Path missing",
    active: false,
  },
];

const SNAPSHOTS = [
  { kind: "Manual", when: "2 days ago · 18:42", meta: "12 files · 420 MB", note: "Before boss fight" },
  { kind: "On exit", when: "4 days ago · 21:07", meta: "12 files · 418 MB" },
  { kind: "Pre-restore", when: "Last week · 09:15", meta: "11 files · 402 MB" },
];

export function SavesPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: SavesPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--saves"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header: Scan library + Back up all */}
      <div className="studio-page-full">
        {renderCard(
          "savesHeader",
          "slot",
          <div className="studio-saves-pagehead">
            <span className="studio-saves-pagehead-icon" aria-hidden="true">
              <Archive size={13} />
            </span>
            <div className="studio-saves-pagehead-text">
              <span className="studio-saves-eyebrow">{t("nav.saves")}</span>
              <span className="studio-saves-title">{t("saves.page.title")}</span>
              <span className="studio-saves-desc">{t("saves.page.desc")}</span>
            </div>
            <div className="studio-saves-header-actions">
              <span className="studio-saves-btn">
                <RefreshCw size={9} />
                <span>{t("saves.action.scanLibrary")}</span>
              </span>
              <span className="studio-saves-btn studio-saves-btn--primary">
                <Zap size={9} />
                <span>{t("saves.action.backupAll")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Summary hero: games / locations / backups / last backup */}
      <div className="studio-page-full">
        {renderCard(
          "savesHero",
          "slot",
          <div className="studio-saves-kpi-grid">
            <MiniTile
              label={t("saves.kpi.games")}
              value="42"
              icon={Gamepad2}
              footer={
                <span className="studio-saves-kpi-detail is-warning">
                  {t("saves.kpi.attentionCount", { count: 3 })}
                </span>
              }
            />
            <MiniTile
              label={t("saves.kpi.locations")}
              value="58"
              icon={FolderOpen}
              footer={
                <span className="studio-saves-kpi-detail is-danger">
                  {t("saves.kpi.missing", { count: 2 })}
                </span>
              }
            />
            <MiniTile
              label={t("saves.kpi.backups")}
              value="128"
              icon={Archive}
              footer={<span className="studio-saves-kpi-detail">1.8 GB</span>}
            />
            <MiniTile
              label={t("saves.kpi.lastBackup")}
              value="2h ago"
              icon={Clock}
              footer={
                <span className="studio-saves-kpi-detail is-warning">
                  {t("saves.kpi.missing", { count: 2 })}
                </span>
              }
            />
          </div>,
        )}
      </div>

      {/* 3. View tabs + backup folder */}
      <div className="studio-page-full">
        {renderCard(
          "savesControls",
          "slot",
          <div className="studio-saves-controls">
            <div className="studio-saves-tabs" role="tablist">
              <span className="studio-saves-tab is-active">
                <Gamepad2 size={9} />
                {t("saves.subtab.games")}
                <span className="studio-saves-tab-count">42</span>
              </span>
              <span className="studio-saves-tab">
                <Archive size={9} />
                {t("saves.subtab.snapshots")}
                <span className="studio-saves-tab-count">128</span>
              </span>
              <span className="studio-saves-tab">
                <Database size={9} />
                {t("saves.subtab.system")}
              </span>
              <span className="studio-saves-tab">
                <SlidersHorizontal size={9} />
                {t("saves.subtab.settings")}
              </span>
            </div>
            <span className="studio-saves-dir" title="D:\GameIndex\Saves">
              <HardDrive size={9} />
              <span>{t("saves.settings.backupDir")}</span>
            </span>
          </div>,
        )}
      </div>

      {/* 4. Games tab: roster rail + the selected game's save cockpit */}
      <div className="studio-page-full">
        {renderCard(
          "savesGrid",
          "slot",
          <div className="studio-saves-layout">
            <div className="studio-saves-rail">
              <SchematicSearchBar placeholder={t("saves.searchPlaceholder")} />

              <div className="studio-saves-rail-filters">
                <span className="studio-saves-chip is-active">
                  {t("saves.filter.all")}
                  <span className="studio-saves-chip-count">42</span>
                </span>
                <span className="studio-saves-chip">
                  {t("saves.filter.backedUp")}
                  <span className="studio-saves-chip-count">26</span>
                </span>
                <span className="studio-saves-chip">
                  {t("saves.filter.needsBackup")}
                  <span className="studio-saves-chip-count">13</span>
                </span>
                <span className="studio-saves-chip">
                  {t("saves.filter.attention")}
                  <span className="studio-saves-chip-count">3</span>
                </span>
              </div>

              <div className="studio-saves-rail-controls">
                <span className="studio-saves-rail-sort">
                  <span className="studio-saves-rail-sort-label">{t("saves.rail.sort")}</span>
                  <span className="studio-saves-select">{t("saves.sort.attention")}</span>
                </span>
              </div>

              <div className="studio-saves-rail-bulk">
                <span className="studio-saves-select-all">
                  <span className="studio-saves-checkbox" aria-hidden="true" />
                  <span>{t("saves.rail.showing", { count: 42 })}</span>
                </span>
              </div>

              <div className="studio-saves-rail-list" role="listbox">
                {RAIL_GAMES.map((game) => (
                  <div
                    key={game.name}
                    className={`studio-saves-game${game.active ? " is-active" : ""}`}
                  >
                    <span className="studio-saves-checkbox" aria-hidden="true" />
                    <span className="studio-saves-cover" aria-hidden="true">
                      {game.initials}
                    </span>
                    <span className="studio-saves-game-body">
                      <span className="studio-saves-game-name">{game.name}</span>
                      <span className="studio-saves-game-meta">{game.meta}</span>
                    </span>
                    <span className={`studio-saves-badge is-${game.state}`}>{game.verdict}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-saves-pane-wrap">
              <div className="studio-saves-pane">
                <div className="studio-saves-pane-head">
                  <span className="studio-saves-cover is-lg" aria-hidden="true">
                    CY
                  </span>
                  <div className="studio-saves-pane-identity">
                    <div className="studio-saves-pane-title-row">
                      <span className="studio-saves-pane-title">Cyberpunk 2077</span>
                      <span className="studio-saves-badge is-protected">{t("saves.state.protected")}</span>
                    </div>
                    <span className="studio-saves-pane-sub">
                      {t("saves.game.locations", { count: 3 })}
                      <span aria-hidden="true"> · </span>
                      {t("saves.game.lastBackup", { when: "2 days ago" })}
                    </span>
                  </div>
                  <div className="studio-saves-pane-actions">
                    <span className="studio-saves-btn">{t("saves.pane.openGame")}</span>
                    <span className="studio-saves-btn">
                      <RefreshCw size={9} />
                      <span>{t("saves.action.rescan")}</span>
                    </span>
                    <span className="studio-saves-btn">
                      <Plus size={9} />
                      <span>{t("saves.snapshot.takeWithNote")}</span>
                    </span>
                    <span className="studio-saves-btn studio-saves-btn--primary">
                      <Zap size={9} />
                      <span>{t("saves.action.backupNow")}</span>
                    </span>
                  </div>
                </div>

                <div className="studio-saves-pane-stats">
                  <MiniTile
                    label={t("saves.kpi.backups")}
                    value="8"
                    icon={Archive}
                    footer={<span className="studio-saves-kpi-detail">1.2 GB</span>}
                  />
                  <MiniTile
                    label={t("saves.kpi.locations")}
                    value="3"
                    icon={FolderOpen}
                    footer={
                      <span className="studio-saves-kpi-detail">
                        {t("saves.pane.locationsDetail", { total: 4 })}
                      </span>
                    }
                  />
                  <MiniTile
                    label={t("saves.kpi.lastBackup")}
                    value="2 days ago"
                    icon={Clock}
                  />
                </div>

                <section className="studio-saves-section">
                  <header className="studio-saves-section-head">
                    <span className="studio-saves-section-title">
                      {t("saves.locations.title")}
                      <span className="studio-saves-section-count">3</span>
                    </span>
                    <span className="studio-saves-btn">
                      <Plus size={9} />
                      <span>{t("saves.action.addLocation")}</span>
                    </span>
                  </header>

                  <div className="studio-saves-locations">
                    {[
                      {
                        label: "Steam userdata",
                        source: t("saves.source.steam"),
                        kind: t("saves.locations.kindFolder"),
                        path: "C:\\Program Files (x86)\\Steam\\userdata\\…\\1091500",
                      },
                      {
                        label: "Documents / CD Projekt Red",
                        source: t("saves.source.curated"),
                        kind: t("saves.locations.kindFolder"),
                        path: "%USERPROFILE%\\Documents\\CD Projekt Red\\Cyberpunk 2077",
                      },
                      {
                        label: "Screenshots",
                        source: t("saves.source.manual"),
                        kind: t("saves.locations.kindFile"),
                        path: "%USERPROFILE%\\Pictures\\Cyberpunk 2077\\screen.png",
                      },
                    ].map((location) => (
                      <div key={location.label} className="studio-saves-location">
                        <span className="studio-saves-checkbox is-checked" aria-hidden="true" />
                        <div className="studio-saves-location-body">
                          <div className="studio-saves-location-top">
                            <span className="studio-saves-location-label">{location.label}</span>
                            <span className="studio-saves-badge is-source">{location.source}</span>
                            <span className="studio-saves-location-kind">{location.kind}</span>
                          </div>
                          <span className="studio-saves-location-path">{location.path}</span>
                        </div>
                        <span className="studio-saves-icon-btn" title={t("saves.action.openFolder")}>
                          <FolderOpen size={9} />
                        </span>
                        <span
                          className="studio-saves-icon-btn is-danger"
                          title={t("saves.action.removeLocation")}
                        >
                          <Trash2 size={9} />
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="studio-saves-section">
                  <header className="studio-saves-section-head">
                    <span className="studio-saves-section-title">
                      {t("saves.pane.recentSnapshots")}
                      <span className="studio-saves-section-count">8</span>
                    </span>
                    <div className="studio-saves-section-actions">
                      <span className="studio-saves-btn is-danger">
                        <Trash2 size={9} />
                        <span>{t("saves.snapshots.deleteAllForGame")}</span>
                      </span>
                      <span className="studio-saves-btn">{t("saves.pane.viewAll")}</span>
                    </div>
                  </header>

                  <div className="studio-saves-snaps">
                    {SNAPSHOTS.map((snapshot) => (
                      <div key={snapshot.when} className="studio-saves-snap">
                        <div className="studio-saves-snap-main">
                          <span className="studio-saves-snap-top">
                            <span className="studio-saves-badge is-kind">{snapshot.kind}</span>
                          </span>
                          <span className="studio-saves-snap-meta">
                            <span>{snapshot.when}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{snapshot.meta}</span>
                          </span>
                          {snapshot.note && (
                            <span className="studio-saves-snap-note">“{snapshot.note}”</span>
                          )}
                        </div>
                        <div className="studio-saves-snap-actions">
                          <span className="studio-saves-btn">{t("saves.action.restore")}</span>
                          <span className="studio-saves-icon-btn" title={t("saves.action.openBackup")}>
                            <FolderOpen size={9} />
                          </span>
                          <span
                            className="studio-saves-icon-btn is-danger"
                            title={t("saves.action.deleteBackup")}
                          >
                            <Trash2 size={9} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
