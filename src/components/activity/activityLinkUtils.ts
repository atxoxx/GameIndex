import { formatPlayTime, parsePlayTime, type Game, type GameSession } from "../../types/game";

export interface PlaytimeUpdateResult {
  playTime: string;
  lastPlayed?: number;
}

/**
 * Computes updated playtime and lastPlayed when linking unlinked activity sessions
 * to an existing library game.
 *
 * Ensures that the updated game in the library/game page accurately reflects:
 * 1. The sum of the target game's existing playtime and unlinked sessions.
 * 2. At least the total duration of all recorded activity sessions for this game.
 * 3. An updated lastPlayed timestamp if any unlinked session is more recent.
 */
export function calculateLinkedPlaytime(
  targetGame: Pick<Game, "playTime" | "lastPlayed">,
  unlinkedSessions: GameSession[],
  targetSessions: GameSession[] = []
): PlaytimeUpdateResult {
  const unlinkedMinutes = unlinkedSessions.reduce(
    (sum, s) => sum + (typeof s.durationMin === "number" && !isNaN(s.durationMin) ? s.durationMin : 0),
    0
  );

  const targetActivityMinutes = targetSessions.reduce(
    (sum, s) => sum + (typeof s.durationMin === "number" && !isNaN(s.durationMin) ? s.durationMin : 0),
    0
  );

  const totalActivityMinutes = unlinkedMinutes + targetActivityMinutes;
  const currentMinutes = parsePlayTime(targetGame.playTime || "0h");
  const finalMinutes = Math.max(currentMinutes + unlinkedMinutes, totalActivityMinutes);

  let newestSessionTime = targetGame.lastPlayed || 0;
  for (const s of unlinkedSessions) {
    const time = new Date(s.date).getTime();
    if (!isNaN(time) && time > newestSessionTime) {
      newestSessionTime = time;
    }
  }

  const result: PlaytimeUpdateResult = {
    playTime: formatPlayTime(finalMinutes),
  };

  if (newestSessionTime > (targetGame.lastPlayed || 0)) {
    result.lastPlayed = newestSessionTime;
  }

  return result;
}

/**
 * Computes initial playtime and lastPlayed when adding a new game to the library
 * from unlinked activity sessions.
 */
export function calculateNewGamePlaytime(
  unlinkedSessions: GameSession[]
): PlaytimeUpdateResult {
  const totalMinutes = unlinkedSessions.reduce(
    (sum, s) => sum + (typeof s.durationMin === "number" && !isNaN(s.durationMin) ? s.durationMin : 0),
    0
  );

  let newestSessionTime: number | undefined;
  for (const s of unlinkedSessions) {
    const time = new Date(s.date).getTime();
    if (!isNaN(time) && (!newestSessionTime || time > newestSessionTime)) {
      newestSessionTime = time;
    }
  }

  return {
    playTime: formatPlayTime(totalMinutes),
    lastPlayed: newestSessionTime,
  };
}
