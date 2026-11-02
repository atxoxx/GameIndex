import { useMemo } from "react";
import {
  Award,
  Clock,
  Crown,
  Gamepad2,
  LayoutGrid,
  List,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import { Line, MiniTile, SchematicSearchBar, SchematicSparkline, Track } from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./AchievementsPagePreview.css";

export interface AchievementsPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function AchievementsPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: AchievementsPagePreviewProps) {
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

  // Rarity tiers in the shipped order, with the share of all achievements and
  // the per-tier unlock progress the real chart shows.
  const rarityTiers = [
    {
      key: "ultra_rare",
      seg: "ultra",
      name: t("achievementsPage.rarity.ultra_rare"),
      share: 6,
      pct: 22,
      unlocked: 22,
      total: 101,
      color: "var(--color-warning)",
    },
    {
      key: "rare",
      seg: "rare",
      name: t("achievementsPage.rarity.rare"),
      share: 14,
      pct: 48,
      unlocked: 114,
      total: 237,
      color: "var(--color-accent)",
    },
    {
      key: "uncommon",
      seg: "uncommon",
      name: t("achievementsPage.rarity.uncommon"),
      share: 25,
      pct: 71,
      unlocked: 300,
      total: 423,
      color: "var(--color-info)",
    },
    {
      key: "common",
      seg: "common",
      name: t("achievementsPage.rarity.common"),
      share: 55,
      pct: 92,
      unlocked: 855,
      total: 929,
      color: "var(--color-text-secondary)",
    },
  ];

  const sources = [
    { key: "steam", count: 965, share: 62, color: "var(--color-accent)" },
    { key: "retro", count: 200, share: 13, color: "var(--color-info)" },
    { key: "manual", count: 68, share: 6, color: "var(--color-success)" },
    { key: "gog", count: 230, share: 15, color: "var(--color-warning)" },
    { key: "epic", count: 28, share: 4, color: "var(--color-text-secondary)" },
  ];

  const catalogGames = [
    { name: 65, pct: 100, unlocked: 48, total: 48, points: "1,000/1,000", perfect: true },
    { name: 50, pct: 90, unlocked: 38, total: 42, points: "820/900", perfect: false },
    { name: 55, pct: 68, unlocked: 24, total: 35, points: "540/780", perfect: false },
    { name: 40, pct: 40, unlocked: 12, total: 30, points: "260/640", perfect: false },
  ];

  return (
    <div
      className="studio-page-preview studio-page-preview--achievements"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header: trophy glyph, eyebrow, title + the Sync All action */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsHeader",
          "slot",
          <div className="studio-ach-header-mock">
            <div className="studio-ach-header-left">
              <Trophy size={13} className="studio-ach-header-icon" />
              <div className="studio-ach-header-text">
                <span className="studio-ach-header-eyebrow">
                  {t("achievementsPage.yourProgress")}
                </span>
                <Line w={40} h={12} />
              </div>
            </div>
            <div className="studio-ach-header-right">
              <span className="studio-ach-btn">
                <RefreshCw size={9} />
                <span>{t("achievementsPage.syncAll")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Gamerscore banner + the five summary KPI tiles */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsHero",
          "slot",
          <div className="studio-ach-hero-panel">
            <div className="studio-ach-score-banner">
              <div className="studio-ach-score-left">
                <span className="studio-ach-score-icon">
                  <Award size={16} />
                </span>
                <span className="studio-ach-score-info">
                  <span className="studio-ach-score-eyebrow">
                    {t("achievementsPage.gamerscoreTitle")}
                  </span>
                  <span className="studio-ach-score-row">
                    <span className="studio-ach-score-earned">34,250</span>
                    <span className="studio-ach-score-divider">/</span>
                    <span className="studio-ach-score-total">
                      41,000 {t("achievementsPage.pointsShort")}
                    </span>
                  </span>
                </span>
              </div>
              <div className="studio-ach-score-bar-wrap">
                <div className="studio-ach-score-bar-head">
                  <span>{t("achievementsPage.totalPointsProgress")}</span>
                  <span className="studio-ach-score-pct">84%</span>
                </div>
                <Track value={84} />
              </div>
            </div>

            <div className="studio-ach-kpi-grid">
              <MiniTile label={t("achievementsPage.unlocked")} value="1,291" icon={Trophy} />
              <MiniTile label={t("achievementsPage.total")} value="1,690" icon={Target} />
              <MiniTile label={t("achievementsPage.completion")} value="76%" icon={Sparkles} />
              <MiniTile label={t("achievementsPage.perfectGames")} value="14" icon={Crown} />
              <MiniTile
                label={t("achievementsPage.avgCompletion")}
                value="72%"
                icon={TrendingUp}
              />
            </div>
          </div>,
        )}
      </div>

      {/* 3. The `dashboard` widget: charts, source breakdown and shelves share
       *  one PageWidget on the real page, so they keep one group here. */}
      <div className="studio-page-full">
        <div className="studio-ach-dashboard">
          <span className="studio-ach-dashboard-head">
            <LayoutGrid size={10} />
            <span>{t("settings.interface.widgetDashboard")}</span>
          </span>

          {/* 3a. Rarity distribution + monthly unlock activity */}
          {renderCard(
            "achievementsCharts",
            "card",
            <div className="studio-ach-charts-mock">
              <div className="studio-ach-panel">
                <div className="studio-ach-panel-head">
                  <Sparkles size={10} className="studio-ach-panel-icon" />
                  <span>{t("achievementsPage.rarityDistribution")}</span>
                  <span className="studio-ach-panel-sub">
                    {t("achievementsPage.raritySubtitle")}
                  </span>
                </div>
                <div className="studio-ach-rarity-bar" aria-hidden="true">
                  {rarityTiers.map((tier) => (
                    <span
                      key={tier.key}
                      className={`studio-ach-rarity-seg studio-ach-rarity-seg--${tier.seg}`}
                      style={{ width: `${tier.share}%` }}
                    />
                  ))}
                </div>
                <div className="studio-ach-rarity-cards">
                  {rarityTiers.map((tier) => (
                    <div key={tier.key} className="studio-ach-rarity-card">
                      <div className="studio-ach-rarity-card-top">
                        <span>{tier.name}</span>
                        <span className="studio-ach-rarity-card-pct">{tier.pct}%</span>
                      </div>
                      <Track value={tier.pct} height={4} color={tier.color} />
                      <span className="studio-ach-panel-sub">
                        {tier.unlocked} {t("common.of")} {tier.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="studio-ach-panel">
                <div className="studio-ach-panel-head">
                  <TrendingUp size={10} className="studio-ach-panel-icon" />
                  <span>{t("achievementsPage.unlockActivity")}</span>
                  <span className="studio-ach-panel-sub">
                    {t("achievementsPage.recentUnlocksCount", { count: 214 })} · Ø 36 /{" "}
                    {t("activity.1m").toLowerCase()}
                  </span>
                </div>
                <SchematicSparkline
                  height={46}
                  bars={[15, 30, 45, 60, 25, 80, 55, 90, 70, 100, 65, 85]}
                />
                <div className="studio-ach-activity-foot">
                  <span>
                    {t("charts.average")}: Ø 36
                  </span>
                  <span>★ 118</span>
                </div>
              </div>
            </div>,
          )}

          {/* 3b. Achievements by source: stacked bar + legend/filter */}
          {renderCard(
            "achievementsSourceBreakdown",
            "card",
            <div className="studio-ach-panel">
              <div className="studio-ach-panel-head">
                <Gamepad2 size={10} className="studio-ach-panel-icon" />
                <span>{t("achievementsPage.achievementsBySource")}</span>
              </div>
              <div className="studio-ach-sources-mock">
                <div className="studio-ach-source-bar" aria-hidden="true">
                  {sources.map((source) => (
                    <span
                      key={source.key}
                      style={{ width: `${source.share}%`, background: source.color }}
                    />
                  ))}
                </div>
                <div className="studio-ach-legend-wrap">
                  {sources.map((source, index) => (
                    <span
                      key={source.key}
                      className={`studio-ach-legend-tag${index === 0 ? " is-active" : ""}`}
                    >
                      {t(`achievements.source.${source.key}`)} ({source.count})
                    </span>
                  ))}
                </div>
              </div>
            </div>,
          )}

          {/* 3c. Almost Done rail above the Recent Unlocks feed */}
          {renderCard(
            "achievementsShelves",
            "card",
            <div className="studio-ach-shelves">
              <div className="studio-ach-shelf-sec">
                <div className="studio-ach-shelf-head">
                  <Clock size={10} className="studio-ach-shelf-icon" />
                  <span className="studio-ach-shelf-title">
                    {t("achievementsPage.almostDoneTitle")}
                  </span>
                </div>
                <span className="studio-ach-shelf-sub">
                  {t("achievementsPage.almostDoneSubtitle")}
                </span>
                <div className="studio-ach-shelf-rail">
                  {[
                    { name: 60, pct: 92, remaining: 2 },
                    { name: 50, pct: 85, remaining: 6 },
                    { name: 45, pct: 76, remaining: 6 },
                  ].map((game, i) => (
                    <div key={i} className="studio-ach-shelf-card">
                      <div className="studio-ach-shelf-card-top">
                        <span className="studio-ach-row-cover" />
                        <Line w={55} h={8} />
                        <span className="studio-ach-source-tag">
                          {t("achievements.source.steam")}
                        </span>
                      </div>
                      <Track value={game.pct} height={4} />
                      <div className="studio-ach-shelf-card-foot">
                        <span>{game.pct}%</span>
                        <span>
                          {t("achievementsPage.remainingCount", { count: game.remaining })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="studio-ach-shelf-sec">
                <div className="studio-ach-shelf-head">
                  <RefreshCw size={10} className="studio-ach-shelf-icon" />
                  <span className="studio-ach-shelf-title">
                    {t("achievementsPage.recentUnlocks")}
                  </span>
                </div>
                <span className="studio-ach-shelf-sub">
                  {t("achievementsPage.recentUnlocksSubtitle")}
                </span>
                <div className="studio-ach-recent-grid">
                  {[
                    { pct: "8.6%", ago: "2h" },
                    { pct: "14.2%", ago: "5h" },
                    { pct: "22.9%", ago: "1d" },
                    { pct: "3.4%", ago: "2d" },
                  ].map((unlock, i) => (
                    <div key={i} className="studio-ach-recent-card">
                      <div className="studio-ach-recent-top">
                        <span className="studio-ach-recent-icon">
                          <Trophy size={9} />
                        </span>
                        <Line w={68} h={8} />
                        <span className="studio-ach-recent-pill">{unlock.pct}</span>
                      </div>
                      <Line w={45} />
                      <div className="studio-ach-recent-foot">
                        <Clock size={8} />
                        <span>{unlock.ago}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>,
          )}
        </div>
      </div>

      {/* 4. Games catalog: section header + view toggle, filter toolbar, grid */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsList",
          "slot",
          <div className="studio-ach-list-mock">
            <div className="studio-ach-list-head">
              <span className="studio-ach-list-title-group">
                <Gamepad2 size={10} />
                <span>{t("achievementsPage.games")}</span>
                <span className="studio-ach-list-count">(38)</span>
              </span>
              <span className="studio-ach-view-toggle">
                <span
                  className="studio-ach-view-btn is-active"
                  title={t("achievementsPage.viewGrid")}
                >
                  <LayoutGrid size={10} />
                </span>
                <span className="studio-ach-view-btn" title={t("achievementsPage.viewList")}>
                  <List size={10} />
                </span>
              </span>
            </div>

            <div className="studio-ach-toolbar">
              <span className="studio-ach-filter">
                {t("library.filter.status")}: {t("common.all")}
              </span>
              <span className="studio-ach-filter">
                {t("library.filter.source")}: {t("achievements.source.all")}
              </span>
              <SchematicSearchBar placeholder={t("achievements.searchPlaceholder")} />
              <span className="studio-ach-filter">
                {t("achievementsPage.sort")} {t("achievementsPage.completionPct")}
              </span>
            </div>

            <div className="studio-ach-games-grid">
              {catalogGames.map((game, i) => (
                <div
                  key={i}
                  className={`studio-ach-game-card${game.perfect ? " is-perfect" : ""}`}
                >
                  <div className="studio-ach-card-cover" />
                  <div className="studio-ach-card-name-row">
                    <Line w={game.name} h={8} />
                    {game.perfect && <span className="studio-ach-perfect-tag">100%</span>}
                  </div>
                  <Track value={game.pct} height={4} color="var(--color-accent)" />
                  <div className="studio-ach-card-meta">
                    <span>
                      {game.unlocked}/{game.total}
                    </span>
                    <span>{game.points} pts</span>
                  </div>
                  <div className="studio-ach-card-rarity">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
