import { useMemo } from "react";
import {
  Boxes,
  Check,
  CheckCircle2,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicSearchBar,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface ModsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

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
      {/* 1. Mods Header */}
      <div className="studio-page-full">
        {renderCard(
          "modsHeader",
          "slot",
          <div className="studio-mods-header-mock">
            <div className="studio-mods-header-left">
              <Boxes size={13} className="studio-mods-header-icon" />
              <div className="studio-mods-header-text">
                <Line w={45} h={12} />
                <span className="studio-mods-header-badge">
                  12 modded games · Mod Organizer 2 & Vortex profiles
                </span>
              </div>
            </div>
            <div className="studio-mods-header-actions">
              <span className="studio-mods-btn">
                <RefreshCw size={9} />
                <span>Refresh Instances</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Global Cockpit Statistics Banner */}
      <div className="studio-page-full">
        {renderCard(
          "modsCockpit",
          "slot",
          <div className="studio-mods-kpi-grid">
            <MiniTile label="Modded Games" value="12 / 148" icon={Boxes} />
            <MiniTile label="Total Mods" value="248" icon={Layers} />
            <MiniTile label="Active Rate" value="88% (218 active)" icon={CheckCircle2} />
            <MiniTile label="Storage" value="45.2 GB" icon={HardDrive} />
          </div>,
        )}
      </div>

      {/* 3. Split Layout: Games Rail + Manager Workspace */}
      <div className="studio-mods-split">
        {/* Left Games Rail */}
        <aside className="studio-mods-rail-col">
          {renderCard(
            "modsRail",
            "card",
            <div className="studio-mods-rail-body">
              <div className="studio-mods-rail-head">
                <SchematicSearchBar placeholder="Filter games..." />
                <div className="studio-mods-rail-filter-row">
                  <span className="studio-mods-rail-pill is-active">Modded (12)</span>
                  <span className="studio-mods-rail-pill">All</span>
                </div>
              </div>
              <div className="studio-mods-rail-list">
                {[
                  { name: 60, mods: "84 mods (82 active)", pct: 98, engine: "MO2", active: true },
                  { name: 45, mods: "42 mods (36 active)", pct: 85, engine: "Vortex", active: false },
                  { name: 50, mods: "28 mods (28 active)", pct: 100, engine: "MO2", active: false },
                  { name: 40, mods: "14 mods (10 active)", pct: 71, engine: "Direct", active: false },
                ].map((g, i) => (
                  <div
                    key={i}
                    className={`studio-mods-rail-item${g.active ? " is-active" : ""}`}
                  >
                    <div className="studio-mods-item-thumb" />
                    <div className="studio-mods-item-meta">
                      <div className="studio-mods-item-top">
                        <Line w={g.name} h={10} />
                        <span className="studio-mods-engine-tag">{g.engine}</span>
                      </div>
                      <span className="studio-mods-item-sub">{g.mods}</span>
                      <Track value={g.pct} height={3} />
                    </div>
                  </div>
                ))}
              </div>
            </div>,
          )}
        </aside>

        {/* Right Manager Workspace */}
        <div className="studio-mods-workspace-col">
          {renderCard(
            "modsWorkspace",
            "slot",
            <div className="studio-mods-workspace-body">
              {/* Active Profile & Controls Bar */}
              <div className="studio-mods-game-bar">
                <div className="studio-mods-game-info">
                  <span className="studio-mods-game-title">Cyberpunk 2077</span>
                  <span className="studio-mods-game-engine">Engine: Mod Organizer 2</span>
                </div>
                <div className="studio-mods-game-actions">
                  <span className="studio-mods-action-pill">
                    <SlidersHorizontal size={9} />
                    <span>Profile: Default (84 mods)</span>
                  </span>
                  <span className="studio-mods-action-btn studio-mods-action-btn--primary">
                    <Play size={9} fill="currentColor" />
                    <span>Deploy & Launch</span>
                  </span>
                </div>
              </div>

              {/* Mod Items Table */}
              <div className="studio-mods-table">
                <div className="studio-mods-table-header">
                  <span className="studio-mods-col-check">Active</span>
                  <span className="studio-mods-col-order">#</span>
                  <span className="studio-mods-col-name">Mod Name</span>
                  <span className="studio-mods-col-version">Version</span>
                  <span className="studio-mods-col-category">Category</span>
                </div>
                {[
                  { order: "01", name: 65, ver: "v2.12", cat: "Core Engine", on: true },
                  { order: "02", name: 50, ver: "v1.4.0", cat: "Textures", on: true },
                  { order: "03", name: 55, ver: "v3.0.1", cat: "Gameplay", on: true },
                  { order: "04", name: 40, ver: "v1.0.2", cat: "UI & HUD", on: false },
                  { order: "05", name: 45, ver: "v2.0", cat: "Audio", on: true },
                ].map((row, i) => (
                  <div key={i} className={`studio-mods-row${row.on ? "" : " is-disabled"}`}>
                    <span className="studio-mods-col-check">
                      <span className={`studio-mods-checkbox${row.on ? " is-checked" : ""}`}>
                        {row.on && <Check size={7} />}
                      </span>
                    </span>
                    <span className="studio-mods-col-order">{row.order}</span>
                    <div className="studio-mods-col-name">
                      <Line w={row.name} h={10} />
                    </div>
                    <span className="studio-mods-col-version">{row.ver}</span>
                    <span className="studio-mods-col-category">{row.cat}</span>
                  </div>
                ))}
              </div>
            </div>,
          )}
        </div>
      </div>
    </div>
  );
}
