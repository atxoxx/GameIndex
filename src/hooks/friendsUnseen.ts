/**
 * Badge bookkeeping for the Big Screen friends hub.
 *
 * The sync engine merges remote data straight into storage, so the only
 * moment the hub can tell what is new is a storage reload. This pure helper
 * diffs the collections it just read against the ones it had, counting only
 * items authored by other people: a local mutation must never badge itself.
 */

import type {
  DmThread,
  GameRecommendation,
  GameSession,
  GameSuggestion,
} from "../pages/friendsStorage";

export type FriendsCollections = {
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  dms: DmThread[];
};

export type UnseenDeltas = {
  sessions: number;
  recs: number;
  suggestions: number;
  dms: number;
};

/**
 * Counts what arrived from other people between two storage reads:
 * sessions, recommendations and wishlist shares we have not seen before,
 * plus DM messages we did not write. Tombstoned items never count.
 */
export function countNewRemoteItems(
  prev: FriendsCollections,
  next: FriendsCollections,
  myName: string
): UnseenDeltas {
  const knownSessions = new Set(prev.sessions.map((session) => session.id));
  const knownRecommendations = new Set(
    prev.recommendations.map((rec) => rec.id)
  );
  const knownSuggestions = new Set(prev.suggestions.map((item) => item.id));
  const knownMessages = new Map<string, Set<string>>();
  prev.dms.forEach((thread) => {
    knownMessages.set(
      thread.id,
      new Set((thread.messages || []).map((message) => message.id))
    );
  });

  const sessions = next.sessions.filter(
    (session) =>
      !session.deleted &&
      !knownSessions.has(session.id) &&
      session.creatorName !== myName
  ).length;

  const recs = next.recommendations.filter(
    (rec) =>
      !rec.deleted &&
      !knownRecommendations.has(rec.id) &&
      rec.recommendedBy !== myName
  ).length;

  const suggestions = next.suggestions.filter(
    (item) =>
      !item.deleted &&
      !knownSuggestions.has(item.id) &&
      item.suggestedBy !== myName
  ).length;

  let dms = 0;
  next.dms.forEach((thread) => {
    const known = knownMessages.get(thread.id);
    (thread.messages || []).forEach((message) => {
      if (message.deleted) return;
      if (message.author === myName) return;
      if (known?.has(message.id)) return;
      dms += 1;
    });
  });

  return { sessions, recs, suggestions, dms };
}
