import { useCallback, useMemo, useState } from "react";
import type { GameSession } from "../../types/game";
import {
  minutesThisWeek,
  readWeeklyGoal,
  sanitizeWeeklyGoal,
  weekWindow,
  weeklyGoalProgress,
  writeWeeklyGoal,
} from "../../utils/activity/weeklyGoal";

/** Weekly playtime target (off by default) and the current week's progress. */
export function useWeeklyGoal(sessions: GameSession[]) {
  const [targetMin, setTargetState] = useState(() => readWeeklyGoal());
  const week = useMemo(() => weekWindow(), []);
  const minutes = useMemo(() => minutesThisWeek(sessions), [sessions]);
  const progress = useMemo(() => weeklyGoalProgress(minutes, targetMin), [minutes, targetMin]);

  const setTarget = useCallback((value: number) => {
    const next = sanitizeWeeklyGoal(String(value));
    setTargetState(next);
    writeWeeklyGoal(next);
  }, []);

  const clear = useCallback(() => {
    setTargetState(0);
    writeWeeklyGoal(0);
  }, []);

  return { targetMin, minutes, progress, week, setTarget, clear };
}
