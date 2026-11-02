import { useMemo } from "react";
import {
  ArrowDownToLine,
  Bookmark,
  CheckSquare,
  ChevronDown,
  Grid3x3,
  Layers,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  Store,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  SchematicGameGrid,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./LibraryPagePreview.css";

export interface LibraryPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/** LibraryScopeBar's scope ribbon, in shipped order. */
const SCOPES: { id: string; labelKey: string; count: number; dot?: string }[] = [
  { id: "all", labelKey: "common.all", count: 312 },
  { id: "playing", labelKey: "game.status.playing", count: 12, dot: "playing" },
  { id: "backlog", labelKey: "game.status.backlog", count: 180, dot: "backlog" },
  { id: "completed", labelKey: "game.status.completed", count: 41, dot: "completed" },
  { id: "installed", labelKey: "filter.installed", count: 210, dot: "installed" },
];

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
      {/* 1. Page header: eyebrow, title + owned count, page actions */}
      <div className="studio-page-full">
        {renderCard(
          "libHeader",
          "slot",
          <div className="studio-lib-header-mock">
            <div className="studio-lib-header-text">
              <span className="studio-lib-eyebrow">{t("library.header.eyebrow")}</span>
              <span className="studio-lib-title-row">
                <span className="studio-lib-title">{t("nav.library")}</span>
                <span className="studio-lib-count">312</span>
              </span>
            </div>
            <div className="studio-lib-header-actions">
              <span className="studio-lib-btn studio-lib-btn--primary" title={t("lib.hero.importGames")}>
                <Plus size={9} />
                <span>{t("lib.hero.importGames")}</span>
              </span>
              <span className="studio-lib-btn" title={t("lib.hero.browseStore")}>
                <Store size={9} />
                <span>{t("lib.hero.browseStore")}</span>
              </span>
              <span className="studio-lib-icon-btn" title={t("libraryExport.export")}>
                <ArrowDownToLine size={10} />
              </span>
              <span className="studio-lib-icon-btn" title={t("storeToolbar.selectMultiple")}>
                <CheckSquare size={10} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Library stats: total, installed (percentage detail), playtime, this week */}
      <div className="studio-page-full">
        {renderCard(
          "libKpis",
          "card",
          <div className="studio-lib-stats-mock">
            <span className="studio-lib-stat">
              <span className="studio-lib-stat-value">312</span>
              <span className="studio-lib-stat-label">{t("lib.hero.stat.total")}</span>
            </span>
            <span className="studio-lib-stat">
              <span className="studio-lib-stat-value">210</span>
              <span className="studio-lib-stat-label">{t("lib.hero.stat.installed")}</span>
              <span className="studio-lib-stat-detail">
                {t("lib.hero.stat.pctOfLibrary", { count: 67 })}
              </span>
            </span>
            <span className="studio-lib-stat">
              <span className="studio-lib-stat-value">1284h</span>
              <span className="studio-lib-stat-label">{t("lib.hero.stat.playtime")}</span>
            </span>
            <span className="studio-lib-stat">
              <span className="studio-lib-stat-value">7</span>
              <span className="studio-lib-stat-label">{t("lib.hero.stat.addedWeek")}</span>
            </span>
          </div>,
        )}
      </div>

      {/* 3. Jump back in strip */}
      <div className="studio-page-full">
        {renderCard(
          "libResume",
          "card",
          <div className="studio-lib-resume-mock">
            <div className="studio-lib-resume-head">
              <span className="studio-lib-resume-dot" aria-hidden="true" />
              <div className="studio-lib-resume-heading">
                <span className="studio-lib-resume-title">{t("library.hero.jumpBackIn")}</span>
                <span className="studio-lib-resume-subtitle">
                  {t("lib.rail.continue.subtitle")}
                </span>
              </div>
            </div>
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

      {/* 4. Sticky command bar: scope ribbon, then search + filters/sort/group/density */}
      <div className="studio-page-full">
        {renderCard(
          "libToolbar",
          "slot",
          <div className="studio-lib-command-mock">
            <div className="studio-lib-scope-row">
              {SCOPES.map((scope, i) => (
                <span
                  key={scope.id}
                  className={`studio-lib-scope${i === 0 ? " is-active" : ""}`}
                >
                  {scope.dot && (
                    <i
                      className={`studio-lib-scope-dot studio-lib-scope-dot--${scope.dot}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="studio-lib-scope-label">{t(scope.labelKey)}</span>
                  <span className="studio-lib-scope-count">{scope.count}</span>
                </span>
              ))}
              <span className="studio-lib-scope studio-lib-scope--shelves">
                <Layers size={9} aria-hidden="true" />
                <span className="studio-lib-scope-label">{t("shelves.title")}</span>
                <ChevronDown size={9} className="studio-lib-scope-chevron" aria-hidden="true" />
              </span>
            </div>
            <div className="studio-lib-command-row">
              <SchematicSearchBar placeholder={t("page.library.searchPlaceholder")} />
              <div className="studio-lib-toolbar-actions">
                <span className="studio-lib-filter-trigger">
                  <SlidersHorizontal size={9} aria-hidden="true" />
                  <span>{t("store.filters")}</span>
                </span>
                <span className="studio-lib-pill">{t("library.sort.alphabetical")}</span>
                <span className="studio-lib-pill">{t("library.groupBy.none")}</span>
                <span className="studio-lib-density-icons">
                  <Grid3x3 size={10} aria-hidden="true" />
                  <LayoutGrid size={10} aria-hidden="true" />
                  <List size={10} aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 5. Active filter chips: result count, removable facets, save/clear actions */}
      <div className="studio-page-full">
        {renderCard(
          "libFilterChips",
          "card",
          <div className="studio-lib-chips">
            <span className="studio-lib-chips-count">
              {t("storage.gamesCount", { count: 96, plural: "s" })}
            </span>
            <div className="studio-lib-chips-list">
              {[
                t("library.chips.shelf", { name: t("game.status.backlog") }),
                "Action",
                "Steam",
              ].map((chip) => (
                <span key={chip} className="studio-schematic-chip">
                  <span>{chip}</span>
                  <i className="studio-schematic-chip__x">×</i>
                </span>
              ))}
            </div>
            <div className="studio-lib-chips-actions">
              <span className="studio-lib-chips-action">
                <Bookmark size={9} aria-hidden="true" />
                <span>{t("library.chips.saveAsShelf")}</span>
              </span>
              <span className="studio-lib-chips-action">{t("page.library.clearFilters")}</span>
            </div>
          </div>,
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
