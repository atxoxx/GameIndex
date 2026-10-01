import { useMemo } from "react";
import {
  Bookmark,
  Check,
  Filter,
  Grid3x3,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  SchematicCardRail,
  SchematicFilterChips,
  SchematicGameGrid,
  SchematicHero,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface LibraryPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function LibraryPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: LibraryPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--library"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Library Spotlight Hero */}
      <div className="studio-page-full">
        {renderCard("hero", "slot", <SchematicHero variant="library" />)}
      </div>

      {/* 2. Continue Playing Rail */}
      <div className="studio-page-full">
        {renderCard(
          "libContinuePlaying",
          "card",
          <SchematicCardRail variant="progress" count={4} />,
        )}
      </div>

      {/* 3. Recently Added Rail */}
      <div className="studio-page-full">
        {renderCard(
          "libRecentlyAdded",
          "card",
          <SchematicCardRail variant="standard" count={4} />,
        )}
      </div>

      {/* 4. Toolbar */}
      <div className="studio-page-full">
        {renderCard(
          "libToolbar",
          "slot",
          <div className="studio-lib-toolbar-mock">
            <SchematicSearchBar placeholder="Search library..." />
            <div className="studio-lib-toolbar-actions">
              <span className="studio-lib-pill">
                <SlidersHorizontal size={9} />
                <span>Sort: Last Played</span>
              </span>
              <span className="studio-lib-density-icons">
                <Grid3x3 size={10} />
              </span>
              <span className="studio-lib-filter-trigger">
                <Filter size={9} />
                <span>Filters (2)</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 5. Filter Chips */}
      <div className="studio-page-full">
        {renderCard(
          "libFilterChips",
          "card",
          <SchematicFilterChips chips={["Action", "Steam", "Installed"]} />,
        )}
      </div>

      {/* 6. Filter Presets */}
      <div className="studio-page-full">
        {renderCard(
          "libPresets",
          "card",
          <div className="studio-lib-presets-mock">
            <Bookmark size={10} className="studio-lib-preset-icon" />
            <span className="studio-lib-preset-tag is-active">Favorites</span>
            <span className="studio-lib-preset-tag">Backlog</span>
            <span className="studio-lib-preset-tag">RPG Top</span>
            <span className="studio-lib-preset-add">+ Preset</span>
          </div>,
        )}
      </div>

      {/* 7. Split Layout: Filter Rail + Virtual Grid */}
      <div className="studio-lib-split">
        {/* Left Filter Rail */}
        <aside className="studio-lib-rail-col">
          {renderCard(
            "libFilterRail",
            "card",
            <div className="studio-lib-rail-body">
              <div className="studio-lib-rail-sec">
                <span className="studio-lib-rail-title">Sources</span>
                {["Steam", "GOG", "Epic"].map((src, i) => (
                  <span key={src} className="studio-lib-rail-row">
                    <span className={`studio-lib-rail-check${i === 0 ? " is-checked" : ""}`}>
                      {i === 0 && <Check size={7} />}
                    </span>
                    <span className="studio-lib-rail-name">{src}</span>
                    <span className="studio-lib-rail-count">48</span>
                  </span>
                ))}
              </div>
              <div className="studio-lib-rail-sec">
                <span className="studio-lib-rail-title">Status</span>
                {["Playing", "Completed"].map((st) => (
                  <span key={st} className="studio-lib-rail-row">
                    <span className="studio-lib-rail-check" />
                    <span className="studio-lib-rail-name">{st}</span>
                    <span className="studio-lib-rail-count">12</span>
                  </span>
                ))}
              </div>
            </div>,
          )}
        </aside>

        {/* Right Game Grid */}
        <div className="studio-lib-grid-col">
          {renderCard(
            "libGrid",
            "slot",
            <SchematicGameGrid variant="library" columns={4} rows={2} />,
          )}
        </div>
      </div>
    </div>
  );
}
