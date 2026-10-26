import { gameDisplayName, type Game, type GameSession } from "../../types/game";

export interface ActivityGameSummary {
  id: string;
  name: string;
  platform: string;
  minutes: number;
  sessions: number;
  lastPlayed: string;
  iconUrl: string | null;
  coverArtUrl: string | null;
  steamAppId: number | null;
  /** False when the session references a game no longer in the library. */
  linked: boolean;
}

/** Platform options for the source picker: games that actually have sessions,
 *  plus games with a platform when no sessions exist yet. */
export function buildSourceOptions(games: Game[], sessions: GameSession[]): string[] {
  const withSessions = new Set(sessions.map((session) => session.gameId));
  const gameById = new Map(games.map((game) => [game.id, game]));
  const platforms = new Set<string>();
  for (const game of games) {
    if (!game.platform) continue;
    if (withSessions.size > 0 && !withSessions.has(game.id)) continue;
    platforms.add(game.platform);
  }
  if (withSessions.size > 0) {
    for (const id of withSessions) {
      const platform = gameById.get(id)?.platform;
      if (platform) platforms.add(platform);
    }
  }
  return Array.from(platforms).sort((a, b) => a.localeCompare(b));
}

export function filterSessionsBySource(
  sessions: GameSession[],
  games: Game[],
  source: string,
): GameSession[] {
  if (!source || source === "all") return sessions;
  const platformById = new Map(games.map((game) => [game.id, game.platform]));
  return sessions.filter((session) => platformById.get(session.gameId) === source);
}

export function filterSessionsByGame(
  sessions: GameSession[],
  gameId: string | null,
): GameSession[] {
  if (!gameId) return sessions;
  return sessions.filter((session) => session.gameId === gameId);
}

/**
 * Ranked, library-aware game summaries for the rail and the scope picker.
 * Sessions for games that were removed still appear (with their last known
 * name) so their history is never silently hidden.
 */
export function buildActivityGameSummaries(
  sessions: GameSession[],
  games: Game[],
  unknownName: string,
): ActivityGameSummary[] {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const summaries = new Map<string, ActivityGameSummary>();

  for (const session of sessions) {
    const game = gameById.get(session.gameId);
    const existing = summaries.get(session.gameId);
    if (existing) {
      existing.minutes += session.durationMin;
      existing.sessions += 1;
      if (session.date > existing.lastPlayed) existing.lastPlayed = session.date;
      continue;
    }
    summaries.set(session.gameId, {
      id: session.gameId,
      name: game ? gameDisplayName(game) : session.gameName || unknownName,
      platform: game?.platform || "Local",
      minutes: session.durationMin,
      sessions: 1,
      lastPlayed: session.date,
      iconUrl: game?.iconUrl ?? null,
      coverArtUrl: game?.coverArtUrl ?? null,
      steamAppId: game?.steamAppId ?? null,
      linked: Boolean(game),
    });
  }

  return Array.from(summaries.values()).sort((a, b) => b.minutes - a.minutes);
}

/** Sorted options for a game picker, carrying the range's playtime so the
 *  list is scannable without opening the rail. */
export function buildGamePickerOptions(
  summaries: ActivityGameSummary[],
): Array<{ id: string; name: string; minutes: number }> {
  return [...summaries]
    .sort((a, b) => b.minutes - a.minutes)
    .map((summary) => ({
      id: summary.id,
      name: summary.name,
      minutes: summary.minutes,
    }));
}
