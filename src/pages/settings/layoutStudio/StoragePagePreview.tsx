import { useMemo } from "react";
import {
  HardDrive,
  ListFilter,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicDiskMeter,
  SchematicDonut,
  SchematicSearchBar,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface StoragePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

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
      className="studio-page-preview studio-page-preview--storage"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Storage Header */}
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
                <span>Remeasure All</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Hero Storage Dashboard (Drives & Breakdown) */}
      <div className="studio-page-full">
        {renderCard(
          "storageHero",
          "slot",
          <div className="studio-storage-hero-mock">
            <div className="studio-storage-drives-col">
              <SchematicDiskMeter
                drive="C:"
                label="System SSD"
                used="450 GB"
                total="1.0 TB"
                percent={45}
              />
              <SchematicDiskMeter
                drive="D:"
                label="Games NVMe"
                used="1.8 TB"
                total="2.0 TB"
                percent={90}
              />
              <SchematicDiskMeter
                drive="E:"
                label="Archive HDD"
                used="950 GB"
                total="1.0 TB"
                percent={95}
              />
            </div>
            <div className="studio-storage-cleanup-col">
              <div className="studio-storage-donut-wrap">
                <SchematicDonut size={48} stroke={6} />
                <div className="studio-storage-donut-text">
                  <span className="studio-storage-donut-val">3.2 TB</span>
                  <span className="studio-storage-donut-lbl">Installed</span>
                </div>
              </div>
              <div className="studio-storage-cleanup-card">
                <div className="studio-storage-cleanup-title">
                  <Sparkles size={10} />
                  <span>Cleanup Assistant</span>
                </div>
                <span className="studio-storage-cleanup-desc">
                  12 stale games (&gt; 6 mo unplayed) · 320 GB reclaimable
                </span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Storage Controls Bar */}
      <div className="studio-page-full">
        {renderCard(
          "storageControls",
          "slot",
          <div className="studio-storage-controls-mock">
            <div className="studio-storage-filter-pills">
              {["All (148)", "Massive >50G (18)", "Large 15-50G (34)", "Stale (12)"].map(
                (p, i) => (
                  <span
                    key={p}
                    className={`studio-storage-pill${i === 0 ? " is-active" : ""}`}
                  >
                    {p}
                  </span>
                ),
              )}
            </div>
            <div className="studio-storage-controls-right">
              <SchematicSearchBar placeholder="Filter games..." />
              <span className="studio-storage-btn-group">
                <ListFilter size={9} />
                <span>Group: Drive</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 4. Storage Game List Rows */}
      <div className="studio-page-full">
        {renderCard(
          "storageList",
          "slot",
          <div className="studio-storage-list-mock">
            {[
              { name: 60, drive: "D:", size: "124.5 GB", pct: 95 },
              { name: 45, drive: "D:", size: "86.2 GB", pct: 68 },
              { name: 50, drive: "C:", size: "54.0 GB", pct: 42 },
              { name: 35, drive: "E:", size: "28.4 GB", pct: 22 },
            ].map((row, i) => (
              <div key={i} className="studio-storage-row">
                <div className="studio-storage-row-info">
                  <span className="studio-storage-drive-tag">{row.drive}</span>
                  <Line w={row.name} h={11} />
                </div>
                <div className="studio-storage-row-bar">
                  <Track value={row.pct} color="var(--color-accent)" height={5} />
                </div>
                <span className="studio-storage-row-size">{row.size}</span>
                <span className="studio-storage-row-action">
                  <Trash2 size={9} />
                </span>
              </div>
            ))}
          </div>,
        )}
      </div>
    </div>
  );
}
