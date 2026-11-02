import { useMemo } from "react";
import {
  ArrowUp,
  Gamepad2,
  HardDrive,
  Heart,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldQuestionMark,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { MiniTile, SchematicSearchBar } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./EmulatorsPagePreview.css";

export interface EmulatorsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const SYSTEMS = [
  { name: "PCSX2", platform: "PlayStation 2", roms: 48, ready: true, active: true },
  { name: "DuckStation", platform: "PlayStation", roms: 36, ready: true, active: false },
  { name: "Dolphin", platform: "GameCube / Wii", roms: 64, ready: true, active: false },
  { name: "RetroArch", platform: "Multi-system", roms: 142, ready: true, active: false },
  { name: "RPCS3", platform: "PlayStation 3", roms: 18, ready: true, active: false },
  { name: "Cemu", platform: "Wii U", roms: 0, ready: false, active: false },
];

const ROMS = [
  { name: "Final Fantasy X", size: "4.2 GB", played: "24h" },
  { name: "Shadow of the Colossus", size: "2.8 GB", played: "6h" },
  { name: "God of War II", size: "6.1 GB", played: "18h" },
  { name: "Gran Turismo 4", size: "5.4 GB", played: "41h" },
  { name: "Metal Gear Solid 2", size: "3.6 GB", played: "9h" },
  { name: "Okami", size: "2.1 GB", played: "12h" },
];

export function EmulatorsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: EmulatorsPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--emulators"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header: eyebrow + title + description, Add / Scan All / More */}
      <div className="studio-page-full">
        {renderCard(
          "emuHeader",
          "slot",
          <div className="studio-emu-pagehead">
            <div className="studio-emu-pagehead-text">
              <span className="studio-emu-eyebrow">{t("emulators.eyebrow")}</span>
              <span className="studio-emu-title">{t("emulators.title")}</span>
              <span className="studio-emu-desc">{t("emulators.subtitle")}</span>
            </div>
            <div className="studio-emu-header-actions">
              <span className="studio-emu-btn studio-emu-btn--primary">
                <Plus size={9} />
                <span>{t("emulators.addEmulator")}</span>
              </span>
              <span className="studio-emu-btn">
                <RefreshCw size={9} />
                <span>{t("emulators.scanAll")}</span>
              </span>
              <span className="studio-emu-icon-btn" title={t("emulators.actions.more")}>
                <MoreHorizontal size={10} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Stat band: systems / ROMs / size / firmware */}
      <div className="studio-page-full">
        {renderCard(
          "emuStats",
          "slot",
          <div className="studio-emu-kpi-grid">
            <MiniTile
              label={t("emulators.kpi.systems")}
              value="8"
              icon={LayoutGrid}
              footer={
                <span className="studio-emu-kpi-detail">
                  {t("emulators.kpi.systemsDetail", { ready: "6" })}
                </span>
              }
            />
            <MiniTile
              label={t("emulators.kpi.roms")}
              value="342"
              icon={Play}
              footer={
                <span className="studio-emu-kpi-detail">
                  {t("emulators.kpi.romsDetail", { count: "48" })}
                </span>
              }
            />
            <MiniTile
              label={t("emulators.kpi.size")}
              value="184 GB"
              icon={HardDrive}
              footer={
                <span className="studio-emu-kpi-detail">{t("emulators.kpi.sizeDetail")}</span>
              }
            />
            <MiniTile
              label={t("emulators.kpi.firmware")}
              value="5"
              icon={ShieldQuestionMark}
              footer={
                <span className="studio-emu-kpi-detail">
                  {t("emulators.kpi.firmwareDetail", { count: "8" })}
                </span>
              }
            />
          </div>,
        )}
      </div>

      {/* 3. Workbench: systems rail + selected system stage */}
      <div className="studio-emu-workbench">
        <aside className="studio-emu-rail-col">
          {renderCard(
            "emuSidebar",
            "card",
            <div className="studio-emu-rail">
              <div className="studio-emu-rail-head">
                <span className="studio-emu-rail-title">
                  {t("emulators.list.title")}
                  <span className="studio-emu-rail-count">8</span>
                </span>
                <span className="studio-emu-icon-btn" title={t("emulators.addEmulator")}>
                  <Plus size={11} />
                </span>
              </div>

              <SchematicSearchBar placeholder={t("emulators.list.search")} />

              <div className="studio-emu-rail-filters">
                <span className="studio-emu-rail-filter is-active">{t("emulators.filter.all")}</span>
                <span className="studio-emu-rail-filter">{t("emulators.status.configured")}</span>
                <span className="studio-emu-rail-filter">
                  {t("emulators.status.notConfigured")}
                </span>
              </div>

              <div className="studio-emu-rail-list">
                {SYSTEMS.map((system) => (
                  <div
                    key={system.name}
                    className={`studio-emu-rail-row${system.active ? " is-active" : ""}`}
                  >
                    <span className="studio-emu-rail-art" aria-hidden="true">
                      <Gamepad2 size={11} />
                    </span>
                    <span className="studio-emu-item-meta">
                      <span className="studio-emu-item-name">{system.name}</span>
                      <span className="studio-emu-item-platform">
                        {system.platform}
                        {system.roms > 0 ? ` · ${system.roms}` : ""}
                      </span>
                    </span>
                    <span
                      className={`studio-emu-status-dot${system.ready ? " is-configured" : ""}`}
                    />
                    <span className="studio-emu-rail-edit" aria-hidden="true">
                      <Pencil size={9} />
                    </span>
                  </div>
                ))}
              </div>

              <span className="studio-emu-btn studio-emu-btn--block">
                <Plus size={9} />
                <span>{t("emulators.addEmulator")}</span>
              </span>
            </div>,
          )}
        </aside>

        <div className="studio-emu-stage-col">
          {renderCard(
            "emuDetail",
            "slot",
            <div className="studio-emu-stage">
              {/* Selected system header */}
              <div className="studio-emu-sys-head">
                <div className="studio-emu-sys-identity">
                  <span className="studio-emu-sys-art" aria-hidden="true">
                    <Gamepad2 size={15} />
                  </span>
                  <div className="studio-emu-sys-meta">
                    <div className="studio-emu-sys-title-row">
                      <span className="studio-emu-sys-title">PCSX2</span>
                      <span className="studio-emu-status-pill is-ready">
                        <span className="studio-emu-status-dot is-configured" />
                        {t("emulators.status.configured")}
                      </span>
                    </div>
                    <div className="studio-emu-sys-sub">
                      <span>PlayStation 2</span>
                      <span className="studio-emu-dot" aria-hidden="true" />
                      <span>{t("emulators.romCount", { count: 48 })}</span>
                      <span className="studio-emu-dot" aria-hidden="true" />
                      <span>92.4 GB</span>
                      <span className="studio-emu-dot" aria-hidden="true" />
                      <span>{t("emulators.lastScannedShort", { when: "2d ago" })}</span>
                    </div>
                  </div>
                </div>
                <div className="studio-emu-sys-actions">
                  <span className="studio-emu-btn studio-emu-btn--primary">
                    <Play size={9} fill="currentColor" />
                    <span>{t("emulators.launchExe")}</span>
                  </span>
                  <span className="studio-emu-btn">
                    <RefreshCw size={9} />
                    <span>{t("emulators.scan")}</span>
                  </span>
                  <span className="studio-emu-btn">
                    <Pencil size={9} />
                    <span>{t("emulators.edit")}</span>
                  </span>
                  <span className="studio-emu-icon-btn" title={t("emulators.actions.more")}>
                    <MoreHorizontal size={10} />
                  </span>
                </div>
              </div>

              {/* Library / Firmware / Health */}
              <div className="studio-emu-tabs" role="tablist">
                <span className="studio-emu-tab is-active">
                  <LayoutGrid size={9} />
                  {t("emulators.tab.library")}
                  <span className="studio-emu-tab-count">48</span>
                </span>
                <span className="studio-emu-tab">
                  <ShieldQuestionMark size={9} />
                  {t("emulators.tab.firmware")}
                </span>
                <span className="studio-emu-tab">
                  <RefreshCw size={9} />
                  {t("emulators.tab.health")}
                </span>
              </div>

              <div className="studio-emu-library">
                <div className="studio-emu-browser">
                  <div className="studio-emu-browser-head">
                    <span className="studio-emu-browser-title">
                      {t("emulators.detail.gamesTitle")}
                      <span className="studio-emu-browser-count">48</span>
                      <span className="studio-emu-browser-size">92.4 GB</span>
                    </span>
                    <div className="studio-emu-browser-actions">
                      <span className="studio-emu-btn">
                        <Plus size={9} />
                        <span>{t("emulators.games.addRom")}</span>
                      </span>
                      <span className="studio-emu-icon-btn" title={t("emulators.actions.more")}>
                        <MoreHorizontal size={10} />
                      </span>
                    </div>
                  </div>

                  <div className="studio-emu-browser-controls">
                    <div className="studio-emu-browser-search">
                      <SchematicSearchBar placeholder={t("emulators.games.search")} />
                    </div>
                    <span className="studio-emu-chip">★ {t("emulators.roms.favorite")}</span>
                    <span className="studio-emu-select">
                      {t("emulators.roms.region")}: {t("common.all")}
                    </span>
                    <span className="studio-emu-select">
                      {t("emulators.roms.language")}: {t("common.all")}
                    </span>
                    <span className="studio-emu-sort">
                      <span className="studio-emu-select">{t("emulators.sort.name")}</span>
                      <span className="studio-emu-icon-btn" title={t("emulators.sort.ascending")}>
                        <ArrowUp size={9} />
                      </span>
                    </span>
                    <div className="studio-emu-view" role="group">
                      <span className="studio-emu-icon-btn is-active" title={t("emulators.games.gridView")}>
                        <LayoutGrid size={9} />
                      </span>
                      <span className="studio-emu-icon-btn" title={t("emulators.games.tableView")}>
                        <List size={9} />
                      </span>
                    </div>
                    <span className="studio-emu-chip is-active">
                      {t("emulators.roms.groupDiscs")}
                    </span>
                  </div>

                  <div className="studio-emu-rom-grid">
                    {ROMS.map((rom) => (
                      <div key={rom.name} className="studio-emu-rom-card">
                        <div className="studio-emu-rom-cover">
                          <Gamepad2 size={14} aria-hidden="true" />
                          <span className="studio-emu-rom-play">
                            <Play size={7} fill="currentColor" />
                          </span>
                        </div>
                        <span className="studio-emu-rom-name">{rom.name}</span>
                        <span className="studio-emu-rom-meta">
                          {rom.size} · {rom.played}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Persistent ROM inspector */}
                <aside className="studio-emu-inspector">
                  <div className="studio-emu-inspector-art" aria-hidden="true">
                    <Gamepad2 size={18} />
                    <span className="studio-emu-inspector-fav">
                      <Heart size={8} fill="currentColor" />
                    </span>
                  </div>
                  <span className="studio-emu-inspector-title">Final Fantasy X</span>
                  <div className="studio-emu-inspector-badges">
                    <span className="studio-emu-inspector-badge">PS2</span>
                    <span className="studio-emu-inspector-badge is-muted">NTSC-U</span>
                    <span className="studio-emu-inspector-badge is-muted">English</span>
                    <span className="studio-emu-inspector-badge is-accent">Disc 1</span>
                  </div>
                  <div className="studio-emu-inspector-actions">
                    <span className="studio-emu-btn studio-emu-btn--primary">
                      <Play size={8} fill="currentColor" />
                      <span>{t("emulators.games.launch")}</span>
                    </span>
                    <span className="studio-emu-icon-btn">
                      <Pencil size={9} />
                    </span>
                    <span className="studio-emu-icon-btn">
                      <Heart size={9} />
                    </span>
                  </div>
                  <dl className="studio-emu-inspector-facts">
                    {[
                      [t("emulators.games.size"), "4.2 GB"],
                      [t("game.playTime"), "24h"],
                      [t("game.lastPlayed"), "2d ago"],
                      [t("emulators.games.added"), "Jan 12"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <span className="studio-emu-inspector-path">
                    D:\Roms\PS2\Final Fantasy X.iso
                  </span>
                </aside>
              </div>
            </div>,
          )}
        </div>
      </div>
    </div>
  );
}
