import { useMemo } from "react";
import {
  Compass,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface EmulatorsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

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
          widgetDrag.startDrag(index);
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
      {/* 1. Emulators Header */}
      <div className="studio-page-full">
        {renderCard(
          "emuHeader",
          "slot",
          <div className="studio-emu-header-mock">
            <div className="studio-emu-header-left">
              <Gamepad2 size={13} className="studio-emu-header-icon" />
              <div className="studio-emu-header-text">
                <Line w={45} h={12} />
                <span className="studio-emu-header-badge">
                  8 systems · 6 configured · 342 ROMs
                </span>
              </div>
            </div>
            <div className="studio-emu-header-actions">
              <span className="studio-emu-btn studio-emu-btn--primary">
                <Plus size={9} />
                <span>Add Emulator</span>
              </span>
              <span className="studio-emu-btn">
                <Compass size={9} />
                <span>Discover</span>
              </span>
              <span className="studio-emu-btn">
                <RefreshCw size={9} />
                <span>Scan All</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Emulators KPI Strip */}
      <div className="studio-page-full">
        {renderCard(
          "emuStats",
          "slot",
          <div className="studio-emu-kpi-grid">
            <MiniTile label="Total Systems" value="8" icon={Gamepad2} />
            <MiniTile label="Configured" value="6" icon={Play} />
            <MiniTile label="ROM Games" value="342" icon={FolderOpen} />
            <MiniTile label="Total Storage" value="184 GB" icon={HardDrive} />
          </div>,
        )}
      </div>

      {/* 3. Two-Column Split Layout: Sidebar + Detail Showcase */}
      <div className="studio-emu-split">
        {/* Left Sidebar List */}
        <aside className="studio-emu-sidebar-col">
          {renderCard(
            "emuSidebar",
            "card",
            <div className="studio-emu-sidebar-body">
              <SchematicSearchBar placeholder="Filter systems..." />
              <div className="studio-emu-sidebar-list">
                {[
                  { name: "PCSX2", platform: "PS2", roms: 48, configured: true, active: true },
                  { name: "RPCS3", platform: "PS3", roms: 18, configured: true, active: false },
                  { name: "Dolphin", platform: "GameCube / Wii", roms: 64, configured: true, active: false },
                  { name: "RetroArch", platform: "Multi-system", roms: 142, configured: true, active: false },
                  { name: "DuckStation", platform: "PS1", roms: 36, configured: true, active: false },
                  { name: "Cemu", platform: "Wii U", roms: 12, configured: false, active: false },
                ].map((emu, i) => (
                  <div
                    key={i}
                    className={`studio-emu-sidebar-item${emu.active ? " is-active" : ""}`}
                  >
                    <span
                      className={`studio-emu-status-dot${emu.configured ? " is-configured" : ""}`}
                    />
                    <div className="studio-emu-item-meta">
                      <span className="studio-emu-item-name">{emu.name}</span>
                      <span className="studio-emu-item-platform">{emu.platform}</span>
                    </div>
                    <span className="studio-emu-item-count">{emu.roms}</span>
                  </div>
                ))}
              </div>
            </div>,
          )}
        </aside>

        {/* Right Detail Pane */}
        <div className="studio-emu-detail-col">
          {renderCard(
            "emuDetail",
            "slot",
            <div className="studio-emu-detail-body">
              {/* Selected Emulator Showcase Hero */}
              <div className="studio-emu-showcase-hero">
                <div className="studio-emu-hero-info">
                  <div className="studio-emu-hero-badge">PlayStation 2 · PCSX2 v2.0</div>
                  <span className="studio-emu-hero-title">PCSX2 Core Launcher</span>
                  <div className="studio-emu-path-rows">
                    <span className="studio-emu-path">
                      <b>EXE:</b> C:\Emulators\PCSX2\pcsx2-qtx64.exe
                    </span>
                    <span className="studio-emu-path">
                      <b>ROMs:</b> D:\Roms\PS2 (48 games discovered)
                    </span>
                  </div>
                </div>
                <div className="studio-emu-hero-actions">
                  <span className="studio-emu-action-btn studio-emu-action-btn--primary">
                    <Play size={9} fill="currentColor" />
                    <span>Launch</span>
                  </span>
                  <span className="studio-emu-action-btn">
                    <RefreshCw size={9} />
                    <span>Scan ROMs</span>
                  </span>
                </div>
              </div>

              {/* Discovered ROMs Sample List */}
              <div className="studio-emu-roms-table">
                <div className="studio-emu-table-head">
                  <span>Discovered ROMs (48)</span>
                  <Line w={25} />
                </div>
                {[
                  { name: 60, size: "4.2 GB", lastPlayed: "Yesterday" },
                  { name: 45, size: "2.8 GB", lastPlayed: "3 days ago" },
                  { name: 50, size: "3.6 GB", lastPlayed: "Last week" },
                ].map((rom, i) => (
                  <div key={i} className="studio-emu-rom-row">
                    <span className="studio-emu-rom-icon">
                      <Gamepad2 size={9} />
                    </span>
                    <Line w={rom.name} h={11} />
                    <span className="studio-emu-rom-size">{rom.size}</span>
                    <span className="studio-emu-rom-played">{rom.lastPlayed}</span>
                    <span className="studio-emu-rom-play">
                      <Play size={8} fill="currentColor" />
                    </span>
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
