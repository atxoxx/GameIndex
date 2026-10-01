import { useMemo } from "react";
import {
  ArrowUpDown,
  Filter,
  Heart,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicGameGrid,
  SchematicSearchBar,
  SchematicSegmentedTabs,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface WishlistPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function WishlistPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: WishlistPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--wishlist"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Wishlist Header */}
      <div className="studio-page-full">
        {renderCard(
          "wishlistHeader",
          "slot",
          <div className="studio-wishlist-header-mock">
            <div className="studio-wishlist-header-title">
              <span className="studio-wishlist-header-icon">
                <Heart size={12} fill="currentColor" />
              </span>
              <div className="studio-wishlist-header-text">
                <Line w={35} h={12} />
                <span className="studio-wishlist-badge">24 games</span>
              </div>
            </div>
            <div className="studio-wishlist-header-actions">
              <span className="studio-wishlist-btn-clear">
                <Trash2 size={9} />
                <span>Clear</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Wishlist Toolbar */}
      <div className="studio-page-full">
        {renderCard(
          "wishlistToolbar",
          "slot",
          <div className="studio-wishlist-toolbar-mock">
            <SchematicSearchBar placeholder="Search wishlist..." />
            <SchematicSegmentedTabs
              tabs={["All (24)", "Out Now (18)", "Coming Soon (6)"]}
              activeIndex={0}
            />
            <span className="studio-wishlist-sort-pill">
              <ArrowUpDown size={9} />
              <span>Date Added</span>
            </span>
          </div>,
        )}
      </div>

      {/* 3. Facet Filters */}
      <div className="studio-page-full">
        {renderCard(
          "filters",
          "card",
          <div className="studio-wishlist-filters-mock">
            <div className="studio-wishlist-filter-btn is-active">
              <Filter size={9} />
              <span>Filters</span>
              <span className="studio-wishlist-filter-count">2</span>
            </div>
            <div className="studio-wishlist-active-facets">
              <span className="studio-wishlist-facet-chip">RPG ×</span>
              <span className="studio-wishlist-facet-chip">Windows ×</span>
            </div>
          </div>,
        )}
      </div>

      {/* 4. Wishlist Grid */}
      <div className="studio-page-full">
        {renderCard(
          "wishlistGrid",
          "slot",
          <SchematicGameGrid variant="wishlist" columns={4} rows={2} />,
        )}
      </div>
    </div>
  );
}
