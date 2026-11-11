/**
 * Bridges the friends sync engine to the data the app already keeps in
 * `friendsStorage`. Every read and write goes through the existing helpers so
 * the page, the storage layer and the sync engine can never disagree about
 * where a friend, a session or a DM thread lives.
 */

import {
  NOSTR_RELAYS,
  areDmReadReceiptsEnabled,
  buildNostrOutboxPayload,
  capSharedGames,
  dmThreadId,
  getNostrKeys,
  getNostrShareScope,
  isNostrIdentityReady,
  loadDms,
  loadFriends,
  loadRecommendations,
  loadSessions,
  loadSuggestions,
  loadUserProfile,
  mergeDatabases,
  notifyFriendsDbChange,
  persistLocalStorageToDisk,
  safeCurrentlyPlaying,
  saveDms,
  saveDmsAndPersist,
  saveFriends,
  scopeNostrPayload,
  subscribeFriendsDbChange,
  writeFriendsCollections,
  type DmThread,
  type Friend,
  type FriendsDatabase,
  type GameRecommendation,
  type GameSession,
  type GameSuggestion,
  type ReactionKind,
  type RsvpStatus,
  type SessionMessage,
  type SharedGameStat as LocalSharedGameStat,
  type SuggestionReactionKind,
  type UserProfile,
} from "../../pages/friendsStorage";
import { FRIENDS_SYNC_VERSION, fitSnapshot } from "./protocol";
import type {
  FriendsSyncAdapter,
  FriendsSyncIdentity,
  PeerDirectory,
  SharedGameStatInput,
} from "./engine";
import type {
  ChatEnvelope,
  PresenceEnvelope,
  SeenMap,
  SharedGameStat,
  SharedProfile,
  SharedRecommendation,
  SharedSession,
  SnapshotEnvelope,
} from "./types";

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

function asPubkey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return PUBKEY_PATTERN.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

function defaultFriend(pubkey: string): Friend {
  return {
    id: `friend_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: "Gamer Syncing...",
    avatar: "procedural",
    status: "Offline",
    addedAt: Date.now(),
    syncId: pubkey,
  };
}

/** `YYYY-MM-DDTHH:mm` in the local zone, the format `GameSession` stores. */
function localDateTimeFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function msFromLocalDateTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSharedGameStat(game: LocalSharedGameStat): SharedGameStat {
  return {
    gameId: game.id,
    name: game.name,
    minutes: game.playTimeMin,
    lastPlayed: 0,
  };
}

function toSharedSession(session: GameSession): SharedSession {
  return {
    id: session.id,
    title: session.gameName,
    gameName: session.gameName,
    startsAt: msFromLocalDateTime(session.scheduledAt),
    durationMinutes: session.durationMin ?? 60,
    status: session.deleted ? "deleted" : "scheduled",
    updatedAt: session.updatedAt,
    deleted: session.deleted,
    participants: session.participants,
    messages: session.messages,
    // The wire type declares an array but this field is a name -> status map;
    // the protocol only validates that each session is an object.
    rsvps: session.rsvps as unknown as unknown[],
  };
}

function fromSharedSession(
  session: SharedSession,
  local: GameSession | undefined,
  peerName: string
): GameSession {
  const rsvps = session.rsvps as unknown as
    | Record<string, RsvpStatus>
    | undefined;
  return {
    id: session.id,
    gameId: local?.gameId ?? "",
    gameName: session.gameName || local?.gameName || "",
    scheduledAt:
      local?.scheduledAt ??
      localDateTimeFromMs(session.startsAt),
    maxPlayers: local?.maxPlayers ?? 8,
    description: local?.description ?? "",
    creatorName: local?.creatorName ?? peerName,
    attendees: local?.attendees ?? [],
    rsvps: rsvps ?? local?.rsvps,
    updatedAt: session.updatedAt,
    deleted: session.deleted,
    creatorTimezone: local?.creatorTimezone,
    invited: local?.invited,
    participants: (session.participants as GameSession["participants"]) ??
      local?.participants,
    messages: (session.messages as SessionMessage[]) ?? local?.messages,
    durationMin: session.durationMinutes ?? local?.durationMin,
    poll: local?.poll,
    recurrence: local?.recurrence,
  };
}

function toSharedRecommendation(
  rec: GameRecommendation,
  myPubkey: string,
  myName: string
): SharedRecommendation {
  return {
    id: rec.id,
    fromName: rec.recommendedBy,
    fromSyncId: rec.recommendedBy === myName ? myPubkey : "",
    gameName: rec.gameName,
    note: rec.reason,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    deleted: rec.deleted,
    reactions: rec.reactions,
    comments: rec.comments,
  };
}

function fromSharedRecommendation(
  item: SharedRecommendation,
  peerName: string
): GameRecommendation {
  return {
    id: item.id,
    gameId: "",
    gameName: item.gameName,
    recommendedBy: item.fromName || peerName,
    recommendedTo: "All Friends",
    reason: item.note ?? "",
    rating: 0,
    comments: (item.comments as GameRecommendation["comments"]) ?? [],
    reactions: (item.reactions as Record<string, ReactionKind>) ?? {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deleted: item.deleted,
  };
}

function toSharedSuggestion(
  suggestion: GameSuggestion,
  myPubkey: string,
  myName: string
): SharedRecommendation {
  return {
    id: suggestion.id,
    fromName: suggestion.suggestedBy,
    fromSyncId: suggestion.suggestedBy === myName ? myPubkey : "",
    gameName: suggestion.gameName,
    note: suggestion.note,
    createdAt: suggestion.createdAt,
    updatedAt: suggestion.updatedAt,
    deleted: suggestion.deleted,
    reactions: suggestion.reactions,
    comments: suggestion.comments,
  };
}

function fromSharedSuggestion(
  item: SharedRecommendation,
  peerName: string
): GameSuggestion {
  return {
    id: item.id,
    gameId: "",
    gameName: item.gameName,
    note: item.note ?? "",
    suggestedBy: item.fromName || peerName,
    suggestedTo: "All Friends",
    comments: (item.comments as GameSuggestion["comments"]) ?? [],
    reactions:
      (item.reactions as Record<string, SuggestionReactionKind>) ?? {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deleted: item.deleted,
  };
}

export type FriendsSyncAdapterOptions = {
  /** Library-derived per-game stats the snapshot shares. */
  sharedGames?: () => SharedGameStatInput[];
};

/**
 * Re-keys a name-addressed DM thread onto the pair's pubkeys. Runs on every
 * DM read; only writes back when something actually changed.
 */
function migrateDmThreads(myPubkey: string, myName: string): {
  threads: DmThread[];
  changed: boolean;
} {
  const threads = loadDms();
  const nameToPubkey = new Map<string, string>();
  if (myName) nameToPubkey.set(myName, myPubkey);
  loadFriends().forEach((friend) => {
    const pubkey = asPubkey(friend.syncId);
    if (pubkey && friend.name) nameToPubkey.set(friend.name, pubkey);
  });

  const pairFor = (thread: DmThread): [string, string] | null => {
    const participants = thread.participants || [];
    if (participants.length !== 2) return null;
    const resolved = participants.map(
      (name) => asPubkey(name) ?? nameToPubkey.get(name) ?? null
    );
    if (resolved.some((value) => value === null)) return null;
    return [resolved[0]!, resolved[1]!];
  };

  const remapReadState = (
    lastReadAt: Record<string, number> | undefined
  ): Record<string, number> | undefined => {
    if (!lastReadAt) return undefined;
    let changed = false;
    const next: Record<string, number> = {};
    Object.entries(lastReadAt).forEach(([key, value]) => {
      const mapped = asPubkey(key) ?? nameToPubkey.get(key) ?? key;
      if (mapped !== key) changed = true;
      next[mapped] = Math.max(next[mapped] ?? 0, value);
    });
    return changed ? next : lastReadAt;
  };

  const claimed = new Set<string>();
  const candidates: Array<{ index: number; target: string; pair: [string, string] }> =
    [];

  threads.forEach((thread, index) => {
    const pair = pairFor(thread);
    if (!pair) return;
    const target = dmThreadId(pair[0], pair[1]);
    if (thread.id === target) {
      claimed.add(target);
      return;
    }
    candidates.push({ index, target, pair });
  });

  let changed = false;
  const next = threads.map((thread) => {
    const lastReadAt = remapReadState(thread.lastReadAt);
    if (lastReadAt === thread.lastReadAt) return thread;
    changed = true;
    return { ...thread, lastReadAt };
  });

  for (const candidate of candidates) {
    // An ambiguous legacy pair (two threads for the same two people) keeps
    // its old ids; nothing is ever deleted here.
    if (claimed.has(candidate.target)) continue;
    claimed.add(candidate.target);
    changed = true;
    next[candidate.index] = {
      ...next[candidate.index],
      id: candidate.target,
      participants: [candidate.pair[0], candidate.pair[1]],
      lastReadAt: remapReadState(next[candidate.index].lastReadAt),
    };
  }

  return { threads: next, changed };
}

/**
 * The pubkey-addressed DM thread id for a peer — the id the page must put on
 * every chat envelope it hands to `sendChat`. Null while the identity is not
 * loaded (there is no pair id without both pubkeys).
 */
export function dmThreadIdForPeer(peerPubkey: string): string | null {
  if (!isNostrIdentityReady()) return null;
  try {
    return dmThreadId(getNostrKeys().publicKey, peerPubkey);
  } catch {
    return null;
  }
}

export function createFriendsSyncAdapter(
  options: FriendsSyncAdapterOptions = {}
): FriendsSyncAdapter {  let sharedGamesProvider = options.sharedGames ?? null;

  const friendName = (pubkey: string): string => {
    const friend = loadFriends().find(
      (candidate) => asPubkey(candidate.syncId) === pubkey
    );
    return friend?.name || "Friend";
  };

  const friendRecord = (pubkey: string): Friend | undefined =>
    loadFriends().find((candidate) => asPubkey(candidate.syncId) === pubkey);

  const isBlockedPeer = (pubkey: string): boolean =>
    friendRecord(pubkey)?.blocked === true;

  const isAcceptedPeer = (pubkey: string): boolean => {
    const friend = friendRecord(pubkey);
    return !!friend && !friend.blocked && friend.consent !== "pending";
  };

  const isPendingPeer = (pubkey: string): boolean => {
    const friend = friendRecord(pubkey);
    return !!friend && !friend.blocked && friend.consent === "pending";
  };

  const identity = (): FriendsSyncIdentity | null => {
    if (!isNostrIdentityReady()) return null;
    try {
      const keys = getNostrKeys();
      if (!keys?.publicKey || !keys.privateKey) return null;
      return { pubkey: keys.publicKey, privateKey: keys.privateKey };
    } catch {
      return null;
    }
  };

  const profile = (): SharedProfile => {
    const me = loadUserProfile();
    return {
      name: me.name,
      // A photo avatar on an immutable relay event is permanent PII.
      avatar:
        me.avatar && me.avatar.startsWith("data:") ? "procedural" : me.avatar,
      status: me.status,
      favoriteGame: me.favoriteGameName || undefined,
      currentlyPlaying: safeCurrentlyPlaying(me.currentlyPlaying),
      bio: me.bio,
      region: me.region,
      lastActive: me.lastActive,
      libStats: me.libStats,
    };
  };

  const readLocalDatabase = (): FriendsDatabase => ({
    profile: loadUserProfile(),
    friends: loadFriends(),
    sessions: loadSessions(),
    recommendations: loadRecommendations(),
    suggestions: loadSuggestions(),
    dms: loadDms(),
  });

  const buildRemoteDatabase = (
    peerPubkey: string,
    payload: SnapshotEnvelope,
    local: FriendsDatabase
  ): FriendsDatabase => {
    const peerName = payload.profile.name || friendName(peerPubkey);
    const localSessions = new Map(
      local.sessions.map((session) => [session.id, session])
    );
    // A `core` payload deliberately omits the favourite game, the library
    // stats and the avatar, and an older client can omit any field. Merging an
    // omitted field as an empty value would wipe what we already cached, so
    // every shared field falls back to the cached friend record instead.
    const cached = friendRecord(peerPubkey);
    return {
      profile: {
        name: peerName,
        avatar: payload.profile.avatar || cached?.avatar || "procedural",
        status: payload.profile.status || cached?.status || "Offline",
        favoriteGameName:
          payload.profile.favoriteGame || cached?.favoriteGame || "",
        favoriteGameId: "",
        syncId: peerPubkey,
        // "Not playing right now" is a real state, not a missing field: the
        // live value (undefined included) is what presence also reports.
        currentlyPlaying: payload.profile.currentlyPlaying,
        bio: payload.profile.bio || cached?.bio,
        region: payload.profile.region || cached?.region,
        lastActive: payload.profile.lastActive ?? cached?.lastActive,
        libStats: payload.profile.libStats ?? cached?.libStats,
      } satisfies UserProfile,
      // The friend graph in a snapshot is informational only: friendship is
      // established by consent, never by someone else's list.
      friends: [],
      sessions: (payload.sessions ?? []).map((session) =>
        fromSharedSession(session, localSessions.get(session.id), peerName)
      ),
      recommendations: (payload.recommendations ?? []).map((item) =>
        fromSharedRecommendation(item, peerName)
      ),
      suggestions: (payload.suggestions ?? []).map((item) =>
        fromSharedSuggestion(item, peerName)
      ),
      dms: [],
    };
  };

  const applySharedStats = (
    friends: Friend[],
    peerPubkey: string,
    payload: SnapshotEnvelope
  ): Friend[] => {
    if (!payload.games) return friends;
    return friends.map((friend) => {
      if (asPubkey(friend.syncId) !== peerPubkey) return friend;
      const previous = new Map(
        (friend.games ?? []).map((game) => [game.id, game])
      );
      return {
        ...friend,
        games: payload.games!.map((game) => ({
          id: game.gameId,
          name: game.name,
          playTimeMin: game.minutes,
          achievementPercent:
            previous.get(game.gameId)?.achievementPercent ?? 0,
          genres: previous.get(game.gameId)?.genres ?? [],
        })),
      };
    });
  };

  const dmContext = (peerPubkey: string) => {
    const me = identity();
    if (!me) return null;
    const localProfile = loadUserProfile();
    const { threads, changed } = migrateDmThreads(
      me.pubkey,
      localProfile.name
    );
    if (changed) saveDms(threads);

    const targetId = dmThreadId(me.pubkey, peerPubkey);
    let thread = threads.find((candidate) => candidate.id === targetId) ?? null;
    if (!thread) {
      // A thread that could not be migrated (ambiguous legacy id) is still
      // the pair's conversation — keep writing into it.
      const peerName = friendName(peerPubkey);
      thread =
        threads.find(
          (candidate) =>
            (candidate.participants || []).length === 2 &&
            candidate.participants.includes(localProfile.name) &&
            candidate.participants.includes(peerName)
        ) ?? null;
    }
    return { me, profile: localProfile, threads, thread, targetId };
  };

  return {
    identity,
    relays: () => [...NOSTR_RELAYS],
    profile,

    peers(): PeerDirectory {
      const directory: PeerDirectory = {
        accepted: [],
        pending: [],
        blocked: [],
      };
      loadFriends().forEach((friend) => {
        const pubkey = asPubkey(friend.syncId);
        if (!pubkey) return;
        if (friend.blocked) {
          directory.blocked.push(pubkey);
          return;
        }
        if (friend.consent === "pending") directory.pending.push(pubkey);
        else directory.accepted.push(pubkey);
      });
      return directory;
    },

    buildSnapshot(peerPubkey: string): SnapshotEnvelope {
      const me = identity();
      if (!me) throw new Error("friends sync identity is not ready");

      const localProfile = loadUserProfile();
      const stats = localProfile.libStats ?? {
        gamesCount: 0,
        playtimeMinutes: 0,
        achievementsCount: 0,
      };
      // "off" is the retired opt-in; sync is always on now, so it degrades to
      // the privacy-reduced payload rather than a full one.
      const scope = getNostrShareScope() === "full" ? "full" : "core";
      const friends = loadFriends();
      const blockedIds = new Set(
        friends.filter((friend) => friend.blocked).map((friend) => friend.syncId)
      );

      const sharedGames = (sharedGamesProvider?.() ?? []).map((game) => ({
        id: game.id,
        name: game.name,
        playTimeMin: game.playTimeMin,
        achievementPercent: 0,
        genres: [],
      }));

      const outbox = buildNostrOutboxPayload(
        localProfile,
        stats,
        loadSessions(),
        loadRecommendations(),
        capSharedGames(sharedGames),
        loadSuggestions()
      );
      const scoped = scopeNostrPayload(outbox, scope, blockedIds);

      const envelope: SnapshotEnvelope = {
        v: FRIENDS_SYNC_VERSION,
        type: "snapshot",
        sender: me.pubkey,
        recipient: peerPubkey,
        rev: 0,
        updatedAt: 0,
        profile: {
          name: scoped.profile.name,
          avatar: scoped.profile.avatar,
          status: scoped.profile.status,
          favoriteGame: scoped.profile.favoriteGame || undefined,
          currentlyPlaying: scoped.profile.currentlyPlaying || undefined,
          bio: scoped.profile.bio || undefined,
          region: scoped.profile.region || undefined,
          lastActive: scoped.profile.lastActive,
          libStats: scoped.profile.libStats,
        },
        friends: scoped.friends,
        games: scoped.games?.map(toSharedGameStat),
        sessions: scoped.sessions.map(toSharedSession),
        recommendations: scoped.recommendations.map((rec) =>
          toSharedRecommendation(rec, me.pubkey, localProfile.name)
        ),
        suggestions: scoped.suggestions.map((suggestion) =>
          toSharedSuggestion(suggestion, me.pubkey, localProfile.name)
        ),
        seen: {},
      };

      return fitSnapshot(envelope);
    },

    async applySnapshot(peerPubkey: string, payload: SnapshotEnvelope) {
      if (isBlockedPeer(peerPubkey)) return;
      if (!isAcceptedPeer(peerPubkey) && !isPendingPeer(peerPubkey)) return;

      const local = readLocalDatabase();
      const remote = buildRemoteDatabase(peerPubkey, payload, local);
      const merged = mergeDatabases(local, remote);
      merged.friends = applySharedStats(
        merged.friends,
        peerPubkey,
        payload
      );

      writeFriendsCollections(merged);
      await persistLocalStorageToDisk();
    },

    buildPresence(peerPubkey: string, seen: SeenMap): PresenceEnvelope {
      const me = identity();
      if (!me) throw new Error("friends sync identity is not ready");
      const localProfile = loadUserProfile();
      return {
        v: FRIENDS_SYNC_VERSION,
        type: "presence",
        sender: me.pubkey,
        recipient: peerPubkey,
        rev: 0,
        updatedAt: 0,
        status: localProfile.status || "Online",
        currentlyPlaying: safeCurrentlyPlaying(localProfile.currentlyPlaying) ?? null,
        lastActive: Math.floor(Date.now() / 1000),
        seen: { ...seen },
      };
    },

    applyPresence(peerPubkey: string, payload: PresenceEnvelope) {
      const friends = loadFriends();
      const index = friends.findIndex(
        (friend) => asPubkey(friend.syncId) === peerPubkey
      );
      if (index < 0) return;
      const friend = friends[index];
      if (friend.blocked) return;
      friends[index] = {
        ...friend,
        status: payload.status || friend.status,
        currentlyPlaying:
          safeCurrentlyPlaying(payload.currentlyPlaying ?? undefined),
        lastActive: payload.lastActive || friend.lastActive,
        lastSeen: Math.floor(Date.now() / 1000),
      };
      saveFriends(friends);
    },

    pendingChat(peerPubkey: string): ChatEnvelope[] {
      const context = dmContext(peerPubkey);
      if (!context || !context.thread || context.thread.deleted) return [];
      const thread = context.thread;
      const myNames = new Set([context.profile.name, context.me.pubkey]);

      const envelopes: ChatEnvelope[] = thread.messages
        .filter(
          (message) =>
            !message.deleted && !message.deliveredAt && myNames.has(message.author)
        )
        .map((message) => ({
          v: FRIENDS_SYNC_VERSION,
          type: "message" as const,
          sender: context.me.pubkey,
          recipient: peerPubkey,
          rev: 0,
          updatedAt: message.timestamp,
          id: message.id,
          threadId: context.targetId,
          body: message.text,
          sentAt: message.timestamp,
          attachment: message.attachments?.[0]
            ? {
                name: message.attachments[0].name,
                mimeType: message.attachments[0].mimeType,
                dataUrl: message.attachments[0].dataUrl,
              }
            : undefined,
        }));

      // A read receipt the peer has not confirmed yet is replayed too, so a
      // receipt written offline is not silently lost on restart. Never
      // replay one while the user has read receipts switched off.
      const myRead = Math.max(
        thread.lastReadAt?.[context.me.pubkey] ?? 0,
        thread.lastReadAt?.[context.profile.name] ?? 0
      );
      if (areDmReadReceiptsEnabled() && myRead > (thread.readSentUpTo ?? 0)) {
        envelopes.push({
          v: FRIENDS_SYNC_VERSION,
          type: "read",
          sender: context.me.pubkey,
          recipient: peerPubkey,
          rev: 0,
          updatedAt: myRead,
          threadId: context.targetId,
          upTo: myRead,
          at: myRead,
        });
      }

      return envelopes;
    },

    applyChat(peerPubkey: string, envelope: ChatEnvelope) {
      const context = dmContext(peerPubkey);
      if (!context) return;

      if (envelope.type === "read") {
        const thread = context.thread;
        if (!thread || thread.deleted) return;
        const previous = thread.lastReadAt?.[peerPubkey] ?? 0;
        if (envelope.upTo <= previous) return;
        const lastReadAt = {
          ...(thread.lastReadAt || {}),
          [peerPubkey]: envelope.upTo,
        };
        saveDmsAndPersist(
          context.threads.map((candidate) =>
            candidate.id === thread.id ? { ...candidate, lastReadAt } : candidate
          )
        );
        return;
      }

      if (envelope.type !== "message") return;
      if (envelope.sender !== peerPubkey && envelope.sender !== context.me.pubkey) {
        return;
      }
      if (context.thread?.deleted) return;

      const thread: DmThread = context.thread ?? {
        id: context.targetId,
        participants: [context.me.pubkey, peerPubkey],
        messages: [],
        updatedAt: envelope.sentAt,
      };
      const existing = thread.messages.find(
        (message) => message.id === envelope.id
      );
      const author =
        existing?.author ??
        (envelope.sender === context.me.pubkey
          ? context.profile.name
          : friendName(peerPubkey));
      const attachments = envelope.attachment
        ? [
            {
              id: `${envelope.id}:0`,
              name: envelope.attachment.name || "image",
              mimeType: envelope.attachment.mimeType || "image/png",
              dataUrl: envelope.attachment.dataUrl,
            },
          ]
        : existing?.attachments;

      const message: SessionMessage = {
        id: envelope.id,
        author,
        text: envelope.body,
        timestamp: envelope.sentAt,
        ...(attachments ? { attachments } : {}),
        ...(existing?.deleted ? { deleted: true } : {}),
        ...(existing?.reactions ? { reactions: existing.reactions } : {}),
      };

      const messages = (
        existing
          ? thread.messages.map((candidate) =>
              candidate.id === envelope.id ? message : candidate
            )
          : [...thread.messages, message]
      ).sort((a, b) => a.timestamp - b.timestamp);

      const nextThread: DmThread = {
        ...thread,
        messages,
        updatedAt: Math.max(thread.updatedAt || 0, envelope.sentAt),
      };
      const threads = context.thread
        ? context.threads.map((candidate) =>
            candidate.id === thread.id ? nextThread : candidate
          )
        : [...context.threads, nextThread];
      saveDmsAndPersist(threads);
    },

    markChatDelivered(peerPubkey: string, envelope: ChatEnvelope) {
      const context = dmContext(peerPubkey);
      if (!context?.thread) return;

      if (envelope.type === "read") {
        const thread = context.thread;
        const readSentUpTo = Math.max(
          thread.readSentUpTo ?? 0,
          envelope.upTo
        );
        if (readSentUpTo === thread.readSentUpTo) return;
        saveDmsAndPersist(
          context.threads.map((candidate) =>
            candidate.id === thread.id
              ? { ...candidate, readSentUpTo }
              : candidate
          )
        );
        return;
      }

      if (envelope.type !== "message") return;
      const index = context.thread.messages.findIndex(
        (message) => message.id === envelope.id
      );
      if (index < 0) return;
      if (context.thread.messages[index].deliveredAt) return;
      const messages = context.thread.messages.slice();
      messages[index] = { ...messages[index], deliveredAt: Date.now() };
      saveDmsAndPersist(
        context.threads.map((candidate) =>
          candidate.id === context.thread!.id ? { ...candidate, messages } : candidate
        )
      );
    },

    incomingRequest(senderPubkey: string, incoming: SharedProfile) {
      const friends = loadFriends();
      const index = friends.findIndex(
        (friend) => asPubkey(friend.syncId) === senderPubkey
      );
      const existing = index >= 0 ? friends[index] : undefined;
      if (existing?.blocked) return;
      if (existing && existing.consent !== "pending") return;

      const record: Friend = {
        ...(existing ?? defaultFriend(senderPubkey)),
        name: incoming.name?.trim() || existing?.name || "Gamer Syncing...",
        avatar: incoming.avatar || existing?.avatar || "procedural",
        status: incoming.status || existing?.status || "Offline",
        bio: incoming.bio || existing?.bio,
        region: incoming.region || existing?.region,
        favoriteGame: incoming.favoriteGame || existing?.favoriteGame,
        currentlyPlaying:
          safeCurrentlyPlaying(incoming.currentlyPlaying) ??
          existing?.currentlyPlaying,
        libStats: incoming.libStats ?? existing?.libStats,
        consent: "pending",
        incomingRequestAt: Date.now(),
      };
      if (index >= 0) friends[index] = record;
      else friends.push(record);
      saveFriends(friends);
    },

    outgoingRequest(pubkey: string) {
      const friends = loadFriends();
      const index = friends.findIndex(
        (friend) => asPubkey(friend.syncId) === pubkey
      );
      const existing = index >= 0 ? friends[index] : undefined;
      if (existing?.blocked) return;
      if (existing && existing.consent !== "pending") return;
      const record: Friend = {
        ...(existing ?? defaultFriend(pubkey)),
        consent: "pending",
        requestedAt: Date.now(),
      };
      if (index >= 0) friends[index] = record;
      else friends.push(record);
      saveFriends(friends);
    },

    acceptPeer(pubkey: string) {
      const friends = loadFriends();
      const index = friends.findIndex(
        (friend) => asPubkey(friend.syncId) === pubkey
      );
      const existing = index >= 0 ? friends[index] : undefined;
      if (existing?.blocked) return;
      const record: Friend = {
        ...(existing ?? defaultFriend(pubkey)),
        consent: "accepted",
        acceptedAt: Date.now(),
      };
      if (index >= 0) friends[index] = record;
      else friends.push(record);
      saveFriends(friends);
    },

    removePeer(pubkey: string) {
      const friends = loadFriends();
      const next = friends.filter(
        (friend) => asPubkey(friend.syncId) !== pubkey
      );
      if (next.length === friends.length) return;
      saveFriends(next);
    },

    blockPeer(pubkey: string) {
      const friends = loadFriends();
      const index = friends.findIndex(
        (friend) => asPubkey(friend.syncId) === pubkey
      );
      if (index < 0) return;
      friends[index] = { ...friends[index], blocked: true };
      saveFriends(friends);
    },

    isBlocked(pubkey: string): boolean {
      return isBlockedPeer(pubkey);
    },

    isAccepted(pubkey: string): boolean {
      return isAcceptedPeer(pubkey);
    },

    isPending(pubkey: string): boolean {
      return isPendingPeer(pubkey);
    },

    hasOutgoingRequest(pubkey: string): boolean {
      const friend = friendRecord(pubkey);
      return (
        !!friend &&
        !friend.blocked &&
        friend.consent === "pending" &&
        typeof friend.requestedAt === "number"
      );
    },

    subscribeLocalChanges: subscribeFriendsDbChange,
    notifyLocalChange: notifyFriendsDbChange,

    setSharedGames(provider: (() => SharedGameStatInput[]) | null) {
      sharedGamesProvider = provider;
    },
  };
}
