import { useMemo } from "react";
import {
  Activity,
  Award,
  BarChart3,
  BookmarkPlus,
  Calendar,
  ChevronDown,
  ChevronLeft,
  Clock,
  Coins,
  Download,
  Flame,
  Gamepad2,
  LayoutGrid,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicDonut,
  SchematicSparkline,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";
import "./ActivityPagePreview.css";

export interface ActivityPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function ActivityPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: ActivityPagePreviewProps) {
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

  // The rail is ranked by playtime in the range; the first row is the
  // "All games" reset, exactly like the real ActivityGameRail.
  const railGames = [
    { name: 62, hours: "142h", share: 100 },
    { name: 48, hours: "98h", share: 69 },
    { name: 55, hours: "64h", share: 45 },
    { name: 40, hours: "42h", share: 30 },
    { name: 34, hours: "21h", share: 15 },
  ];

  const timeOfDay = [
    { label: t("activityInsights.daypart.morning"), value: 12 },
    { label: t("activityInsights.daypart.afternoon"), value: 18 },
    { label: t("activityInsights.daypart.evening"), value: 28 },
    { label: t("activityInsights.daypart.night"), value: 42 },
  ];

  const sessionBuckets = [
    { label: t("activityInsights.sessionBucket.quick"), value: 18 },
    { label: t("activityInsights.sessionBucket.short"), value: 22 },
    { label: t("activityInsights.sessionBucket.medium"), value: 30 },
    { label: t("activityInsights.sessionBucket.long"), value: 20 },
    { label: t("activityInsights.sessionBucket.marathon"), value: 10 },
  ];

  const weekdays = [
    { label: t("activityDash.mon"), value: 60 },
    { label: t("activityDash.tue"), value: 45 },
    { label: t("activityDash.wed"), value: 30 },
    { label: t("activityDash.thu"), value: 55 },
    { label: t("activityDash.fri"), value: 70 },
    { label: t("activityDash.sat"), value: 100 },
    { label: t("activityDash.sun"), value: 85 },
  ];

  return (
    <div
      className="studio-page-preview studio-page-preview--activity"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Page header: eyebrow, title, all-time description + action cluster */}
      <div className="studio-page-full">
        {renderCard(
          "activityHeader",
          "slot",
          <div className="studio-act-header-mock">
            <div className="studio-act-header-left">
              <Activity size={13} className="studio-act-header-icon" />
              <div className="studio-act-header-text">
                <span className="studio-act-header-eyebrow">{t("activity.eyebrow")}</span>
                <Line w={32} h={12} />
                <span className="studio-act-header-badge">
                  {t("activityWs.header.description", {
                    sessions: 114,
                    games: 38,
                    time: "428h",
                  })}
                </span>
              </div>
            </div>
            <div className="studio-act-header-actions">
              <span className="studio-act-btn studio-act-btn--primary">
                <Plus size={9} />
                <span>{t("activityWs.actions.logSession")}</span>
              </span>
              <span className="studio-act-btn">
                <Download size={9} />
                <span>{t("activityWs.export.menu")}</span>
              </span>
              <span className="studio-act-btn studio-act-btn--icon">
                <MoreHorizontal size={10} />
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Toolbar: view tabs above, the shared scope strip below */}
      <div className="studio-page-full">
        {renderCard(
          "activityToolbar",
          "slot",
          <div className="studio-act-toolbar-mock studio-act-toolbar-mock--stacked">
            <div className="studio-act-toolbar-tabs">
              <span className="studio-act-pill is-active">{t("activity.tab.dashboard")}</span>
              <span className="studio-act-pill">
                {t("activity.tab.sessions")}
                <i className="studio-act-pill__count">114</i>
              </span>
              <span className="studio-act-pill">
                {t("activity.tab.performance")}
                <i className="studio-act-pill__count">68</i>
              </span>
              <span className="studio-act-pill">{t("activity.tab.wrapped")}</span>
            </div>
            <div className="studio-act-scope-row">
              <span className="studio-act-select">{t("activity.range")}</span>
              <span className="studio-act-pill">{t("activity.7d")}</span>
              <span className="studio-act-pill is-active">{t("activity.30d")}</span>
              <span className="studio-act-pill">{t("activity.90d")}</span>
              <span className="studio-act-pill">{t("activity.allTime")}</span>
              <span className="studio-act-pill studio-act-pill--icon">
                <Calendar size={9} />
                <span>{t("activityWs.scope.custom")}</span>
              </span>
              <span className="studio-act-select">
                {t("activityPage.source")}: {t("activityWs.scope.allSources")}
              </span>
              <span className="studio-act-select">
                {t("activityWs.scope.game")}: {t("activityWs.scope.allGames")}
              </span>
              <span className="studio-act-btn">
                <BookmarkPlus size={9} />
                <span>{t("activityWs.scope.views")}</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 3. KPI band: five period figures plus the weekly goal ring */}
      <div className="studio-page-full">
        {renderCard(
          "activityKpis",
          "slot",
          <div className="studio-act-kpi-row">
            <div className="studio-detail-kpi-tiles">
              <MiniTile label={t("activityDash.totalPlaytime")} value="428h" icon={Clock} />
              <MiniTile label={t("activityDash.gamesPlayed")} value="38" icon={Gamepad2} />
              <MiniTile label={t("activityDash.averagePerDay")} value="2.4h" icon={TrendingUp} />
              <MiniTile label={t("activityDash.sessions")} value="114" icon={Calendar} />
              <MiniTile label={t("activityDash.longestStreak")} value="12d" icon={Zap} />
            </div>
            <div className="studio-act-goal-mock">
              <span className="studio-act-goal-ring">
                <span>64%</span>
              </span>
              <span className="studio-act-goal-copy">
                <span className="studio-act-goal-label">{t("activityWs.goal.week")}</span>
                <span className="studio-act-goal-value">
                  {t("activityWs.goal.remaining", { time: "3h 35m" })}
                </span>
                <span className="studio-act-goal-hint">
                  {t("activityWs.goal.progress", { minutes: "6h 25m", target: "10h" })}
                </span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 4. Playtime chart with the ranked game rail and the chart controls */}
      <div className="studio-page-full">
        {renderCard(
          "activityChart",
          "card",
          <div className="studio-act-chart-split">
            <div className="studio-act-chart-sidebar">
              <div className="studio-act-rail-head">
                <span className="studio-act-rail-head-title">
                  <LayoutGrid size={9} className="studio-act-rail-icon" />
                  <span>{t("activityWs.rail.title")}</span>
                </span>
                <span className="studio-act-rail-head-count">
                  {t("activityWs.rail.played", { count: 38 })}
                </span>
                <ChevronLeft size={9} className="studio-act-rail-menu" />
              </div>
              <div className="studio-act-rail-row is-active">
                <LayoutGrid size={10} className="studio-act-rail-icon" />
                <span className="studio-act-rail-meta">
                  <Line w={52} h={8} />
                  <Line w={72} />
                </span>
                <span className="studio-act-game-time">38</span>
              </div>
              {railGames.map((game, i) => (
                <div key={i} className="studio-act-rail-row">
                  <span className="studio-act-rail-cover" />
                  <span className="studio-act-rail-meta">
                    <Line w={game.name} h={8} />
                    <Track value={game.share} height={3} />
                  </span>
                  <span className="studio-act-game-time">{game.hours}</span>
                  <MoreHorizontal size={9} className="studio-act-rail-menu" />
                </div>
              ))}
            </div>

            <div className="studio-act-chart-main">
              <div className="studio-act-chart-top">
                <div className="studio-act-chart-title">
                  <TrendingUp size={11} />
                  <span>{t("activityWs.overview.chartTitle")}</span>
                </div>
                <span className="studio-act-chart-total">428h</span>
              </div>
              <p className="studio-act-chart-sub">
                {t("activityWs.overview.chartSub", { time: "428h" })}
              </p>
              <div className="studio-act-chart-tools">
                <span className="studio-act-tool-group">
                  <span className="studio-act-mode-btn is-active">
                    {t("activityDash.modePeriodic")}
                  </span>
                  <span className="studio-act-mode-btn">{t("activityDash.modeCumulative")}</span>
                </span>
                <span className="studio-act-tool-group">
                  <span className="studio-act-mode-btn is-active">
                    {t("activityWs.overview.daily")}
                  </span>
                  <span className="studio-act-mode-btn">{t("activityWs.overview.weekly")}</span>
                  <span className="studio-act-mode-btn">{t("activityWs.overview.monthly")}</span>
                </span>
                <span className="studio-act-tool-group">
                  <span
                    className="studio-act-mode-btn studio-act-mode-btn--icon is-active"
                    title={t("activity.barChart")}
                  >
                    <BarChart3 size={10} />
                  </span>
                  <span
                    className="studio-act-mode-btn studio-act-mode-btn--icon"
                    title={t("activity.lineChart")}
                  >
                    <TrendingUp size={10} />
                  </span>
                </span>
              </div>
              <SchematicSparkline height={54} bars={[30, 45, 60, 20, 80, 95, 40, 70, 85, 50, 65, 100]} />
            </div>
          </div>,
        )}
      </div>

      {/* 5. Insights: time of day, session lengths and the weekly rhythm */}
      <div className="studio-page-full">
        {renderCard(
          "activityInsights",
          "card",
          <div className="studio-act-panels">
            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Clock size={10} className="studio-act-panel-icon" />
                <span>{t("activityInsights.timeOfDayTitle")}</span>
              </span>
              <div className="studio-act-dist-bars">
                {timeOfDay.map((slot) => (
                  <div key={slot.label} className="studio-act-dist-row">
                    <span className="studio-act-dist-name">{slot.label}</span>
                    <Track value={slot.value} />
                    <span className="studio-act-dist-pct">{slot.value}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Target size={10} className="studio-act-panel-icon" />
                <span>{t("activityInsights.sessionLengthsTitle")}</span>
              </span>
              <div className="studio-act-dist-bars">
                {sessionBuckets.map((bucket) => (
                  <div key={bucket.label} className="studio-act-dist-row">
                    <span className="studio-act-dist-name">{bucket.label}</span>
                    <Track value={bucket.value} color="var(--color-info)" />
                    <span className="studio-act-dist-pct">{bucket.value}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Calendar size={10} className="studio-act-panel-icon" />
                <span>{t("activityInsights.dayOfWeekTitle")}</span>
              </span>
              <div className="studio-act-dow-bars">
                {weekdays.map((day, i) => (
                  <div
                    key={day.label}
                    className={`studio-act-dow-col${i >= 5 ? " is-weekend" : ""}`}
                  >
                    <span className="studio-act-dow-track">
                      <i className="studio-act-dow-bar" style={{ height: `${day.value}%` }} />
                    </span>
                    <span className="studio-act-dow-label">{day.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 6. Personal records strip above the milestone ladders */}
      <div className="studio-page-full">
        {renderCard(
          "activityRecords",
          "card",
          <div className="studio-act-records-layout">
            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Award size={10} className="studio-act-panel-icon" />
                <span>{t("activityInsights.records")}</span>
              </span>
              <div className="studio-act-records-mock">
                <div className="studio-act-record-cell">
                  <Clock size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">6h 12m</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.longestSession")}
                    </span>
                  </div>
                </div>
                <div className="studio-act-record-cell">
                  <Calendar size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">7h 40m</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.biggestDay")}
                    </span>
                  </div>
                </div>
                <div className="studio-act-record-cell">
                  <Gamepad2 size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">4 games</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.mostGamesDay")}
                    </span>
                  </div>
                </div>
                <div className="studio-act-record-cell">
                  <Zap size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">21:00</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.mostActiveHour")}
                    </span>
                  </div>
                </div>
                <div className="studio-act-record-cell">
                  <Target size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">142h</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.topGame")}
                    </span>
                  </div>
                </div>
                <div className="studio-act-record-cell">
                  <Flame size={11} className="studio-act-record-icon" />
                  <div className="studio-act-record-text">
                    <span className="studio-act-record-val">61%</span>
                    <span className="studio-act-record-lbl">
                      {t("activityInsights.record.topGenre")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="studio-act-panel">
              <div className="studio-act-milestones-mock">
                <div className="studio-act-milestones-head">
                  <Award size={10} className="studio-act-panel-icon" />
                  <span>{t("activityInsights.milestones")}</span>
                  <span className="studio-act-milestones-count">
                    {t("activityInsights.milestones.count", { earned: 8, total: 18 })}
                  </span>
                  <ChevronDown size={10} />
                </div>
                <Track value={44} />
                <div className="studio-act-milestones-chips">
                  {[
                    { Icon: Clock, label: "100h" },
                    { Icon: Flame, label: "250" },
                    { Icon: Award, label: "20" },
                    { Icon: Zap, label: "14d" },
                    { Icon: Target, label: "5h" },
                    { Icon: Calendar, label: "90d" },
                  ].map(({ Icon, label }) => (
                    <span key={label} className="studio-act-milestone-chip">
                      <Icon size={9} />
                      <span>{label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 7. Persona + library value beside the backlog hub (no game scoped) */}
      <div className="studio-act-lower-row">
        <div className="studio-act-lower-side">
          {renderCard(
            "activityPersona",
            "card",
            <div className="studio-act-persona-mock">
              <div className="studio-act-persona-avatar">
                <Moon size={16} />
              </div>
              <div className="studio-act-persona-info">
                <span className="studio-act-persona-eyebrow">
                  {t("activityInsights.persona.badge")}
                </span>
                <span className="studio-act-persona-name">
                  {t("activityInsights.persona.nightOwl.title")}
                </span>
                <p className="studio-act-persona-desc">
                  {t("activityInsights.persona.nightOwl.desc")}
                </p>
              </div>
              <div className="studio-act-persona-highlight">
                <span className="studio-act-persona-highlight-label">{t("activityInsights.peak")}</span>
                <span className="studio-act-persona-highlight-val">42%</span>
              </div>
            </div>,
          )}

          {renderCard(
            "activityValue",
            "card",
            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Coins size={10} className="studio-act-panel-icon" />
                <span>{t("activityWs.overview.value")}</span>
              </span>
              <div className="studio-act-value-mock">
                <div className="studio-act-value-fig">
                  <span className="studio-act-value-label">{t("activityDash.totalSpend")}</span>
                  <span className="studio-act-value-num">$2,480</span>
                  <span className="studio-act-value-hint">
                    {t("activityDash.pricedGames", { n: 96 })}
                  </span>
                </div>
                <div className="studio-act-value-fig">
                  <span className="studio-act-value-label">
                    {t("activityDash.costPerHourAvg")}
                  </span>
                  <span className="studio-act-value-num">$1.42</span>
                  <span className="studio-act-value-hint">
                    {t("activityDash.worstValue", { name: "Cyberpunk 2077" })}
                  </span>
                </div>
              </div>
            </div>,
          )}
        </div>

        {renderCard(
          "activityBacklog",
          "card",
          <div className="studio-act-backlog-cards">
            {[
              { name: 62, time: "18h", target: "42h", pct: 43, badge: "~9d" },
              { name: 48, time: "31h", target: "26h", pct: 78, badge: "~3d" },
              { name: 55, time: "9h", target: "15h", pct: 61, badge: "~12d" },
            ].map((card, i) => (
              <div key={i} className="studio-act-backlog-card">
                <div className="studio-act-backlog-card-head">
                  <span className="studio-act-backlog-cover" />
                  <span className="studio-act-backlog-meta">
                    <Line w={card.name} h={8} />
                    <span className="studio-act-backlog-sub">
                      {card.time} · {card.target} {t("activityBacklog.target")}
                    </span>
                  </span>
                  <Play size={10} className="studio-act-backlog-play" />
                </div>
                <Track value={card.pct} height={4} />
                <div className="studio-act-backlog-foot">
                  <span>{card.pct}%</span>
                  <span className="studio-act-backlog-badge">
                    {card.badge} {t("activityBacklog.toFinish")}
                  </span>
                </div>
              </div>
            ))}
          </div>,
        )}
      </div>

      {/* 8. Breakdown: platform donut, genre donut and the activity heatmap */}
      <div className="studio-page-full">
        {renderCard(
          "activityBreakdown",
          "card",
          <div className="studio-act-panels">
            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                {t("activityDash.platformBreakdown")}
              </span>
              <div className="studio-act-donut-box">
                <SchematicDonut size={52} stroke={6} />
                <div className="studio-act-donut-legend">
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-accent)" }} />
                    <span>Steam · 62%</span>
                  </span>
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-info)" }} />
                    <span>Epic · 22%</span>
                  </span>
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-warning)" }} />
                    <span>GOG · 16%</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                {t("activityDash.playtimeByGenre")}
              </span>
              <div className="studio-act-donut-box">
                <SchematicDonut size={52} stroke={6} />
                <div className="studio-act-donut-legend">
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-accent)" }} />
                    <span>RPG · 48%</span>
                  </span>
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-info)" }} />
                    <span>Action · 32%</span>
                  </span>
                  <span className="studio-act-legend-item">
                    <i style={{ background: "var(--color-warning)" }} />
                    <span>Indie · 20%</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="studio-act-panel">
              <span className="studio-act-panel-head">
                <Calendar size={10} className="studio-act-panel-icon" />
                <span>{t("activityDash.weeklyHeatmap")}</span>
              </span>
              <div className="studio-act-heat-stats">
                <span>
                  <strong>114</strong> {t("activity.activeDays")}
                </span>
                <span>
                  <strong>428h</strong> {t("activity.totalPlaytime")}
                </span>
              </div>
              <div className="studio-act-heatmap-grid" aria-hidden="true">
                {Array.from({ length: 28 }, (_, i) => (
                  <span key={i} className={`studio-act-heat-cell heat-${i % 4}`} />
                ))}
              </div>
              <div className="studio-act-heat-legend">
                <span>{t("activityDash.less")}</span>
                <span className="studio-act-heat-cell heat-0" />
                <span className="studio-act-heat-cell heat-1" />
                <span className="studio-act-heat-cell heat-2" />
                <span className="studio-act-heat-cell heat-3" />
                <span>{t("activityDash.more")}</span>
              </div>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
