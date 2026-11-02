import { useMemo } from "react";
import {
  AlignJustify,
  ArrowDownUp,
  CircleDollarSign,
  Clock3,
  Columns2,
  Gamepad2,
  Gift,
  Heart,
  LayoutDashboard,
  LayoutGrid,
  MonitorPlay,
  PanelTop,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicCardRail,
  SchematicSearchBar,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./DealsPagePreview.css";

export interface DealsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

type DealsPreviewRail = {
  id: string;
  title: string;
  count: number;
  icon: LucideIcon;
  variant: "standard" | "sale";
};

/**
 * Layout-studio preview for the deals page.
 *
 * Mirrors the current page: a header, a sticky band holding the five source
 * tabs plus the shared per-source toolbar, and one results widget (the
 * Overview landing state: stat band and the six rails). The overview/panel
 * swap happens inside that results widget, so the tabs and the toolbar belong
 * to their own band above it — not inside the results card.
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

  const tabs: { id: string; label: string; icon: LucideIcon; count: number | null }[] =
    useMemo(
      () => [
        { id: "overview", label: t("deals.overview"), icon: LayoutDashboard, count: null },
        { id: "deals", label: t("deals.storeDeals"), icon: CircleDollarSign, count: 412 },
        { id: "gamepass", label: t("deals.gamepassShort"), icon: Gamepad2, count: 38 },
        { id: "giveaways", label: t("deals.freeGames"), icon: Gift, count: 6 },
        {
          id: "playtester",
          label: t("deals.overviewPlaytests"),
          icon: MonitorPlay,
          count: 24,
        },
      ],
      [t],
    );

  const density: { id: string; label: string; icon: LucideIcon; active?: boolean }[] =
    useMemo(
      () => [
        { id: "compact", label: t("density.compact"), icon: LayoutGrid },
        { id: "cozy", label: t("density.cozy"), icon: Columns2, active: true },
        { id: "cinematic", label: t("density.cinematic"), icon: PanelTop },
        { id: "list", label: t("density.list"), icon: AlignJustify },
      ],
      [t],
    );

  const stats: { id: string; label: string; value: number; icon: LucideIcon }[] = useMemo(
    () => [
      { id: "deals", label: t("deals.overviewDeals"), value: 412, icon: CircleDollarSign },
      { id: "free", label: t("deals.freeRightNow"), value: 6, icon: Gift },
      { id: "gamepass", label: t("deals.overviewGamePass"), value: 38, icon: Gamepad2 },
      {
        id: "playtests",
        label: t("deals.overviewPlaytests"),
        value: 24,
        icon: MonitorPlay,
      },
    ],
    [t],
  );

  const rails = useMemo<DealsPreviewRail[]>(
    () => [
      {
        id: "best",
        title: t("deals.bestDiscounts"),
        count: 24,
        icon: Sparkles,
        variant: "sale",
      },
      { id: "free", title: t("deals.freeRightNow"), count: 6, icon: Gift, variant: "standard" },
      { id: "ending", title: t("deals.endingSoon"), count: 4, icon: Clock3, variant: "standard" },
      {
        id: "wishlist",
        title: t("deals.wishlistOnSale"),
        count: 9,
        icon: Heart,
        variant: "sale",
      },
      {
        id: "gamepass",
        title: t("deals.newOnGamePass"),
        count: 12,
        icon: Gamepad2,
        variant: "standard",
      },
      {
        id: "playtests",
        title: t("deals.playtestsToTry"),
        count: 5,
        icon: MonitorPlay,
        variant: "standard",
      },
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
                <Line w={20} h={4} />
                <Line w={45} h={12} />
                <Line w={68} h={5} />
              </div>
            </div>
            <div className="studio-deals-header-right">
              <span className="studio-deals-header-pill">
                <RefreshCw size={9} />
                <span>{t("common.refresh")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Sticky band: source tabs + the shared per-source toolbar */}
      <div className="studio-page-full">
        {renderCard(
          "subtabs",
          "slot",
          <div className="studio-deals-band">
            <div className="studio-deals-subtabs-mock">
              {tabs.map((tab, i) => {
                const Icon = tab.icon;
                return (
                  <span
                    key={tab.id}
                    className={`studio-deals-subtab${i === 0 ? " is-active" : ""}`}
                  >
                    <Icon size={10} />
                    <span>{tab.label}</span>
                    {tab.count !== null && (
                      <span className="studio-deals-subtab-count">{tab.count}</span>
                    )}
                  </span>
                );
              })}
            </div>

            <div className="studio-deals-toolbar-mock">
              <SchematicSearchBar placeholder={t("deals.searchPlaceholder")} />
              <div className="studio-deals-toolbar-controls">
                <span className="studio-deals-header-pill">
                  <ArrowDownUp size={9} />
                  <span>{t("deals.sortBy")}</span>
                  <b className="studio-deals-pill-value">{t("deals.sortDiscountDesc")}</b>
                </span>
                <span className="studio-deals-header-pill">
                  <SlidersHorizontal size={9} />
                  <span>{t("deals.filters")}</span>
                </span>
                <span className="studio-deals-density">
                  {density.map((option) => {
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
                <span className="studio-deals-header-pill">
                  <RefreshCw size={9} />
                </span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Results widget: Overview stat band + rails */}
      <div className="studio-page-full">
        {renderCard(
          "dealsGrid",
          "slot",
          <div className="studio-deals-overview">
            <div className="studio-deals-overview-stats">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <span key={stat.id} className="studio-deals-stat">
                    <span className="studio-deals-stat__label">
                      <Icon size={9} aria-hidden="true" />
                      {stat.label}
                    </span>
                    <span className="studio-deals-stat__value">{stat.value}</span>
                  </span>
                );
              })}
            </div>

            {rails.map((rail) => {
              const Icon = rail.icon;
              return (
                <div key={rail.id} className="studio-deals-rail">
                  <div className="studio-deals-rail__head">
                    <span className="studio-deals-rail__title">
                      <span className="studio-deals-rail__icon">
                        <Icon size={10} aria-hidden="true" />
                      </span>
                      {rail.title}
                      <span className="studio-deals-rail__count">{rail.count}</span>
                    </span>
                    <span className="studio-deals-rail__more">{t("deals.seeAll")}</span>
                  </div>
                  <SchematicCardRail variant={rail.variant} count={3} />
                </div>
              );
            })}
          </div>,
        )}
      </div>
    </div>
  );
}
