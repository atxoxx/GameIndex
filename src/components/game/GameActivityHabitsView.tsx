import { useMemo } from "react";
import { CalendarRange, Clock, Target } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSession } from "../../types/game";
import { Panel } from "../ui";
import {
  DayOfWeekDistribution,
  SessionLengthDistribution,
  TimeOfDayDistribution,
  WeeklyHeatmap,
  buildDayOfWeekDistribution,
  buildSessionLengthDistribution,
  buildTimeOfDayDistribution,
} from "../activity";
import type { ActivityRange } from "../../utils/activity/range";
import { rangeDayCount } from "../../utils/activity/range";

export interface GameActivityHabitsViewProps {
  sessions: GameSession[];
  range: ActivityRange;
  rangeLabel: string;
}

/** Distribution panels: when, how long and on which days this game is played. */
export function GameActivityHabitsView({
  sessions,
  range,
  rangeLabel,
}: GameActivityHabitsViewProps) {
  const { t, language } = useLanguage();
  const days = Math.min(365, rangeDayCount(range));

  const timeOfDay = useMemo(() => buildTimeOfDayDistribution(sessions), [sessions]);
  const sessionLengths = useMemo(() => buildSessionLengthDistribution(sessions), [sessions]);
  const dayOfWeek = useMemo(
    () => buildDayOfWeekDistribution(sessions, language),
    [sessions, language],
  );

  return (
    <div className="activity-game-habits">
      <Panel heading={t("activityInsights.timeOfDayTitle")} icon={<Clock size={15} />}>
        <TimeOfDayDistribution distribution={timeOfDay} compact />
      </Panel>
      <Panel heading={t("activityInsights.sessionLengthsTitle")} icon={<Target size={15} />}>
        <SessionLengthDistribution
          buckets={sessionLengths.buckets}
          averageMinutes={sessionLengths.averageMinutes}
          longestMinutes={sessionLengths.longestMinutes}
          totalSessions={sessionLengths.totalSessions}
        />
      </Panel>
      <Panel heading={t("activityInsights.dayOfWeekTitle")} icon={<CalendarRange size={15} />}>
        <DayOfWeekDistribution distribution={dayOfWeek} compact />
      </Panel>
      <Panel
        heading={t("gameActivity.weeklyActivity")}
        icon={<CalendarRange size={15} />}
        actions={<span className="activity-panel-meta">{rangeLabel}</span>}
      >
        <WeeklyHeatmap sessions={sessions} timeframeDays={days} endDate={range.endDate} />
      </Panel>
    </div>
  );
}

export default GameActivityHabitsView;
