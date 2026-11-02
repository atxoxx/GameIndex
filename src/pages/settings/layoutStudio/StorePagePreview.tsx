import { useMemo } from "react";
import {
  ArrowUpDown,
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  LayoutGrid,
  List,
  Monitor,
  Plus,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  SchematicCardRail,
  SchematicGameGrid,
  SchematicHero,
  SchematicSearchBar,
  SchematicSegmentedTabs,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./StorePagePreview.css";

export interface StorePagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/** The four hero categories StoreFeaturedHero cycles through. */
const HERO_TAB_KEYS = [
  "store.featured.hot",
  "store.featured.weekly",
  "store.featured.trending",
  "store.featured.comingSoon",
];

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

  // The filter trigger is the store page's `filters` widget, nested inside the
  // sticky command bar rather than its own row.
  const filtersItem = byId.get("filters");

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
      {/* 1. Store header: eyebrow, results title, catalogue count, page actions */}
      <div className="studio-page-full">
        {renderCard(
          "storeHeader",
          "slot",
          <div className="studio-store-header-mock">
            <div className="studio-store-header-text">
              <span className="studio-store-header-eyebrow">{t("nav.store")}</span>
              <span className="studio-store-header-title">
                {t("store.resultsTitle.allGames")}
              </span>
              <span className="studio-store-header-badge">
                {t("storage.gamesCount", { count: 12450, plural: "s" })}
              </span>
            </div>
            <div className="studio-store-header-actions">
              <span className="studio-store-action-btn">
                <CheckSquare size={9} aria-hidden="true" />
                <span>{t("store.header.bulk")}</span>
              </span>
              <span className="studio-store-action-btn">
                <BarChart3 size={9} aria-hidden="true" />
                <span>{t("store.header.compare")}</span>
              </span>
              <span className="studio-store-action-btn">
                <Shuffle size={9} aria-hidden="true" />
                <span>{t("store.header.surprise")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Featured spotlight: category tabs + prev/next over the slide */}
      <div className="studio-page-full">
        {renderCard(
          "hero",
          "slot",
          <div className="studio-store-hero">
            <div className="studio-store-hero-head">
              <SchematicSegmentedTabs tabs={HERO_TAB_KEYS.map((key) => t(key))} />
              <div className="studio-store-hero-nav">
                <span className="studio-store-hero-nav-btn">
                  <ChevronLeft size={9} aria-hidden="true" />
                </span>
                <span className="studio-store-hero-nav-btn">
                  <ChevronRight size={9} aria-hidden="true" />
                </span>
              </div>
            </div>
            <SchematicHero variant="store" />
          </div>,
        )}
      </div>

      {/* StoreQuickPicks: a discovery shelf rendered outside PageWidget, only
          while the catalogue is unfiltered and unsearched. */}
      <section className="studio-store-quickpicks" aria-label={t("store.quickPicks.title")}>
        <div className="studio-store-quickpicks-head">
          <span className="studio-store-quickpicks-icon" aria-hidden="true">
            <Sparkles size={10} />
          </span>
          <div className="studio-store-quickpicks-text">
            <span className="studio-store-quickpicks-title">{t("store.quickPicks.title")}</span>
            <span className="studio-store-quickpicks-sub">{t("store.quickPicks.subtitle")}</span>
          </div>
          <div className="studio-store-quickpicks-actions">
            <span className="studio-store-quickpicks-nav" title={t("store.quickPicks.prev")}>
              <ChevronLeft size={9} aria-hidden="true" />
            </span>
            <span className="studio-store-quickpicks-nav" title={t("store.quickPicks.next")}>
              <ChevronRight size={9} aria-hidden="true" />
            </span>
            <span className="studio-store-quickpicks-nav" title={t("store.quickPicks.dismiss")}>
              <X size={9} aria-hidden="true" />
            </span>
          </div>
        </div>
        <SchematicCardRail variant="standard" count={4} />
      </section>

      {/* 3. Catalogue: sticky command bar, active-filter chips, grid.
             Filters are a popover anchored to the command bar (the store page
             wraps StoreFilterPanel in a PageWidget inside StoreToolbar), so the
             catalogue has no left filter column to draw here. */}
      <div className="studio-store-main">
        <div className="studio-page-full">
          {renderCard(
            "storeToolbar",
            "slot",
            <div className="studio-store-command">
              <div className="studio-store-command-row">
                <SchematicSearchBar placeholder={t("store.searchPlaceholder")} />
                <span className="studio-store-count">
                  {t("storage.gamesCount", { count: 12450, plural: "s" })}
                </span>
                <span className="studio-store-sort-pill">
                  <ArrowUpDown size={9} aria-hidden="true" />
                  <span>
                    {t("achievements.sort")} {t("store.sort.popularity")}
                  </span>
                </span>
                {filtersItem && (
                  <button
                    type="button"
                    className={`studio-store-filter-trigger${
                      filtersItem.item.hidden ? " is-off" : ""
                    }${highlightedId === "filters" ? " is-preview-lit" : ""}`}
                    aria-pressed={!filtersItem.item.hidden}
                    title={
                      inspectMode
                        ? `${filtersItem.item.label} — ${t(
                            "settings.interface.inspectElementHint",
                          )}`
                        : `${filtersItem.item.label} — ${t(
                            filtersItem.item.hidden
                              ? "settings.interface.studioShow"
                              : "settings.interface.studioHide",
                          )}`
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (inspectMode && onInspectElement) onInspectElement("filters");
                      else onToggleWidget("filters");
                    }}
                  >
                    <SlidersHorizontal size={9} aria-hidden="true" />
                    <span>{t("store.filters")}</span>
                  </button>
                )}
                <span
                  className="studio-store-density"
                  role="group"
                  aria-label={t("store.toolbar.viewOptions")}
                >
                  <Grid3x3 size={10} aria-hidden="true" />
                  <LayoutGrid size={10} aria-hidden="true" />
                  <Monitor size={10} aria-hidden="true" />
                  <List size={10} aria-hidden="true" />
                </span>
              </div>
            </div>,
          )}
        </div>

        {/* StoreFilterChips: always visible, outside PageWidget */}
        <div className="studio-store-chips">
          <span className="studio-store-chips-icon" aria-hidden="true">
            <SlidersHorizontal size={10} />
          </span>
          <span className="studio-store-chips-empty">{t("store.chips.empty")}</span>
          <div className="studio-store-chips-actions">
            <span className="studio-store-chips-add">
              <Plus size={9} aria-hidden="true" />
              {t("store.chips.add")}
            </span>
          </div>
        </div>

        <div className="studio-page-full">
          {renderCard(
            "storeGrid",
            "slot",
            <SchematicGameGrid variant="store" columns={4} rows={2} />,
          )}
        </div>
      </div>
    </div>
  );
}
