import type { GameSession } from "../../types/game";
import { localDayKey } from "./range";
import { sessionDayKey } from "./sessionTime";

export const WEEKLY_GOAL_KEY = "gamelib.activity.weeklyGoalMin.v1";
/** A week is 168 hours; the cap only guards against absurd input. */
export const MAX_WEEKLY_GOAL_MIN = 7 * 24 * 60;

/** Monday 00:00 in local time. */
export function startOfWeek(date = new Date()): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - ((day + 6) % 7));
  return start;
}

export function weekWindow(date = new Date()): { startDate: string; endDate: string } {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { startDate: localDayKey(start), endDate: localDayKey(end) };
}

export function minutesThisWeek(sessions: GameSession[], date = new Date()): number {
  const { startDate, endDate } = weekWindow(date);
  return sessions.reduce((total, session) => {
    const day = sessionDayKey(session);
    return day >= startDate && day <= endDate ? total + session.durationMin : total;
  }, 0);
}

export interface WeeklyGoalProgress {
  targetMin: number;
  minutes: number;
  remainingMin: number;
  /** 0–100, clamped for the ring; `minutes / target` can exceed 100. */
  percent: number;
  reached: boolean;
}

export function weeklyGoalProgress(minutes: number, targetMin: number): WeeklyGoalProgress {
  const target = Number.isFinite(targetMin) ? Math.max(0, targetMin) : 0;
  const safeMinutes = Math.max(0, Math.round(minutes));
  if (target <= 0) {
    return {
      targetMin: 0,
      minutes: safeMinutes,
      remainingMin: 0,
      percent: 0,
      reached: false,
    };
  }
  return {
    targetMin: target,
    minutes: safeMinutes,
    remainingMin: Math.max(0, target - safeMinutes),
    percent: Math.min(100, Math.round((safeMinutes / target) * 100)),
    reached: safeMinutes >= target,
  };
}

export function sanitizeWeeklyGoal(raw: string | null): number {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_WEEKLY_GOAL_MIN, Math.round(value));
}

export function readWeeklyGoal(storage: Storage | undefined = globalThis.localStorage): number {
  if (!storage) return 0;
  try {
    return sanitizeWeeklyGoal(storage.getItem(WEEKLY_GOAL_KEY));
  } catch {
    return 0;
  }
}

export function writeWeeklyGoal(value: number, storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  try {
    if (value > 0) storage.setItem(WEEKLY_GOAL_KEY, String(Math.round(value)));
    else storage.removeItem(WEEKLY_GOAL_KEY);
  } catch {
    /* no-op */
  }
}

/** Convenience for a date picker default: the Monday of the current week. */
export function currentWeekStartKey(date = new Date()): string {
  return localDayKey(startOfWeek(date));
}
