import { useMemo } from "react";
import {
  CheckCheck,
  Clock,
  LayoutGrid,
  Newspaper,
  RefreshCw,
  Rss,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, Lines, SchematicSearchBar } from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface NewsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

/**
 * Layout Studio preview for the News page.
 *
 * Mirrors the shipped structure: header, one control band (four tabs + search +
 * filters), the briefing with two rails, and the card grid. There is no hero —
 * the briefing replaced it, and topics are filters inside the Feed.
 */
export function NewsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: NewsPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--news"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Header */}
      <div className="studio-page-full">
        {renderCard(
          "newsHeader",
          "slot",
          <div className="studio-news-header-mock">
            <div className="studio-news-header-left">
              <Newspaper size={13} className="studio-news-header-icon" />
              <div className="studio-news-header-text">
                <Line w={45} h={12} />
                <span className="studio-news-header-badge">{t("news.statsUnread")} 12</span>
              </div>
            </div>
            <div className="studio-news-header-actions">
              <span className="studio-news-btn">
                <CheckCheck size={9} />
                <span>{t("news.markRead")}</span>
              </span>
              <span className="studio-news-btn">
                <RefreshCw size={9} />
              </span>
              <span className="studio-news-btn">
                <Rss size={9} />
                <span>{t("news.sources")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Control band */}
      <div className="studio-page-full">
        {renderCard(
          "newsToolbar",
          "slot",
          <div className="studio-news-toolbar-mock">
            <div className="studio-news-categories">
              {[t("news.tabOverview"), t("news.tabFeed"), t("news.tabSaved"), t("news.tabHistory")].map(
                (label, i) => (
                  <span key={label} className={`studio-news-cat-tab${i === 0 ? " is-active" : ""}`}>
                    {label}
                  </span>
                ),
              )}
            </div>
            <div className="studio-news-toolbar-right">
              <SchematicSearchBar placeholder={t("news.searchPlaceholder")} />
              <span className="studio-news-btn">
                <SlidersHorizontal size={9} />
                <span>{t("news.filtersTitle")}</span>
              </span>
              <span className="studio-news-density-btn">
                <LayoutGrid size={9} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Briefing + rails */}
      <div className="studio-page-full">
        {renderCard(
          "newsOverview",
          "slot",
          <div className="studio-news-overview">
            <div className="studio-news-briefing">
              <div className="studio-news-briefing-lead">
                <span className="studio-news-briefing-eyebrow">{t("news.sinceLastVisit")}</span>
                <strong>18</strong>
                <Line w={78} />
                <span className="studio-news-briefing-cta">{t("news.catchUp")}</span>
              </div>
              <div className="studio-news-briefing-stats">
                {[t("news.statsUnread"), t("news.statsSaved"), t("news.statsFeeds")].map((label) => (
                  <span key={label} className="studio-news-briefing-stat">
                    <Line w={22} h={10} />
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="studio-news-rails">
              {[0, 1].map((row) => (
                <div key={row} className="studio-news-rail">
                  <div className="studio-news-rail-head">
                    <Clock size={9} />
                    <Line w={row === 0 ? 34 : 28} h={8} />
                  </div>
                  <div className="studio-news-rail-track">
                    {[0, 1, 2].map((cardIndex) => (
                      <div key={cardIndex} className="studio-news-rail-card">
                        <div className="studio-news-rail-thumb" />
                        <Line w={82} h={7} />
                        <Line w={58} h={7} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>

      {/* 5. Grid */}
      <div className="studio-page-full">
        {renderCard(
          "newsGrid",
          "slot",
          <div className="studio-news-grid-mock">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="studio-news-article-card">
                <div className="studio-news-card-thumb">
                  <span className="studio-news-thumb-badge">
                    {i % 2 === 0 ? "Eurogamer" : "PC Gamer"}
                  </span>
                </div>
                <div className="studio-news-card-body">
                  <div className="studio-news-card-meta">
                    <span className="studio-news-card-time">{i * 2 + 1}h</span>
                  </div>
                  <Line w={90} h={10} />
                  <Line w={65} h={10} />
                  <Lines ws={[80, 50]} />
                </div>
              </div>
            ))}
          </div>,
        )}
      </div>
    </div>
  );
}
