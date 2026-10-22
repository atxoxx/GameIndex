// Watchdog healing — pure helpers.
//
// The watcher emits `game-failed` for launches that went nowhere
// (never attached / died within HEAL_SHORT_RUN_SECS). The heal dialog
// turns that into guided recovery actions. Selection logic lives here
// so it can be tested without a DOM.

/** localStorage key for the per-game heal-dialog mute list. The value
 *  is a JSON record of game ids the user silenced ("don't ask again"). */
export const HEAL_MUTE_KEY = "gamelib.watchdog.mute";

export interface WatchdogFailure {
  gameId: string;
  gameName: string;
  elapsedSeconds: number;
  /** True when the watcher saw the game process run (instant crash);
   *  false when no process ever appeared (broken launch chain). */
  attached: boolean;
}

type MuteMap = Record<string, true>;

/** Load the mute record, tolerating every malformed shape localStorage
 *  can hold (old versions, user edits,quota resets). */
export function loadHealMutes(storage: Pick<Storage, "getItem"> = localStorage): MuteMap {
  try {
    const raw = storage.getItem(HEAL_MUTE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    const out: MuteMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveHealMutes(
  mutes: MuteMap,
  storage: Pick<Storage, "setItem"> = localStorage
): void {
  try {
    storage.setItem(HEAL_MUTE_KEY, JSON.stringify(mutes));
  } catch {
    // Storage full / private mode — muting is a nicety, never fail the UI.
  }
}

export function muteGame(gameId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const mutes = loadHealMutes(storage);
  mutes[gameId] = true;
  saveHealMutes(mutes, storage);
}

export function isGameMuted(gameId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return loadHealMutes(storage)[gameId] === true;
}

/**
 * Decide whether a failure is worth surfacing.
 * `true` (= "continue", no failure here) skips:
 *  - muted games ("don't ask again for this game"),
 *  - a failure for a game id the library doesn't know (deleted mid-session,
 *    stale ids) — the dialog has nothing to act on without a Game record.
 */
export function shouldSurfaceFailure(
  failure: WatchdogFailure,
  isKnownGame: (id: string) => boolean,
  storage: Pick<Storage, "getItem"> = localStorage
): boolean {
  if (!isKnownGame(failure.gameId)) return false;
  if (isGameMuted(failure.gameId, storage)) return false;
  return true;
}

/** Human-facing diagnosis line for the failure shape. */
export function failureReason(failure: WatchdogFailure): "crashed" | "notFound" {
  return failure.attached ? "crashed" : "notFound";
}

/** Directory portion of a game's exe path for "Open Installation Folder". */
export function installFolderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : path;
}
