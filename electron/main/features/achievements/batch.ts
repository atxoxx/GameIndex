/**
 * GOG / Epic achievement batch sync.
 *
 * Both stores expose achievements only through an authenticated session
 * (GOG OAuth + cookie jar, Epic OAuth + GraphQL). Interactive sign-in is not
 * part of this port, so these handlers do the only honest thing available
 * without it: return whatever is already cached for that game, and a clear
 * "requires an account sign-in" note for everything else. They never invent
 * achievements and never report a successful fetch they did not make.
 *
 * Reference: `src-tauri/src/gog/achievements.rs`,
 * `src-tauri/src/epic/achievements.rs`.
 */
import type {
  AchievementSource,
  AchievementSyncTarget,
  BatchSyncResult,
  GameAchievementData,
} from "../../../../src/types/game";
import { getCachedGame } from "./store";

function cachedResult(
  target: AchievementSyncTarget,
  source: AchievementSource,
  serviceName: string,
): BatchSyncResult {
  const gameId = String(target?.gameId ?? "");
  if (!gameId) {
    return { gameId, data: null, error: `Missing game id in the ${serviceName} sync request.` };
  }
  const cached: GameAchievementData | null = getCachedGame(gameId);
  if (cached && cached.source === source) {
    return { gameId, data: cached, error: null };
  }
  return {
    gameId,
    data: null,
    error:
      `${serviceName} achievements require an account sign-in — connect your ${serviceName} ` +
      `account in Settings → Integrations, then sync the library again.`,
  };
}

/** `gog_fetch_achievements`: cached rows only until GOG sign-in is ported. */
export function fetchGogAchievements(targets: AchievementSyncTarget[]): BatchSyncResult[] {
  const list = Array.isArray(targets) ? targets : [];
  return list.map((target) => cachedResult(target, "gog", "GOG"));
}

/** `epic_fetch_achievements`: cached rows only until Epic sign-in is ported. */
export function fetchEpicAchievements(targets: AchievementSyncTarget[]): BatchSyncResult[] {
  const list = Array.isArray(targets) ? targets : [];
  return list.map((target) => cachedResult(target, "epic", "Epic Games"));
}
