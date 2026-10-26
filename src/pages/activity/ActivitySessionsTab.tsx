import { CalendarRange, List, Plus } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import type { Game, GameSession } from "../../types/game";
import { Button } from "../../components/ui";
import { ActivityViewSwitch } from "../../components/activity/ActivityViewSwitch";
import { ActivitySessionList } from "../../components/activity/ActivitySessionList";
import type { ActivitySessionFilters } from "../../utils/activity/sessionQuery";
import type { ActivityRange } from "../../utils/activity/range";
import type { WeeklyGoalProgress } from "../../utils/activity/weeklyGoal";
import { ActivityGantt } from "./ActivityGantt";

export interface ActivitySessionsTabProps {
  sessions: GameSession[];
  games: Game[];
  range: ActivityRange;
  rangeLabel: string;
  /** True when the library has any session at all (not just in this scope). */
  hasHistory?: boolean;
  filters: ActivitySessionFilters;
  onFiltersChange: (patch: Partial<ActivitySessionFilters>) => void;
  view: "list" | "timeline";
  onViewChange: (view: "list" | "timeline") => void;
  tempUnit: TempUnit;
  goal: { progress: WeeklyGoalProgress };
  onLogSession: () => void;
  onInspect: (session: GameSession) => void;
  onDelete: (session: GameSession) => void;
  onRequestLink: (gameId: string, name: string) => void;
  onRequestAdd: (gameId: string, name: string) => void;
  onLaunchGame?: (game: Game) => void;
  onOpenGame?: (gameId: string) => void;
  onCompare: (a: GameSession, b: GameSession) => void;
  onBatchDelete: (sessions: GameSession[]) => void;
  onExportSelected: (sessions: GameSession[], format: "csv" | "json") => void;
}

/**
 * The session workspace: the same scoped data as a readable list or a
 * day-by-day timeline. Both views open the shared inspector drawer.
 */
export function ActivitySessionsTab({
  sessions,
  games,
  range,
  rangeLabel,
  hasHistory = false,
  filters,
  onFiltersChange,
  view,
  onViewChange,
  tempUnit,
  goal,
  onLogSession,
  onInspect,
  onDelete,
  onRequestLink,
  onRequestAdd,
  onLaunchGame,
  onOpenGame,
  onCompare,
  onBatchDelete,
  onExportSelected,
}: ActivitySessionsTabProps) {
  const { t } = useLanguage();

  return (
    <div className="activity-sessions-tab">
      <div className="activity-sessions-tab__head">
        <div>
          <span className="activity-sessions-tab__eyebrow">
            {t("activity.tab.sessions")}
          </span>
          <p className="activity-sessions-tab__desc">{rangeLabel}</p>
        </div>
        <ActivityViewSwitch<"list" | "timeline">
          ariaLabel={t("activityWs.sessions.viewLabel")}
          value={view}
          onChange={onViewChange}
          items={[
            { id: "list", label: t("activityWs.sessions.viewList"), icon: List },
            {
              id: "timeline",
              label: t("activityWs.sessions.viewTimeline"),
              icon: CalendarRange,
            },
          ]}
        />
      </div>

      {view === "list" ? (
        <ActivitySessionList
          sessions={sessions}
          games={games}
          filters={filters}
          onFiltersChange={onFiltersChange}
          onDelete={onDelete}
          onRequestLink={onRequestLink}
          onRequestAdd={onRequestAdd}
          onLaunchGame={onLaunchGame}
          onOpenGame={onOpenGame}
          selectable
          tempUnit={tempUnit}
          rangeLabel={rangeLabel}
          goal={{
            percent: goal.progress.percent,
            minutes: goal.progress.minutes,
            target: goal.progress.targetMin,
          }}
          onCompare={onCompare}
          onBatchDelete={onBatchDelete}
          onExportSelected={onExportSelected}
          emptyTitle={
            hasHistory
              ? t("activityWs.overview.emptyTitle")
              : t("activityWs.sessions.noSessionsTitle")
          }
          emptyHint={
            hasHistory
              ? t("activityWs.overview.emptyHint")
              : t("activityWs.sessions.noSessionsHint")
          }
          emptyAction={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={13} />}
              onClick={onLogSession}
            >
              {t("activityManual.logSessionBtn")}
            </Button>
          }
        />
      ) : (
        <ActivityGantt
          sessions={sessions}
          games={games}
          startDate={range.startDate}
          endDate={range.endDate}
          sourceFilter="all"
          hideGameFilter
          onInspectSession={(sessionId) => {
            const session = sessions.find((entry) => entry.id === sessionId);
            if (session) onInspect(session);
          }}
        />
      )}
    </div>
  );
}

export default ActivitySessionsTab;
