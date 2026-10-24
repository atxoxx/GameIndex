import { useMemo } from "react";
import { Gamepad2, Gift, RefreshCw, Sparkles, Tag } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicFilterChips,
  SchematicGameGrid,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface DealsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/**
 * Layout-studio preview for the deals page.
 *
 * Mirrors the current page: a header and one results widget whose band holds
 * the source tabs, the shared control bar and the tile grid. The hero and
 * subtab strips are part of that band, not standalone widgets, so they are
 * drawn inside the grid card rather than as separate reorderable rows.
 */
export function DealsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: DealsPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--deals"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      <div className="studio-page-full">
        {renderCard(
          "dealsHeader",
          "slot",
          <div className="studio-deals-header-mock">
            <div className="studio-deals-header-left">
              <Tag size={13} className="studio-deals-header-icon" />
              <div className="studio-deals-header-text">
                <Line w={45} h={12} />
                <span className="studio-deals-header-badge">412 active deals</span>
              </div>
            </div>
            <div className="studio-deals-header-right">
              <span className="studio-deals-header-pill">
                <RefreshCw size={9} />
                <span>Refresh</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      <div className="studio-page-full">
        {renderCard(
          "dealsGrid",
          "slot",
          <div className="studio-deals-grid-container">
            <div className="studio-deals-subtabs-mock">
              <span className="studio-deals-subtab is-active">
                <Sparkles size={10} />
                <span>{t("deals.overview")}</span>
              </span>
              <span className="studio-deals-subtab">
                <Tag size={10} />
                <span>{t("deals.storeDeals")}</span>
              </span>
              <span className="studio-deals-subtab">
                <Gamepad2 size={10} />
                <span>{t("deals.gamepassShort")}</span>
              </span>
              <span className="studio-deals-subtab">
                <Gift size={10} />
                <span>{t("deals.freeGames")}</span>
              </span>
            </div>

            <div className="studio-deals-stats-mock">
              <span>412</span>
              <span>6</span>
              <span>38</span>
              <span>24</span>
            </div>

            <div className="studio-deals-filters-bar">
              <SchematicFilterChips
                chips={["Search", "Sort", "Filters", "Density"]}
              />
            </div>

            <SchematicGameGrid variant="store" columns={4} rows={2} />
          </div>,
        )}
      </div>
    </div>
  );
}
