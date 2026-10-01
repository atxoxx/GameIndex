import { useMemo } from "react";
import {
  Flame,
  Gamepad2,
  Gift,
  RefreshCw,
  Sparkles,
  Tag,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicFilterChips,
  SchematicGameGrid,
  SchematicHero,
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
      {/* 1. Deals Header */}
      <div className="studio-page-full">
        {renderCard(
          "dealsHeader",
          "slot",
          <div className="studio-deals-header-mock">
            <div className="studio-deals-header-left">
              <Tag size={13} className="studio-deals-header-icon" />
              <div className="studio-deals-header-text">
                <Line w={45} h={12} />
                <span className="studio-deals-header-badge">1,248 active deals</span>
              </div>
            </div>
            <div className="studio-deals-header-right">
              <span className="studio-deals-header-pill">
                <RefreshCw size={9} />
                <span>Sync Prices</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Spotlight Deal Hero */}
      <div className="studio-page-full">
        {renderCard(
          "hero",
          "slot",
          <SchematicHero
            variant="store"
            badgeText="Deal Spotlight -75%"
            title={
              <>
                <Line w={55} h={14} />
                <span className="studio-deals-hero-price">
                  <span className="studio-deals-hero-tag">-75%</span>
                  <span className="studio-deals-hero-strike">$59.99</span>
                  <span className="studio-deals-hero-final">$14.99</span>
                </span>
              </>
            }
          />,
        )}
      </div>

      {/* 3. Subtabs Bar */}
      <div className="studio-page-full">
        {renderCard(
          "subtabs",
          "slot",
          <div className="studio-deals-subtabs-mock">
            <span className="studio-deals-subtab is-active">
              <Flame size={10} />
              <span>IsThereAnyDeal</span>
              <i className="studio-deals-subtab-count">1.2k</i>
            </span>
            <span className="studio-deals-subtab">
              <Gamepad2 size={10} />
              <span>Game Pass</span>
              <i className="studio-deals-subtab-count">450</i>
            </span>
            <span className="studio-deals-subtab">
              <Gift size={10} />
              <span>Giveaways</span>
              <i className="studio-deals-subtab-count">8</i>
            </span>
            <span className="studio-deals-subtab">
              <Sparkles size={10} />
              <span>Playtests</span>
              <i className="studio-deals-subtab-count">14</i>
            </span>
          </div>,
        )}
      </div>

      {/* 4. Deals Grid + Filters */}
      <div className="studio-page-full">
        {renderCard(
          "dealsGrid",
          "slot",
          <div className="studio-deals-grid-container">
            <div className="studio-deals-filters-bar">
              <SchematicFilterChips chips={["Steam", "GOG", "Epic", "Discount > 50%", "< $10"]} />
            </div>
            <SchematicGameGrid variant="store" columns={4} rows={2} />
          </div>,
        )}
      </div>
    </div>
  );
}
