import { useMemo } from "react";
import {
  ArrowDownToLine,
  CheckSquare,
  Grid3x3,
  LayoutGrid,
  Plus,
  SlidersHorizontal,
  Store,
  Table2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  SchematicFilterChips,
  SchematicGameGrid,
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

/**
 * Layout Studio preview for the Library page.
 *
 * Mirrors the shipped order: header, stats, resume strip, sticky command bar,
 * filter chips and grid. Widgets are schematics, not the real components, so
 * the studio stays light while still showing what each switch hides.
 */
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
      {/* 1. Page header */}
      <div className="studio-page-full">
        {renderCard(
          "libHeader",
          "slot",
          <div className="studio-lib-header-mock">
            <div className="studio-lib-header-text">
              <span className="studio-lib-eyebrow">Collection</span>
              <span className="studio-lib-title">Library</span>
            </div>
            <div className="studio-lib-header-actions">
              <span className="studio-lib-btn studio-lib-btn--primary">
                <Plus size={9} />
                <span>Import</span>
              </span>
              <span className="studio-lib-btn">
                <Store size={9} />
                <span>Store</span>
              </span>
              <span className="studio-lib-icon-btn">
                <ArrowDownToLine size={10} />
              </span>
              <span className="studio-lib-icon-btn">
                <CheckSquare size={10} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Library stats */}
      <div className="studio-page-full">
        {renderCard(
          "libKpis",
          "card",
          <div className="studio-lib-stats-mock">
            {[
              { value: "312", label: "Games" },
              { value: "210", label: "Installed" },
              { value: "1,284h", label: "Played" },
              { value: "+7", label: "This week" },
            ].map((stat) => (
              <span key={stat.label} className="studio-lib-stat">
                <span className="studio-lib-stat-value">{stat.value}</span>
                <span className="studio-lib-stat-label">{stat.label}</span>
              </span>
            ))}
          </div>,
        )}
      </div>

      {/* 3. Jump back in strip */}
      <div className="studio-page-full">
        {renderCard(
          "libResume",
          "card",
          <div className="studio-lib-resume-mock">
            <span className="studio-lib-resume-title">Jump back in</span>
            <div className="studio-lib-resume-track">
              {[0, 1, 2].map((i) => (
                <span key={i} className="studio-lib-resume-card">
                  <span className="studio-lib-resume-art" />
                  <span className="studio-lib-resume-name" />
                </span>
              ))}
            </div>
          </div>,
        )}
      </div>

      {/* 4. Sticky command bar */}
      <div className="studio-page-full">
        {renderCard(
          "libToolbar",
          "slot",
          <div className="studio-lib-command-mock">
            <div className="studio-lib-scope-row">
              {["All 312", "Playing 12", "Backlog 180", "Completed 41", "Installed 210", "Shelves"].map(
                (scope, i) => (
                  <span
                    key={scope}
                    className={`studio-lib-scope${i === 0 ? " is-active" : ""}`}
                  >
                    {scope}
                  </span>
                ),
              )}
            </div>
            <div className="studio-lib-command-row">
              <SchematicSearchBar placeholder="Search your library..." />
              <div className="studio-lib-toolbar-actions">
                <span className="studio-lib-filter-trigger">
                  <SlidersHorizontal size={9} />
                  <span>Filters</span>
                </span>
                <span className="studio-lib-pill">Sort</span>
                <span className="studio-lib-pill">Group</span>
                <span className="studio-lib-density-icons">
                  <LayoutGrid size={10} />
                  <Grid3x3 size={10} />
                  <Table2 size={10} />
                </span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 5. Active filter chips */}
      <div className="studio-page-full">
        {renderCard(
          "libFilterChips",
          "card",
          <SchematicFilterChips chips={["Shelf: Backlog", "Action", "Steam"]} />,
        )}
      </div>

      {/* 6. Game grid */}
      <div className="studio-page-full">
        {renderCard(
          "libGrid",
          "slot",
          <SchematicGameGrid variant="library" columns={5} rows={2} />,
        )}
      </div>
    </div>
  );
}
