import { useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Gauge,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicSearchBar,
  SchematicSparkline,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface DownloadsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function DownloadsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: DownloadsPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--downloads"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Downloads Header */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsHeader",
          "slot",
          <div className="studio-dl-header-mock">
            <div className="studio-dl-header-left">
              <Download size={13} className="studio-dl-header-icon" />
              <div className="studio-dl-header-text">
                <Line w={45} h={12} />
                <span className="studio-dl-header-badge">1 active · 48.5 MB/s</span>
              </div>
            </div>
            <div className="studio-dl-header-right">
              <span className="studio-dl-btn-add">
                <Plus size={9} />
                <span>Add Download</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Bandwidth Hero Cockpit */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsHero",
          "slot",
          <div className="studio-dl-hero-cockpit">
            <div className="studio-dl-speed-block">
              <div className="studio-dl-speed-dial">
                <Gauge size={16} className="studio-dl-gauge-icon" />
                <span className="studio-dl-speed-big">48.5</span>
                <span className="studio-dl-speed-unit">MB/s</span>
              </div>
              <div className="studio-dl-speed-stats">
                <div className="studio-dl-rate-row">
                  <ArrowDown size={10} className="studio-dl-down-icon" />
                  <span className="studio-dl-rate-val">48.5 MB/s</span>
                  <span className="studio-dl-rate-lbl">Download</span>
                </div>
                <div className="studio-dl-rate-row">
                  <ArrowUp size={10} className="studio-dl-up-icon" />
                  <span className="studio-dl-rate-val">2.1 MB/s</span>
                  <span className="studio-dl-rate-lbl">Upload / Seed</span>
                </div>
              </div>
            </div>
            <div className="studio-dl-kpis-strip">
              <div className="studio-dl-mini-stat">
                <span className="studio-dl-mini-num">1</span>
                <span className="studio-dl-mini-lbl">Active</span>
              </div>
              <div className="studio-dl-mini-stat">
                <span className="studio-dl-mini-num">2</span>
                <span className="studio-dl-mini-lbl">Queued</span>
              </div>
              <div className="studio-dl-mini-stat">
                <span className="studio-dl-mini-num">14</span>
                <span className="studio-dl-mini-lbl">Completed</span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Live Bandwidth Sparkline */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsSparkline",
          "card",
          <div className="studio-dl-sparkline-wrap">
            <div className="studio-dl-sparkline-head">
              <span className="studio-dl-sparkline-title">Realtime Throughput</span>
              <span className="studio-dl-sparkline-peak">Peak: 64.2 MB/s</span>
            </div>
            <SchematicSparkline height={36} color="var(--color-accent)" />
          </div>,
        )}
      </div>

      {/* 4. Filter and View Switcher */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsFilter",
          "slot",
          <div className="studio-dl-filter-mock">
            <div className="studio-dl-filter-tabs">
              {["All (3)", "Downloading (1)", "Paused (1)", "Completed (14)"].map(
                (tab, i) => (
                  <span
                    key={tab}
                    className={`studio-dl-filter-tab${i === 0 ? " is-active" : ""}`}
                  >
                    {tab}
                  </span>
                ),
              )}
            </div>
            <div className="studio-dl-filter-search">
              <SchematicSearchBar placeholder="Filter transfers..." />
            </div>
          </div>,
        )}
      </div>

      {/* 5. Downloads Queue List */}
      <div className="studio-page-full">
        {renderCard(
          "downloadsQueue",
          "slot",
          <div className="studio-dl-queue-mock">
            {/* Active downloading item */}
            <div className="studio-dl-queue-item is-active">
              <div className="studio-dl-item-top">
                <div className="studio-dl-item-meta">
                  <Line w={50} h={11} />
                  <span className="studio-dl-item-rates">
                    48.5 MB/s · ETA: 4m 12s · 18.4 GB / 42.0 GB
                  </span>
                </div>
                <div className="studio-dl-item-actions">
                  <span className="studio-dl-item-btn">
                    <Pause size={9} />
                  </span>
                  <span className="studio-dl-item-btn">
                    <Trash2 size={9} />
                  </span>
                </div>
              </div>
              <Track value={44} color="var(--color-accent)" height={4} />
            </div>

            {/* Paused item */}
            <div className="studio-dl-queue-item is-paused">
              <div className="studio-dl-item-top">
                <div className="studio-dl-item-meta">
                  <Line w={40} h={11} />
                  <span className="studio-dl-item-rates">
                    Paused · 8.2 GB / 25.0 GB
                  </span>
                </div>
                <div className="studio-dl-item-actions">
                  <span className="studio-dl-item-btn">
                    <Play size={9} />
                  </span>
                  <span className="studio-dl-item-btn">
                    <Trash2 size={9} />
                  </span>
                </div>
              </div>
              <Track value={32} color="var(--color-text-muted)" height={4} />
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
