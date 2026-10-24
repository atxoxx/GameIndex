import { useMemo } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, SchematicSearchBar, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface StoragePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

const DRIVES = [
  { label: "C:", used: "450 GB", pct: 45 },
  { label: "D:", used: "1.8 TB", pct: 90 },
  { label: "E:", used: "950 GB", pct: 95 },
];

const ROWS = [
  { name: 60, drive: "D:", size: "124.5 GB", pct: 95 },
  { name: 45, drive: "D:", size: "86.2 GB", pct: 68 },
  { name: 50, drive: "C:", size: "54.0 GB", pct: 42 },
  { name: 35, drive: "E:", size: "28.4 GB", pct: 22 },
];

/**
 * Layout Studio preview for `/storage`.
 *
 * Mirrors the shipped composition exactly — header, figure band, tab strip and
 * the rail + table deck — so the four reorderable slots read as the real page
 * rather than an older widget set.
 */
export function StoragePagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: StoragePagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--storage"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header */}
      <div className="studio-page-full">
        {renderCard(
          "storageHeader",
          "slot",
          <div className="studio-storage-header-mock">
            <div className="studio-storage-header-left">
              <HardDrive size={13} className="studio-storage-header-icon" />
              <div className="studio-storage-header-text">
                <Line w={45} h={12} />
                <span className="studio-storage-header-badge">
                  3.2 TB used · 148 games · 3 drives
                </span>
              </div>
            </div>
            <div className="studio-storage-header-right">
              <span className="studio-storage-header-btn">
                <RefreshCw size={9} />
                <span>Refresh</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Figure band */}
      <div className="studio-page-full">
        {renderCard(
          "storageHero",
          "slot",
          <div className="studio-storage-figures">
            {[
              { label: "Tracked", value: "3.2 TB" },
              { label: "Free space", value: "412 GB" },
              { label: "Installed", value: "148" },
              { label: "Unmeasured", value: "18" },
              { label: "Missing", value: "2" },
              { label: "Largest", value: "124.5 GB" },
            ].map((figure) => (
              <div key={figure.label} className="studio-storage-figure">
                <span className="studio-storage-figure-label">{figure.label}</span>
                <span className="studio-storage-figure-value">{figure.value}</span>
              </div>
            ))}
          </div>,
        )}
      </div>

      {/* 3. Tab strip */}
      <div className="studio-page-full">
        {renderCard(
          "storageControls",
          "slot",
          <div className="studio-storage-tabs">
            {["Overview", "Games", "Health", "Emulators"].map((tab, index) => (
              <span
                key={tab}
                className={`studio-storage-tab${index === 1 ? " is-active" : ""}`}
              >
                {tab}
              </span>
            ))}
          </div>,
        )}
      </div>

      {/* 4. Rail + table deck */}
      <div className="studio-page-full">
        {renderCard(
          "storageList",
          "slot",
          <div className="studio-storage-deck">
            <div className="studio-storage-rail">
              {DRIVES.map((drive) => (
                <div key={drive.label} className="studio-storage-rail-item">
                  <div className="studio-storage-rail-head">
                    <span className="studio-storage-drive-tag">{drive.label}</span>
                    <span className="studio-storage-rail-size">{drive.used}</span>
                  </div>
                  <Track value={drive.pct} color="var(--color-accent)" height={3} />
                </div>
              ))}
            </div>

            <div className="studio-storage-list-mock">
              <div className="studio-storage-toolbar">
                <SchematicSearchBar placeholder="Search games…" />
                {["All", "Sized", "Missing", "Stale"].map((chip, index) => (
                  <span
                    key={chip}
                    className={`studio-storage-pill${index === 0 ? " is-active" : ""}`}
                  >
                    {chip}
                  </span>
                ))}
              </div>
              {ROWS.map((row, i) => (
                <div key={i} className="studio-storage-row">
                  <div className="studio-storage-row-info">
                    <span className="studio-storage-drive-tag">{row.drive}</span>
                    <Line w={row.name} h={11} />
                  </div>
                  <div className="studio-storage-row-bar">
                    <Track value={row.pct} color="var(--color-accent)" height={5} />
                  </div>
                  <span className="studio-storage-row-size">{row.size}</span>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
