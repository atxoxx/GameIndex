import { useMemo } from "react";
import {
  Award,
  Clock,
  Crown,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  SchematicSearchBar,
  SchematicSparkline,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

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
      className="studio-page-preview studio-page-preview--achievements"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Achievements Header */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsHeader",
          "slot",
          <div className="studio-ach-header-mock">
            <div className="studio-ach-header-left">
              <Trophy size={13} className="studio-ach-header-icon" />
              <div className="studio-ach-header-text">
                <Line w={45} h={12} />
                <span className="studio-ach-header-badge">
                  1,420 Unlocked · 84% Average Completion
                </span>
              </div>
            </div>
            <div className="studio-ach-header-right">
              <span className="studio-ach-btn">
                <RefreshCw size={9} />
                <span>Sync All</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Hero Showcase Banner */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsHero",
          "slot",
          <div className="studio-ach-hero-mock">
            <div className="studio-ach-hero-ring-block">
              <div className="studio-ach-ring-circle">
                <span className="studio-ach-ring-pct">84%</span>
                <span className="studio-ach-ring-lbl">Completed</span>
              </div>
            </div>
            <div className="studio-ach-hero-stats">
              <div className="studio-ach-kpi">
                <Trophy size={11} className="studio-ach-kpi-icon" />
                <div className="studio-ach-kpi-text">
                  <span className="studio-ach-kpi-val">1,420 / 1,690</span>
                  <span className="studio-ach-kpi-lbl">Total Unlocked</span>
                </div>
              </div>
              <div className="studio-ach-kpi">
                <Sparkles size={11} className="studio-ach-kpi-icon" />
                <div className="studio-ach-kpi-text">
                  <span className="studio-ach-kpi-val">34,250 XP</span>
                  <span className="studio-ach-kpi-lbl">Total Gamerscore</span>
                </div>
              </div>
              <div className="studio-ach-kpi">
                <Crown size={11} className="studio-ach-kpi-icon" />
                <div className="studio-ach-kpi-text">
                  <span className="studio-ach-kpi-val">14 Games</span>
                  <span className="studio-ach-kpi-lbl">100% Perfect</span>
                </div>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Charts: Rarity Distribution & Monthly Activity */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsCharts",
          "card",
          <div className="studio-ach-charts-mock">
            <div className="studio-ach-chart-col">
              <span className="studio-ach-chart-title">Rarity Breakdown</span>
              <div className="studio-ach-rarity-list">
                <div className="studio-ach-rarity-row">
                  <span className="studio-ach-rarity-name">Common</span>
                  <Track value={75} color="var(--color-text-secondary)" />
                  <span className="studio-ach-rarity-val">75%</span>
                </div>
                <div className="studio-ach-rarity-row">
                  <span className="studio-ach-rarity-name">Rare</span>
                  <Track value={22} color="var(--color-brand-cyan, #06b6d4)" />
                  <span className="studio-ach-rarity-val">22%</span>
                </div>
                <div className="studio-ach-rarity-row">
                  <span className="studio-ach-rarity-name">Ultra-Rare</span>
                  <Track value={3} color="var(--color-warning, #f59e0b)" />
                  <span className="studio-ach-rarity-val">3%</span>
                </div>
              </div>
            </div>
            <div className="studio-ach-chart-col">
              <span className="studio-ach-chart-title">Monthly Unlock Activity</span>
              <SchematicSparkline height={46} bars={[15, 30, 45, 60, 25, 80, 55, 90, 70, 85, 95, 100]} />
            </div>
          </div>,
        )}
      </div>

      {/* 4. Source Breakdown */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsSourceBreakdown",
          "card",
          <div className="studio-ach-sources-mock">
            <div className="studio-ach-source-bar" aria-hidden="true">
              <span style={{ width: "68%", background: "var(--color-accent)" }} />
              <span style={{ width: "18%", background: "var(--color-brand-cyan, #06b6d4)" }} />
              <span style={{ width: "14%", background: "var(--color-warning, #f59e0b)" }} />
            </div>
            <div className="studio-ach-source-legend">
              <span className="studio-ach-legend-tag">Steam (965)</span>
              <span className="studio-ach-legend-tag">GOG (255)</span>
              <span className="studio-ach-legend-tag">RetroAchievements (200)</span>
            </div>
          </div>,
        )}
      </div>

      {/* 5. Shelves: Almost Done & Recent Unlocks */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsShelves",
          "card",
          <div className="studio-ach-shelves-mock">
            <div className="studio-ach-shelf-sec">
              <div className="studio-ach-shelf-head">
                <Award size={10} className="studio-ach-shelf-icon" />
                <span className="studio-ach-shelf-title">Almost Done (&ge; 70%)</span>
              </div>
              <div className="studio-ach-shelf-rail">
                {[
                  { name: 60, pct: 92, count: "23/25" },
                  { name: 50, pct: 85, count: "34/40" },
                  { name: 45, pct: 76, count: "19/25" },
                ].map((g, i) => (
                  <div key={i} className="studio-ach-shelf-card">
                    <Line w={g.name} h={10} />
                    <Track value={g.pct} height={4} />
                    <span className="studio-ach-shelf-card-sub">{g.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="studio-ach-shelf-sec">
              <div className="studio-ach-shelf-head">
                <Clock size={10} className="studio-ach-shelf-icon" />
                <span className="studio-ach-shelf-title">Recent Unlocks</span>
              </div>
              <div className="studio-ach-recent-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="studio-ach-recent-item">
                    <span className="studio-ach-recent-badge">
                      <Trophy size={8} />
                    </span>
                    <div className="studio-ach-recent-meta">
                      <Line w={65} h={10} />
                      <Line w={40} />
                    </div>
                    <span className="studio-ach-recent-time">2h ago</span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 6. Achievements Games Leaderboard List */}
      <div className="studio-page-full">
        {renderCard(
          "achievementsList",
          "slot",
          <div className="studio-ach-list-mock">
            <div className="studio-ach-list-toolbar">
              <div className="studio-ach-list-filters">
                <span className="studio-ach-list-select">Status: All</span>
                <span className="studio-ach-list-select">Source: All</span>
              </div>
              <SchematicSearchBar placeholder="Filter games..." />
            </div>
            <div className="studio-ach-game-rows">
              {[
                { name: 65, unlocked: "48 / 48", pct: 100, isPerfect: true },
                { name: 50, unlocked: "38 / 42", pct: 90, isPerfect: false },
                { name: 55, unlocked: "24 / 35", pct: 68, isPerfect: false },
                { name: 40, unlocked: "12 / 30", pct: 40, isPerfect: false },
              ].map((row, i) => (
                <div key={i} className="studio-ach-game-row">
                  <div className="studio-ach-row-cover" />
                  <div className="studio-ach-row-meta">
                    <div className="studio-ach-row-title-row">
                      <Line w={row.name} h={10} />
                      {row.isPerfect && (
                        <span className="studio-ach-perfect-tag">100%</span>
                      )}
                    </div>
                    <Track value={row.pct} color="var(--color-accent)" height={4} />
                  </div>
                  <span className="studio-ach-row-count">{row.unlocked}</span>
                </div>
              ))}
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
