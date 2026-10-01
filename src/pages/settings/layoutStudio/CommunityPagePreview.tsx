import { useMemo } from "react";
import {
  Award,
  BarChart2,
  Calendar,
  Camera,
  Flame,
  LayoutDashboard,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioPageWidgetCard } from "./StudioPageWidgetCard";
import {
  Line,
  MiniTile,
  SchematicDonut,
  Track,
} from "./StudioSchematics";
import type { OrderListItem } from "./types";

export interface CommunityPagePreviewProps {
  widgetItems: OrderListItem[];
  inspectMode?: boolean;
  highlightedId?: string | null;
  onReorderWidgets: (from: number, to: number) => void;
  onToggleWidget: (id: string) => void;
  onInspectElement?: (id: string) => void;
}

export function CommunityPagePreview({
  widgetItems,
  inspectMode = false,
  highlightedId,
  onReorderWidgets,
  onToggleWidget,
  onInspectElement,
}: CommunityPagePreviewProps) {
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
      className="studio-page-preview studio-page-preview--community"
      ref={widgetDrag.containerRef}
      role="group"
      aria-label={t("settings.interface.studioPreview")}
    >
      {/* 1. Community & Player Level Header */}
      <div className="studio-page-full">
        {renderCard(
          "communityHeader",
          "slot",
          <div className="studio-comm-header-mock">
            <div className="studio-comm-level-badge">
              <span className="studio-comm-level-num">42</span>
              <span className="studio-comm-level-lbl">LEVEL</span>
            </div>
            <div className="studio-comm-header-center">
              <div className="studio-comm-title-row">
                <span className="studio-comm-player-title">Grandmaster Explorer</span>
                <span className="studio-comm-persona-chip">The Specialist</span>
                <span className="studio-comm-streak-chip">
                  <Flame size={9} /> 14 day streak
                </span>
              </div>
              <div className="studio-comm-xp-row">
                <Track value={84} height={5} color="var(--color-accent)" />
                <span className="studio-comm-xp-text">8,450 / 10,000 XP (84%)</span>
              </div>
            </div>
            <div className="studio-comm-header-stats">
              <div className="studio-comm-stat-cell">
                <span className="studio-comm-stat-val">428h</span>
                <span className="studio-comm-stat-lbl">Playtime</span>
              </div>
              <div className="studio-comm-stat-cell">
                <span className="studio-comm-stat-val">148</span>
                <span className="studio-comm-stat-lbl">Games</span>
              </div>
            </div>
          </div>,
        )}
      </div>

      {/* 2. Subtab Navigation Bar */}
      <div className="studio-page-full">
        {renderCard(
          "communityTabs",
          "slot",
          <div className="studio-comm-subtabs-mock">
            <span className="studio-comm-subtab is-active">
              <LayoutDashboard size={10} />
              <span>Overview</span>
            </span>
            <span className="studio-comm-subtab">
              <BarChart2 size={10} />
              <span>Trends</span>
            </span>
            <span className="studio-comm-subtab">
              <Trophy size={10} />
              <span>Achievements</span>
            </span>
            <span className="studio-comm-subtab">
              <Camera size={10} />
              <span>Captures</span>
            </span>
            <span className="studio-comm-subtab">
              <Award size={10} />
              <span>Milestones</span>
            </span>
          </div>,
        )}
      </div>

      {/* 3. Community Dashboard Content */}
      <div className="studio-page-full">
        {renderCard(
          "communityContent",
          "slot",
          <div className="studio-comm-content-mock">
            {/* Monthly Goal Banner */}
            <div className="studio-comm-goal-banner">
              <div className="studio-comm-goal-head">
                <Target size={11} className="studio-comm-goal-icon" />
                <span className="studio-comm-goal-title">Monthly Gaming Goal</span>
                <span className="studio-comm-goal-count">24h / 30h (80%)</span>
              </div>
              <Track value={80} color="var(--color-brand-cyan, #06b6d4)" height={5} />
            </div>

            {/* Two-column overview cards */}
            <div className="studio-comm-overview-split">
              <div className="studio-comm-card">
                <div className="studio-comm-card-head">
                  <Trophy size={10} />
                  <span>Favorite Genres & Titles</span>
                </div>
                <div className="studio-comm-genre-donut">
                  <SchematicDonut size={48} stroke={6} />
                  <div className="studio-comm-donut-meta">
                    <span className="studio-comm-donut-row">
                      <i style={{ background: "var(--color-accent)" }} />
                      <span>Role-Playing Games (52%)</span>
                    </span>
                    <span className="studio-comm-donut-row">
                      <i style={{ background: "var(--color-brand-cyan, #06b6d4)" }} />
                      <span>Action Adventure (30%)</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="studio-comm-card">
                <div className="studio-comm-card-head">
                  <Users size={10} />
                  <span>Recent Highlights</span>
                </div>
                <div className="studio-comm-recent-rows">
                  <div className="studio-comm-recent-row">
                    <MiniTile label="Longest Session" value="6.2h" icon={Calendar} />
                  </div>
                  <div className="studio-comm-recent-row">
                    <Line w={75} />
                    <Line w={45} />
                  </div>
                </div>
              </div>
            </div>
          </div>,
        )}
      </div>
    </div>
  );
}
