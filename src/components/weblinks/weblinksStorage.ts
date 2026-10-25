/**
 * Per-game Web Links memory.
 *
 * The hub offers a "resume" card for the last source the reader opened. Only
 * the source key is stored (not the full URL), so it still resolves when the
 * game gains an app id or a custom link is renamed.
 */

function storageKey(gameId: string): string {
  return `gamelib.weblinks.lastSource.${gameId}`;
}

export function readLastSource(gameId: string): string | null {
  try {
    return localStorage.getItem(storageKey(gameId));
  } catch {
    return null;
  }
}

export function writeLastSource(gameId: string, sourceKey: string): void {
  try {
    localStorage.setItem(storageKey(gameId), sourceKey);
  } catch {
    // Storage unavailable — the resume card simply won't appear.
  }
}
