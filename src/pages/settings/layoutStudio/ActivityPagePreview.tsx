import { useMemo } from "react";
import {
  Activity,
  Award,
  BarChart3,
  Calendar,
  Clock,
  Download,
  Flame,
  Medal,
  TrendingUp,
  UserCheck,
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

  return (
    <div
      className="studio-page-preview studio-page-preview--activity"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Activity Header */}
      <div className="studio-page-full">
        {renderCard(
          "activityHeader",
          "slot",
          <div className="studio-act-header-mock">
            <div className="studio-act-header-left">
              <Activity size={13} className="studio-act-header-icon" />
              <div className="studio-act-header-text">
                <Line w={45} h={12} />
                <span className="studio-act-header-badge">
                  428h total · 114 sessions · 38 games played
                </span>
              </div>
            </div>
            <div className="studio-act-header-right">
              <span className="studio-act-btn">
                <Download size={9} />
                <span>Export CSV</span>
              </span>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Activity Toolbar */}
      <div className="studio-page-full">
        {renderCard(
          "activityToolbar",
          "slot",
          <div className="studio-act-toolbar-mock">
            <div className="studio-act-toolbar-tabs">
              <span className="studio-act-pill is-active">Dashboard</span>
              <span className="studio-act-pill">Timeline</span>
              <span className="studio-act-pill">Sessions</span>
            </div>
            <div className="studio-act-toolbar-filters">
              <span className="studio-act-select">Range: Last 30 Days</span>
              <span className="studio-act-select">Platform: All</span>
            </div>
          </div>,
        )}
      </div>

      {/* 3. Activity KPI Band */}
      <div className="studio-page-full">
        {renderCard(
          "activityKpis",
          "slot",
          <div className="studio-act-kpi-grid">
            <MiniTile label="Total Playtime" value="428h" icon={Clock} />
            <MiniTile label="Daily Average" value="2.4h" icon={TrendingUp} />
            <MiniTile label="Sessions" value="114" icon={Calendar} />
            <MiniTile label="Longest Streak" value="12 days" icon={Flame} />
          </div>,
        )}
      </div>

      {/* 4. Gamer Persona Banner */}
      <div className="studio-page-full">
        {renderCard(
          "activityPersona",
          "card",
          <div className="studio-act-persona-mock">
            <div className="studio-act-persona-avatar">
              <UserCheck size={16} />
            </div>
            <div className="studio-act-persona-info">
              <div className="studio-act-persona-title">
                <span className="studio-act-persona-name">The Completionist</span>
                <span className="studio-act-persona-tag">Dominant Archetype</span>
              </div>
              <p className="studio-act-persona-desc">
                High achievement completion rate with deep single-game focus and long weekend sessions.
              </p>
              <div className="studio-act-persona-chips">
                <span className="studio-act-chip">Deep Diver</span>
                <span className="studio-act-chip">RPG Enthusiast</span>
                <span className="studio-act-chip">Night Owl</span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 5. Records & Milestones */}
      <div className="studio-page-full">
        {renderCard(
          "activityRecords",
          "card",
          <div className="studio-act-records-mock">
            <div className="studio-act-record-cell">
              <Medal size={11} className="studio-act-record-icon" />
              <div className="studio-act-record-text">
                <span className="studio-act-record-val">6.2 hrs</span>
                <span className="studio-act-record-lbl">Longest Session · Cyberpunk 2077</span>
              </div>
            </div>
            <div className="studio-act-record-cell">
              <Zap size={11} className="studio-act-record-icon" />
              <div className="studio-act-record-text">
                <span className="studio-act-record-val">142 hrs</span>
                <span className="studio-act-record-lbl">Most Played · Elden Ring</span>
              </div>
            </div>
            <div className="studio-act-record-cell">
              <Award size={11} className="studio-act-record-icon" />
              <div className="studio-act-record-text">
                <span className="studio-act-record-val">Level 42</span>
                <span className="studio-act-record-lbl">Next: 450 XP to Level 43</span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 6. Main Activity Chart with Game Sidebar */}
      <div className="studio-page-full">
        {renderCard(
          "activityChart",
          "card",
          <div className="studio-act-chart-split">
            {/* Left mini game picker */}
            <div className="studio-act-chart-sidebar">
              <div className="studio-act-sidebar-head">
                <span className="studio-act-sidebar-title">Top Games</span>
              </div>
              {[
                { name: 55, hours: "142h" },
                { name: 40, hours: "98h" },
                { name: 48, hours: "64h" },
                { name: 35, hours: "42h" },
              ].map((g, i) => (
                <div key={i} className={`studio-act-game-item${i === 0 ? " is-active" : ""}`}>
                  <Line w={g.name} h={10} />
                  <span className="studio-act-game-time">{g.hours}</span>
                </div>
              ))}
            </div>

            {/* Right chart view */}
            <div className="studio-act-chart-main">
              <div className="studio-act-chart-top">
                <div className="studio-act-chart-title">
                  <BarChart3 size={11} />
                  <span>Playtime Distribution</span>
                </div>
                <div className="studio-act-chart-modes">
                  <span className="studio-act-mode-btn is-active">Periodic</span>
                  <span className="studio-act-mode-btn">Cumulative</span>
                </div>
              </div>
              <SchematicSparkline height={54} bars={[30, 45, 60, 20, 80, 95, 40, 70, 85, 50, 65, 100]} />
            </div>
          </div>,
        )}
      </div>

      {/* 7. Insights (Time of Day & Session Lengths) */}
      <div className="studio-page-full">
        {renderCard(
          "activityInsights",
          "card",
          <div className="studio-act-insights-grid">
            <div className="studio-act-insight-col">
              <span className="studio-act-insight-title">Time of Day</span>
              <div className="studio-act-dist-bars">
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">Night (22-04)</span>
                  <Track value={55} />
                  <span className="studio-act-dist-pct">55%</span>
                </div>
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">Evening (18-22)</span>
                  <Track value={30} />
                  <span className="studio-act-dist-pct">30%</span>
                </div>
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">Day (10-18)</span>
                  <Track value={15} />
                  <span className="studio-act-dist-pct">15%</span>
                </div>
              </div>
            </div>
            <div className="studio-act-insight-col">
              <span className="studio-act-insight-title">Session Length</span>
              <div className="studio-act-dist-bars">
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">&gt; 2 Hours</span>
                  <Track value={48} color="var(--color-brand-cyan, #06b6d4)" />
                  <span className="studio-act-dist-pct">48%</span>
                </div>
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">1 - 2 Hours</span>
                  <Track value={32} color="var(--color-brand-cyan, #06b6d4)" />
                  <span className="studio-act-dist-pct">32%</span>
                </div>
                <div className="studio-act-dist-row">
                  <span className="studio-act-dist-name">&lt; 1 Hour</span>
                  <Track value={20} color="var(--color-brand-cyan, #06b6d4)" />
                  <span className="studio-act-dist-pct">20%</span>
                </div>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 8. Backlog Completion Hub */}
      <div className="studio-page-full">
        {renderCard(
          "activityBacklog",
          "card",
          <div className="studio-act-backlog-mock">
            <div className="studio-act-backlog-stat">
              <span className="studio-act-backlog-num">6</span>
              <span className="studio-act-backlog-lbl">In Progress</span>
            </div>
            <div className="studio-act-backlog-stat">
              <span className="studio-act-backlog-num">18</span>
              <span className="studio-act-backlog-lbl">Completed</span>
            </div>
            <div className="studio-act-backlog-stat">
              <span className="studio-act-backlog-num">24</span>
              <span className="studio-act-backlog-lbl">In Backlog</span>
            </div>
            <div className="studio-act-backlog-progress">
              <div className="studio-act-backlog-progress-head">
                <Line w={45} />
                <span className="studio-act-backlog-progress-val">75% beaten</span>
              </div>
              <Track value={75} height={6} />
            </div>
          </div>,
        )}
      </div>

      {/* 9. Breakdown & Weekly Heatmap */}
      <div className="studio-page-full">
        {renderCard(
          "activityBreakdown",
          "card",
          <div className="studio-act-breakdown-mock">
            <div className="studio-act-donut-box">
              <SchematicDonut size={52} stroke={6} />
              <div className="studio-act-donut-legend">
                <span className="studio-act-legend-item">
                  <i style={{ background: "var(--color-accent)" }} />
                  <span>RPG (48%)</span>
                </span>
                <span className="studio-act-legend-item">
                  <i style={{ background: "var(--color-brand-cyan, #06b6d4)" }} />
                  <span>Action (32%)</span>
                </span>
              </div>
            </div>
            <div className="studio-act-heatmap-box">
              <span className="studio-act-heatmap-title">Weekly Heatmap Matrix</span>
              <div className="studio-act-heatmap-grid" aria-hidden="true">
                {Array.from({ length: 28 }, (_, i) => (
                  <span
                    key={i}
                    className={`studio-act-heat-cell heat-${i % 4}`}
                  />
                ))}
              </div>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
