import { useMemo } from "react";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  Heart,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicGameGrid,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./WishlistPagePreview.css";

export interface WishlistPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/**
 * Layout-studio preview for the wishlist page.
 *
 * Mirrors the current page: the header (PageHeader + four-item stat band), one
 * toolbar that carries the search field, the nested filters widget, the sort
 * select and the status tabs, and the card grid. Filters are a PageWidget
 * nested inside the toolbar, not a sibling row, so they are drawn inside the
 * toolbar card and their pointer events are kept from starting the parent drag.
 */
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

  const stats = useMemo(
    () => [
      { id: "saved", label: t("wishlist.stats.saved"), value: 24, icon: Heart },
      { id: "out", label: t("wishlist.stats.outNow"), value: 18, icon: Check },
      {
        id: "soon",
        label: t("wishlist.stats.comingSoon"),
        value: 6,
        icon: CalendarDays,
      },
      { id: "notes", label: t("wishlist.stats.withNotes"), value: 3, icon: Pencil },
    ],
    [t],
  );

  const groups = useMemo(
    () => [
      { id: "all", label: t("wishlist.all"), count: 24 },
      { id: "released", label: t("wishlist.outNow"), count: 18 },
      { id: "coming_soon", label: t("wishlist.comingSoon"), count: 6 },
    ],
    [t],
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

  const renderFilters = () => (
    <div className="studio-wishlist-filter-stack">
      <div className="studio-wishlist-filter-btn is-active">
        <SlidersHorizontal size={9} />
        <span>{t("wishlist.filters")}</span>
        <span className="studio-wishlist-filter-count">2</span>
      </div>
      <div className="studio-wishlist-popover">
        <div className="studio-wishlist-popover-section">
          <span className="studio-wishlist-popover-title">{t("wishlist.genres")}</span>
          <div className="studio-wishlist-popover-options">
            {[
              { name: "RPG", count: 9 },
              { name: "Action", count: 6 },
              { name: "Indie", count: 4 },
            ].map((facet) => (
              <span
                key={facet.name}
                className={`studio-wishlist-option${
                  facet.name === "RPG" ? " is-active" : ""
                }`}
              >
                <span>{facet.name}</span>
                <span className="studio-wishlist-option-count">{facet.count}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="studio-wishlist-popover-section">
          <span className="studio-wishlist-popover-title">{t("wishlist.platforms")}</span>
          <div className="studio-wishlist-popover-options">
            {[
              { name: "Windows", count: 18 },
              { name: "macOS", count: 4 },
            ].map((facet) => (
              <span
                key={facet.name}
                className={`studio-wishlist-option${
                  facet.name === "Windows" ? " is-active" : ""
                }`}
              >
                <span>{facet.name}</span>
                <span className="studio-wishlist-option-count">{facet.count}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="studio-wishlist-popover-foot">{t("wishlist.clearFilters")}</div>
      </div>
    </div>
  );

  return (
    <div
      className="studio-page-preview studio-page-preview--wishlist"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Wishlist Header: PageHeader + StatBand */}
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
                <Line w={20} h={4} />
                <Line w={35} h={12} />
                <Line w={72} h={5} />
              </div>
            </div>
            <div className="studio-wishlist-header-actions">
              <span className="studio-wishlist-btn-clear">
                <Trash2 size={9} />
                <span>{t("wishlist.clearAll")}</span>
              </span>
            </div>
            <div className="studio-wishlist-stats-mock">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <span key={stat.id} className="studio-wishlist-stat">
                    <span className="studio-wishlist-stat__label">
                      <Icon size={9} aria-hidden="true" />
                      {stat.label}
                    </span>
                    <b>{stat.value}</b>
                  </span>
                );
              })}
            </div>
          </div>,
        )}
      </div>

      {/* 2. Wishlist Toolbar: search + nested filters + sort + status tabs */}
      <div className="studio-page-full">
        {renderCard(
          "wishlistToolbar",
          "slot",
          <div className="studio-wishlist-toolbar-mock">
            <div className="studio-wishlist-toolbar-row">
              <SchematicSearchBar placeholder={t("wishlist.searchPlaceholder")} />
              <div className="studio-wishlist-toolbar-end">
                <div
                  className="studio-wishlist-filter-slot"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {renderCard("filters", "card", renderFilters())}
                </div>
                <span className="studio-wishlist-sort-pill">
                  <ArrowUpDown size={9} />
                  <span>{t("wishlist.sortDateAdded")}</span>
                </span>
              </div>
            </div>
            <div className="studio-wishlist-tabs-mock">
              {groups.map((group, i) => (
                <span key={group.id} className={i === 0 ? "is-active" : undefined}>
                  {group.label} ({group.count})
                </span>
              ))}
              <span className="studio-wishlist-result-count">
                {t("wishlist.showing", { visible: 24, total: 24 })}
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Wishlist Grid */}
      <div className="studio-page-full">
        {renderCard(
          "wishlistGrid",
          "slot",
          <div className="studio-wishlist-grid-stack">
            <SchematicGameGrid variant="wishlist" columns={4} rows={2} />
            {/* The grid renders cards or this panel, never both: kept in the
             *  map so the no-matches composition stays visible. */}
            <div className="studio-wishlist-empty-mock">
              <strong>{t("wishlist.noMatches")}</strong>
              <span>{t("wishlist.noMatchesHint")}</span>
              <span className="studio-wishlist-empty-action">
                {t("wishlist.clearFilters")}
              </span>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
