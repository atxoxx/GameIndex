import { useMemo } from "react";
import {
  AlignJustify,
  ArrowRight,
  Bookmark,
  CheckCheck,
  Clock,
  Flame,
  Gamepad2,
  LayoutGrid,
  Newspaper,
  PanelTop,
  RefreshCw,
  Rss,
  Rows3,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, Lines, SchematicSearchBar } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./NewsPagePreview.css";

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
 * Mirrors the shipped structure: header, one control band (four destinations,
 * search, filters and the density radios, plus the topic row the Feed shows),
 * the briefing with its rails, and the card grid with its footer and the
 * empty-state the grid falls back to. There is no hero — the briefing replaced
 * it, and topics are filters inside the Feed.
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

  const tabs: {
    id: string;
    label: string;
    icon: LucideIcon;
    count: number;
    active?: boolean;
  }[] = useMemo(
    () => [
      { id: "overview", label: t("news.tabOverview"), icon: PanelTop, count: 18 },
      { id: "feed", label: t("news.tabFeed"), icon: Newspaper, count: 34, active: true },
      { id: "saved", label: t("news.tabSaved"), icon: Bookmark, count: 6 },
      { id: "history", label: t("news.tabHistory"), icon: Clock, count: 12 },
    ],
    [t],
  );

  const densities: { id: string; label: string; icon: LucideIcon; active?: boolean }[] =
    useMemo(
      () => [
        { id: "cinematic", label: t("news.densityCinematic"), icon: PanelTop },
        { id: "cozy", label: t("news.densityCozy"), icon: LayoutGrid, active: true },
        { id: "compact", label: t("news.densityCompact"), icon: Rows3 },
        { id: "list", label: t("news.densityList"), icon: AlignJustify },
      ],
      [t],
    );

  const topics = useMemo(
    () => [
      { id: "pc", label: t("news.tabPc"), count: 34 },
      { id: "deals", label: t("news.tabDeals"), count: 22 },
      { id: "patches", label: t("news.topicPatches"), count: 12 },
      { id: "reviews", label: t("news.topicReviews"), count: 9 },
    ],
    [t],
  );

  const briefingStats: { id: string; label: string; value: number; icon: LucideIcon; warn?: boolean }[] =
    useMemo(
      () => [
        { id: "unread", label: t("news.statsUnread"), value: 12, icon: Newspaper },
        { id: "saved", label: t("news.statsSaved"), value: 6, icon: Bookmark },
        { id: "feeds", label: t("news.statsFeeds"), value: 9, icon: Rss, warn: true },
      ],
      [t],
    );

  const rails: {
    id: string;
    title: string;
    hint?: string;
    icon: LucideIcon;
    seeAll?: boolean;
  }[] = useMemo(
    () => [
      {
        id: "forYou",
        title: t("news.railForYou"),
        hint: t("news.railForYouHint"),
        icon: Gamepad2,
      },
      { id: "followed", title: t("news.railFollowed"), icon: Sparkles },
      { id: "deals", title: t("news.railDeals"), icon: Flame, seeAll: true },
      { id: "updates", title: t("news.railUpdates"), icon: Wrench, seeAll: true },
      { id: "latest", title: t("news.railLatest"), icon: Newspaper, seeAll: true },
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

  return (
    <div
      className="studio-page-preview studio-page-preview--news"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Header: PageHeader + mark-read / refresh / sources actions */}
      <div className="studio-page-full">
        {renderCard(
          "newsHeader",
          "slot",
          <div className="studio-news-header-mock">
            <div className="studio-news-header-left">
              <Rss size={13} className="studio-news-header-icon" />
              <div className="studio-news-header-text">
                <Line w={20} h={4} />
                <Line w={45} h={12} />
                <Line w={66} h={5} />
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

      {/* 2. Control band: destinations, search, filters, density, topics */}
      <div className="studio-page-full">
        {renderCard(
          "newsToolbar",
          "slot",
          <div className="studio-news-toolbar-mock">
            <div className="studio-news-toolbar-row">
              <div className="studio-news-categories">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <span
                      key={tab.id}
                      className={`studio-news-cat-tab${tab.active ? " is-active" : ""}`}
                    >
                      <Icon size={9} />
                      <span>{tab.label}</span>
                      {tab.count > 0 && (
                        <span className="studio-news-cat-count">{tab.count}</span>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="studio-news-toolbar-right">
                <SchematicSearchBar placeholder={t("news.searchPlaceholder")} />
                <span className="studio-news-btn">
                  <SlidersHorizontal size={9} />
                  <span>{t("news.filtersTitle")}</span>
                </span>
                <span className="studio-news-density">
                  {densities.map((option) => {
                    const Icon = option.icon;
                    return (
                      <span
                        key={option.id}
                        className={option.active ? "is-active" : undefined}
                        title={option.label}
                      >
                        <Icon size={9} />
                      </span>
                    );
                  })}
                </span>
              </div>
            </div>

            <div className="studio-news-topics">
              <span className="studio-news-topic is-active">{t("news.allTopics")}</span>
              {topics.map((topic) => (
                <span key={topic.id} className="studio-news-topic">
                  {topic.label}
                  <span className="studio-news-topic-count">{topic.count}</span>
                </span>
              ))}
            </div>
          </div>,
        )}
      </div>

      {/* 3. Briefing: lead block, stat band and the story rails */}
      <div className="studio-page-full">
        {renderCard(
          "newsOverview",
          "slot",
          <div className="studio-news-overview">
            <div className="studio-news-briefing">
              <div className="studio-news-briefing-lead">
                <span className="studio-news-briefing-eyebrow">
                  <Sparkles size={9} aria-hidden="true" />
                  {t("news.sinceLastVisit")}
                </span>
                <strong>18</strong>
                <span className="studio-news-briefing-hint">
                  {t("news.newStoriesHint", { count: 18 })}
                </span>
                <span className="studio-news-briefing-cta">
                  {t("news.catchUp")}
                  <ArrowRight size={9} aria-hidden="true" />
                </span>
              </div>
              <div className="studio-news-briefing-stats">
                {briefingStats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <span key={stat.id} className="studio-news-briefing-stat">
                      <Icon size={9} aria-hidden="true" />
                      <span className="studio-schematic-kpi-val">{stat.value}</span>
                      <span>{stat.label}</span>
                      {stat.warn && (
                        <span
                          className="studio-news-briefing-warn"
                          title={t("news.failedFeedsWarningShort", { count: 1 })}
                        >
                          <TriangleAlert size={8} aria-hidden="true" />1
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="studio-news-rails">
              {rails.map((rail) => {
                const Icon = rail.icon;
                return (
                  <div key={rail.id} className="studio-news-rail">
                    <div className="studio-news-rail-head">
                      <Icon size={9} aria-hidden="true" />
                      <span className="studio-news-rail-heading">
                        <span className="studio-news-rail-title">{rail.title}</span>
                        {rail.hint && (
                          <span className="studio-news-rail-sub">{rail.hint}</span>
                        )}
                      </span>
                      {rail.seeAll && (
                        <span className="studio-news-rail-seeall">{t("news.seeAll")}</span>
                      )}
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
                );
              })}
            </div>
          </div>,
        )}
      </div>

      {/* 4. Grid: cards, result footer, and the empty state it falls back to */}
      <div className="studio-page-full">
        {renderCard(
          "newsGrid",
          "slot",
          <div className="studio-news-grid-stack">
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
                      <Bookmark size={9} className="studio-news-card-save" aria-hidden="true" />
                    </div>
                    <Line w={90} h={10} />
                    <Line w={65} h={10} />
                    <Lines ws={[80, 50]} />
                  </div>
                </div>
              ))}
            </div>

            <div className="studio-news-grid-footer">
              <span>{t("news.ofArticles", { visible: 4, total: 48 })}</span>
              <span className="studio-news-btn">{t("news.loadMore")}</span>
            </div>

            <div className="studio-news-empty-mock">
              <Rss size={13} className="studio-news-empty-icon" aria-hidden="true" />
              <span className="studio-news-empty-text">
                <strong>{t("news.noArticles")}</strong>
                <span>{t("news.noArticlesSources")}</span>
              </span>
              <span className="studio-news-btn">{t("news.manageSources")}</span>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
