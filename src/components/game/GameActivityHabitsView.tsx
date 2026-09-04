import { useMemo } from "react";
import type { GameSession } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import {
  SectionPanel,
  WeeklyHeatmap,
  TimeOfDayDistribution,
  SessionLengthDistribution,
  RecordsStrip,
  Milestones,
  DayOfWeekDistribution,
  buildTimeOfDayDistribution,
  buildSessionLengthDistribution,
  buildDayOfWeekDistribution,
  type RecordItem,
  type MilestoneLadder,
} from "../activity";
import type { Timeframe } from "./GameActivityShared";
import * as Icons from "../activity/Icons";

export interface GameActivityHabitsViewProps {
  sessions: GameSession[];
  filteredSessions: GameSession[];
  timeframe: Timeframe;
  records: RecordItem[];
  milestones: MilestoneLadder[];
}

export function GameActivityHabitsView({
  sessions,
  filteredSessions,
  timeframe,
  records,
  milestones,
}: GameActivityHabitsViewProps) {
  const { t, language } = useLanguage();

  const timeframeDays =
    timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
  const timeframeLabel =
    timeframe === "all"
      ? t("activity.allTime")
      : t("gameActivity.lastDays", { count: timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90 });

  const timeOfDayDist = useMemo(() => {
    return buildTimeOfDayDistribution(filteredSessions);
  }, [filteredSessions]);

  const sessionLengthDist = useMemo(() => {
    return buildSessionLengthDistribution(filteredSessions);
  }, [filteredSessions]);

  const dowDist = useMemo(() => {
    return buildDayOfWeekDistribution(filteredSessions, language);
  }, [filteredSessions, language]);

  return (
    <div id="game-activity-panel-habits" role="tabpanel" className="act-stack">
      {/* Records Strip & Milestones */}
      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      {/* Routine & Day of Week Grid */}
      <div className="act-cols">
        <SectionPanel
          icon={<Icons.CalendarRange size={14} />}
          title={t("activityInsights.dayOfWeekTitle")}
          sub={timeframeLabel}
        >
          <DayOfWeekDistribution distribution={dowDist} compact />
        </SectionPanel>

        <SectionPanel
          icon={<Icons.Clock size={14} />}
          title={t("activityInsights.timeOfDayTitle")}
          sub={timeframeLabel}
        >
          <TimeOfDayDistribution distribution={timeOfDayDist} compact />
        </SectionPanel>
      </div>

      {/* Duration Distribution & Weekly Activity Heatmap */}
      <div className="act-cols">
        <SectionPanel
          icon={<Icons.Target size={14} />}
          title={t("activityInsights.sessionLengthsTitle")}
          sub={timeframeLabel}
        >
          <SessionLengthDistribution
            buckets={sessionLengthDist.buckets}
            averageMinutes={sessionLengthDist.averageMinutes}
            longestMinutes={sessionLengthDist.longestMinutes}
            totalSessions={sessionLengthDist.totalSessions}
          />
        </SectionPanel>

        <SectionPanel
          icon={<Icons.CalendarRange size={14} />}
          title={t("gameActivity.weeklyActivity")}
          sub={timeframeLabel}
        >
          <WeeklyHeatmap sessions={sessions} timeframeDays={timeframeDays} />
        </SectionPanel>
      </div>
    </div>
  );
}
