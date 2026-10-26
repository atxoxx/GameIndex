import type { GameSession } from "../../types/game";
import {
  computeDelta,
  computePeriodStats,
  type PeriodComparison,
} from "../../components/activity/insights";
import {
  filterSessionsToRange,
  previousActivityWindow,
  rangeDayCount,
  type ActivityRange,
} from "./range";

/**
 * Compare a resolved range (including custom windows) against the equal
 * window immediately before it. All-time has no baseline.
 */
export function buildRangeComparison(
  sessions: GameSession[],
  range: ActivityRange,
): PeriodComparison | null {
  const previousWindow = previousActivityWindow(range);
  if (!previousWindow) return null;

  const days = rangeDayCount(range);
  const current = computePeriodStats(filterSessionsToRange(sessions, range), days);
  const previous = computePeriodStats(
    filterSessionsToRange(sessions, {
      key: "custom",
      startDate: previousWindow.startDate,
      endDate: previousWindow.endDate,
    }),
    days,
  );

  return {
    current,
    previous,
    playtime: computeDelta(current.minutes, previous.minutes),
    sessions: computeDelta(current.sessions, previous.sessions),
    games: computeDelta(current.games, previous.games),
    activeDays: computeDelta(current.activeDays, previous.activeDays),
  };
}
