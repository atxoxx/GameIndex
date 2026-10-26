import { gameDisplayName, type Game, type GameSession } from "../../types/game";
import { parseLocalDayKey, type ActivityRange } from "./range";
import { longestDayStreak, sessionDayKey } from "./sessionTime";

export interface RecapGame {
  id: string;
  name: string;
  minutes: number;
}

export interface RecapHeatCell {
  day: string;
  minutes: number;
}

export interface ActivityRecapData {
  minutes: number;
  sessionCount: number;
  gameCount: number;
  activeDays: number;
  longestStreak: number;
  longestSessionMin: number;
  topGames: RecapGame[];
  heatmap: RecapHeatCell[];
}

const HEATMAP_CAP = 119;

/**
 * Build the figures a share card needs from the already-scoped sessions.
 * The heatmap keeps at most 120 days so the card stays legible for all-time
 * ranges; the numbers above it still cover the whole range.
 */
export function buildActivityRecap(
  sessions: GameSession[],
  games: Game[],
  range: ActivityRange,
): ActivityRecapData {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const byGame = new Map<string, { name: string; minutes: number }>();
  const byDay = new Map<string, number>();
  const activeDays = new Set<string>();
  let minutes = 0;
  let longestSessionMin = 0;

  for (const session of sessions) {
    minutes += session.durationMin;
    longestSessionMin = Math.max(longestSessionMin, session.durationMin);
    const day = sessionDayKey(session);
    activeDays.add(day);
    byDay.set(day, (byDay.get(day) || 0) + session.durationMin);

    const game = gameById.get(session.gameId);
    const name = game ? gameDisplayName(game) : session.gameName;
    const current = byGame.get(session.gameId);
    if (current) current.minutes += session.durationMin;
    else byGame.set(session.gameId, { name, minutes: session.durationMin });
  }

  const topGames = Array.from(byGame.entries())
    .map(([id, entry]) => ({ id, name: entry.name, minutes: entry.minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3);

  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  const heatmap: RecapHeatCell[] = [];
  if (start && end) {
    const cells = Math.min(HEATMAP_CAP, Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1));
    const cursor = new Date(end);
    cursor.setDate(cursor.getDate() - (cells - 1));
    for (let index = 0; index < cells; index++) {
      const day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      heatmap.push({ day, minutes: byDay.get(day) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return {
    minutes,
    sessionCount: sessions.length,
    gameCount: byGame.size,
    activeDays: activeDays.size,
    longestStreak: longestDayStreak(activeDays),
    longestSessionMin,
    topGames,
    heatmap,
  };
}
