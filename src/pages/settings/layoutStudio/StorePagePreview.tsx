import { useMemo } from "react";
import {
  ArrowUpDown,
  Check,
  ShoppingBag,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicGameGrid,
  SchematicHero,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface StorePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function StorePagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: StorePagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--store"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Store Header */}
      <div className="studio-page-full">
        {renderCard(
          "storeHeader",
          "slot",
          <div className="studio-store-header-mock">
            <div className="studio-store-header-left">
              <ShoppingBag size={13} className="studio-store-header-icon" />
              <div className="studio-store-header-text">
                <Line w={40} h={12} />
                <span className="studio-store-header-badge">12,450 games</span>
              </div>
            </div>
            <div className="studio-store-header-right">
              <SchematicSearchBar placeholder="Search store catalogue..." />
            </div>
          </div>,
        )}
      </div>

      {/* 2. Featured Spotlight Carousel */}
      <div className="studio-page-full">
        {renderCard("hero", "slot", <SchematicHero variant="store" />)}
      </div>

      {/* 3. Two-Column Store Layout */}
      <div className="studio-store-split">
        {/* Left Filter Panel */}
        <aside className="studio-store-filter-col">
          {renderCard(
            "storeFilters",
            "card",
            <div className="studio-store-filters-body">
              <div className="studio-store-filter-sec">
                <span className="studio-store-filter-title">Storefronts</span>
                {["Steam", "GOG", "Epic"].map((s, i) => (
                  <span key={s} className="studio-store-filter-row">
                    <span className={`studio-store-check${i === 0 ? " is-checked" : ""}`}>
                      {i === 0 && <Check size={7} />}
                    </span>
                    <span className="studio-store-filter-label">{s}</span>
                  </span>
                ))}
              </div>
              <div className="studio-store-filter-sec">
                <span className="studio-store-filter-title">Price</span>
                <div className="studio-store-price-pills">
                  <span className="studio-store-price-pill is-active">All</span>
                  <span className="studio-store-price-pill">&lt; $10</span>
                  <span className="studio-store-price-pill">&lt; $20</span>
                </div>
              </div>
              <div className="studio-store-filter-sec">
                <span className="studio-store-filter-title">Genres</span>
                {["Action", "RPG", "Indie"].map((g) => (
                  <span key={g} className="studio-store-filter-row">
                    <span className="studio-store-check" />
                    <span className="studio-store-filter-label">{g}</span>
                  </span>
                ))}
              </div>
            </div>,
          )}
        </aside>

        {/* Right Main Column: Toolbar + Grid */}
        <div className="studio-store-main-col">
          {renderCard(
            "storeToolbar",
            "slot",
            <div className="studio-store-toolbar-mock">
              <span className="studio-store-sort-pill">
                <ArrowUpDown size={9} />
                <span>Sort: Popularity</span>
              </span>
              <div className="studio-store-platform-pills">
                <span className="studio-store-platform-pill is-active">Windows</span>
                <span className="studio-store-platform-pill">Steam Deck</span>
              </div>
            </div>,
          )}

          {renderCard(
            "storeGrid",
            "slot",
            <SchematicGameGrid variant="store" columns={3} rows={2} />,
          )}
        </div>
      </div>
    </div>
  );
}
