import { useMemo } from "react";
import {
  Bookmark,
  CheckCheck,
  Clock,
  ExternalLink,
  Newspaper,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  Lines,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface NewsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

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
          widgetDrag.startDrag(index);
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
      {/* 1. News Header */}
      <div className="studio-page-full">
        {renderCard(
          "newsHeader",
          "slot",
          <div className="studio-news-header-mock">
            <div className="studio-news-header-left">
              <Newspaper size={13} className="studio-news-header-icon" />
              <div className="studio-news-header-text">
                <Line w={45} h={12} />
                <span className="studio-news-header-badge">84 unread articles</span>
              </div>
            </div>
            <div className="studio-news-header-actions">
              <span className="studio-news-btn">
                <CheckCheck size={9} />
                <span>Mark Read</span>
              </span>
              <span className="studio-news-btn">
                <RefreshCw size={9} />
              </span>
              <span className="studio-news-btn">
                <Settings2 size={9} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Hero Spotlight Article */}
      <div className="studio-page-full">
        {renderCard(
          "hero",
          "slot",
          <div className="studio-news-hero-mock">
            <div className="studio-news-hero-backdrop" />
            <div className="studio-news-hero-content">
              <div className="studio-news-hero-top">
                <span className="studio-news-source-badge">PC Gamer</span>
                <span className="studio-news-read-time">
                  <Clock size={8} /> 4 min read
                </span>
              </div>
              <div className="studio-news-hero-title">
                <Line w={65} h={14} />
                <Line w={45} h={14} />
              </div>
              <p className="studio-news-hero-desc">
                <Line w={85} />
                <Line w={70} />
              </p>
              <div className="studio-news-hero-footer">
                <span className="studio-news-hero-btn">
                  <span>Read Full Article</span>
                  <ExternalLink size={8} />
                </span>
                <span className="studio-news-hero-save">
                  <Bookmark size={10} />
                </span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 3. News Toolbar (Categories + Search + Filters) */}
      <div className="studio-page-full">
        {renderCard(
          "newsToolbar",
          "slot",
          <div className="studio-news-toolbar-mock">
            <div className="studio-news-categories">
              {["All", "For You", "PC", "Console", "Tech", "Indie", "Deals"].map((cat, i) => (
                <span
                  key={cat}
                  className={`studio-news-cat-tab${i === 0 ? " is-active" : ""}`}
                >
                  {cat}
                </span>
              ))}
            </div>
            <div className="studio-news-toolbar-right">
              <SchematicSearchBar placeholder="Search articles..." />
              <span className="studio-news-density-btn">
                <SlidersHorizontal size={9} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 4. Source Filter Pills */}
      <div className="studio-page-full">
        {renderCard(
          "filters",
          "card",
          <div className="studio-news-sources-mock">
            {["IGN", "PC Gamer", "Eurogamer", "RockPaperShotgun", "Polygon", "Kotaku"].map(
              (src, i) => (
                <span
                  key={src}
                  className={`studio-news-source-pill${i === 0 ? " is-active" : ""}`}
                >
                  <span className="studio-news-source-dot" />
                  <span>{src}</span>
                </span>
              ),
            )}
          </div>,
        )}
      </div>

      {/* 5. News Grid */}
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
                    <span className="studio-news-card-time">{i * 2 + 1}h ago</span>
                    <span className="studio-news-card-save">
                      <Bookmark size={8} />
                    </span>
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
