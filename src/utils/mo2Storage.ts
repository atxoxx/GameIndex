export interface GameMo2Config {
  enabled?: boolean;
  profile?: string;
  executable?: string;
  instancePath?: string;
}

const STORAGE_PREFIX = "gamelib_mo2_launch_";

/**
 * Retrieve saved MO2 launch configuration for a specific game.
 */
export function getGameMo2Config(gameId: string): GameMo2Config | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${gameId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GameMo2Config;
  } catch {
    return null;
  }
}

/**
 * Persist MO2 launch configuration for a specific game (merges partial updates).
 */
export function saveGameMo2Config(gameId: string, cfg: Partial<GameMo2Config>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const existing = getGameMo2Config(gameId) || {};
    const merged: GameMo2Config = { ...existing, ...cfg };
    localStorage.setItem(`${STORAGE_PREFIX}${gameId}`, JSON.stringify(merged));
  } catch {
    // Quota or access error
  }
}
