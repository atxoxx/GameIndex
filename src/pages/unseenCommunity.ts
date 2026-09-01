// ── Community tab notification badge ──────────────────────────────
// Counts "new" social items (sessions / recommendations / suggestions)
// pulled from friends during sync that the user hasn't seen yet. Surfaces
// as a number badge on the Community tab in the top navigation and is
// cleared when the user opens that tab.
//
// Kept in its own module (no nostr-tools dependency) so the shell — which
// renders the badge in TopNav — never drags the nostr stack into the
// startup bundle. friendsStorage re-exports these for the friends pages.

const LS_UNSEEN_COMMUNITY = "gamelib.friends.unseen_community_items";

/** Broadcast channel so the nav badge updates instantly across components. */
const communityBadgeListeners = new Set<(count: number) => void>();

function readUnseenCommunity(): number {
  const n = Number(localStorage.getItem(LS_UNSEEN_COMMUNITY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function writeUnseenCommunity(count: number): void {
  const clamped = Math.max(0, Math.floor(count));
  try {
    localStorage.setItem(LS_UNSEEN_COMMUNITY, String(clamped));
  } catch {
    /* ignore */
  }
  communityBadgeListeners.forEach((cb) => cb(clamped));
}

/** Current number of unseen community items. */
export function getUnseenCommunityItems(): number {
  return readUnseenCommunity();
}

/** Add `delta` newly-discovered community items to the unseen count. */
export function addUnseenCommunityItems(delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  writeUnseenCommunity(readUnseenCommunity() + delta);
}

/** Reset the unseen count to zero (called when the Community tab is opened). */
export function clearUnseenCommunityItems(): void {
  if (readUnseenCommunity() === 0) return;
  writeUnseenCommunity(0);
}

/** Subscribe to unseen-count changes; returns an unsubscribe function. */
export function subscribeUnseenCommunity(cb: (count: number) => void): () => void {
  communityBadgeListeners.add(cb);
  return () => communityBadgeListeners.delete(cb);
}
