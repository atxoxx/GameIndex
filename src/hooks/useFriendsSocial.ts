// useFriendsSocial — companion data hook for the Big Screen Friends hub,
// layered on top of `useFriendsData` (which owns the profile, the add-friend
// flow and the engine-backed sync status).
//
// Ownership model
// ───────────────
// • `friends` / `sessions` / DMs / recommendations / suggestions are
//   AUTHORITATIVE here. Every local mutation writes through `friendsStorage`
//   and stops there: the storage layer notifies the always-on sync engine,
//   which republishes. This hook never pushes an outbox, never publishes to
//   a relay and never reads the legacy sync folder.
// • After every storage change (engine merges, other surfaces' writes) all
//   social state is re-read, so remote items appear without polling.
// • Friend requests are answered through the provider: accept →
//   `acceptFriend(pubkey)`, deny → `blockPeer(pubkey)`. Inbound invites and
//   outbound waiting requests are derived from `Friend.consent` +
//   `incomingRequestAt` / `requestedAt`.
// • DMs travel as `sendChat` envelopes to the peer pubkey. A name that maps
//   to no friend, or to more than one, keeps the message local-only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { parsePlayTime, type Game } from "../types/game";
import type { UseFriendsDataResult } from "./useFriendsData";
import { useFriendsSync } from "../sync/friends/FriendsSyncProvider";
import { dmThreadIdForPeer } from "../sync/friends/adapter";
import {
  type Friend,
  type GameSession,
  type GameRecommendation,
  type GameSuggestion,
  type DmThread,
  type FriendCircle,
  type SharedGameStat,
  type RsvpStatus,
  type SessionRole,
  type SessionMessage,
  type ReactionKind,
  type SuggestionReactionKind,
  type RecommendationComment,
  type SuggestionComment,
  loadRecommendations,
  saveRecommendations,
  loadSuggestions,
  saveSuggestions,
  loadDms,
  saveDmsAndPersist,
  loadCircles,
  saveCircles,
  loadSessions,
  saveSessions,
  loadFriends,
  saveFriends,
  saveUserProfile,
  getUnseenTabItems,
  addUnseenTabItems,
  addUnseenCommunityItems,
  clearUnseenTabItems,
  startDmThreadId,
  displayName,
  isAppBlacklisted,
  safeCurrentlyPlaying,
  subscribeFriendsDbChange,
} from "../pages/friendsStorage";
import { detectTimezone, sessionsConflict } from "../components/bigscreen/friends/friendsUtils";
import {
  asPeerPubkey,
  classifyFriendsByConsent,
  peerPubkeyForThread,
} from "../pages/friends/friendsSyncHelpers";
import { countNewRemoteItems } from "./friendsUnseen";

// ── Shared result types ──────────────────────────────────────────

/** One friend request, in either direction (see `invitations`). */
export interface FriendInvitation {
  syncId: string;
  name: string;
  avatar: string;
  status: string;
  favoriteGame?: string;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  /** Epoch ms the request was made (inbound or outbound). */
  requestedAt?: number;
}

export type ActivityItem = {
  key: string;
  timestamp: number;
  kind: "session" | "rec" | "suggestion" | "friend" | "achievement";
  title: string;
  detail: string;
  gameName?: string;
};

export interface PlayingNowEntry {
  friend: Friend;
  playing: string;
  game?: Game;
}

export interface LeaderboardPlayer {
  key: string;
  name: string;
  avatar: string;
  isYou: boolean;
  currentlyPlaying?: string;
  gamesCount: number;
  playtimeMinutes: number;
  achievementsCount: number;
  rank: number;
  value: number;
  max: number;
}

export interface RaceEntry {
  key: string;
  gameId: string;
  gameName: string;
  friendName: string;
  me: number;
  them: number;
}

export interface CompareItem {
  id: string;
  name: string;
  ownedByMe: boolean;
  ownedByFriend: boolean;
  playTimeMe: number;
  playTimeFriend: number;
  achievementMe: number;
  achievementFriend: number;
  genres: string[];
  estimated: boolean;
}

export interface CompareSummary {
  sharedCount: number;
  myOwned: number;
  friendOwned: number;
  meOnlyCount: number;
  friendOnlyCount: number;
  myPlaytime: number;
  friendPlaytime: number;
  averageMyAchievements: number;
  averageFriendAchievements: number;
}

export interface GenreRow {
  genre: string;
  meOwned: number;
  friendOwned: number;
  shared: number;
  mePlay: number;
  friendPlay: number;
  total: number;
}

export interface CompareInsights {
  iPlayMore: CompareItem[];
  theyPlayMore: CompareItem[];
  forYou: CompareItem[];
  forThem: CompareItem[];
  topShared?: CompareItem;
  achLeaderMe: number;
  achLeaderFriend: number;
}

export interface CreateSessionInput {
  gameId: string;
  gameName: string;
  scheduledAt: string;
  maxPlayers: number;
  durationMin: number;
  description: string;
  invited: string[];
}

export interface UseFriendsSocialResult {
  // Read surfaces
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  dms: DmThread[];
  circles: FriendCircle[];
  /** Inbound requests: `consent === "pending"` and the peer asked us. */
  invitations: FriendInvitation[];
  /** Outbound requests still waiting on the peer (`requestedAt`). */
  outgoingRequests: FriendInvitation[];
  unseenCounts: {
    sessions: number;
    recs: number;
    suggestions: number;
    activity: number;
    dms: number;
  };
  activityFeed: ActivityItem[];
  playingNow: PlayingNowEntry[];
  leaderboardPlayers: LeaderboardPlayer[];
  achievementRaces: RaceEntry[];
  myGameIds: Set<string>;
  gameCoverForSession: (session: GameSession) => string | undefined;
  /** Pubkey of the friend behind a DM thread, when it is unambiguous. */
  peerForThread: (threadId: string) => string | null;

  // Compare state (owned here so the "Compare" quick action on friend
  // cards can jump straight into the tab with the friend selected).
  selectedCompareFriendId: string;
  setSelectedCompareFriendId: (id: string) => void;
  compareSubTab: "overview" | "games" | "genres" | "insights";
  setCompareSubTab: (t: "overview" | "games" | "genres" | "insights") => void;
  compareFilter: "all" | "shared" | "me_only" | "friend_only";
  setCompareFilter: (f: "all" | "shared" | "me_only" | "friend_only") => void;
  compareSort: "name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement";
  setCompareSort: (s: "name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement") => void;
  compareGenre: string;
  setCompareGenre: (g: string) => void;
  compareSearch: string;
  setCompareSearch: (s: string) => void;
  compareFriend: Friend | null;
  comparisonData: CompareItem[];
  comparisonSummary: CompareSummary | null;
  compareInsights: CompareInsights | null;
  genreBreakdown: GenreRow[];
  genreAffinity: number;
  matchScore: number;
  compatibilityScore: number;
  compareGenres: string[];
  leaderboardMetric: "playtime" | "games" | "achievements";
  setLeaderboardMetric: (m: "playtime" | "games" | "achievements") => void;

  // DM thread pane state (lifted so friend-card "Message" can jump here)
  selectedDmId: string | null;
  selectedDmFriendName: string;
  setSelectedDmId: (id: string | null) => void;
  setSelectedDmFriendName: (name: string) => void;
  handleOpenDmThread: (threadId: string, friendName: string) => void;
  handleSendDm: (friendName: string, text: string) => Promise<void>;

  // Friend mutations (authoritative)
  handleTogglePin: (friendId: string) => void;
  handleToggleBlock: (friendId: string, friendName: string) => void;
  handleDeleteFriend: (friendId: string, friendName: string) => void;
  handleSetNickname: (friendId: string, nickname: string) => void;
  handleAcceptInvitation: (invite: FriendInvitation) => void;
  handleDenyInvitation: (syncId: string) => void;
  handleResendRequest: (syncId: string) => void;

  // Session mutations
  handleCreateSession: (input: CreateSessionInput) => Promise<boolean>;
  handleSetRsvp: (sessionId: string, status: RsvpStatus) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleSendSessionMessage: (sessionId: string, text: string) => Promise<void>;
  handleSetRole: (sessionId: string, name: string, role: SessionRole) => Promise<void>;
  handleAddGuest: (sessionId: string, guestName: string) => Promise<void>;
  handleRemoveGuest: (sessionId: string, guestName: string) => Promise<void>;
  handleSetRsvpNote: (sessionId: string, note: string) => Promise<void>;
  handleTogglePinMessage: (sessionId: string, messageId: string) => Promise<void>;

  // Recommendations
  handleCreateRecommendation: (input: {
    gameId: string;
    to: string;
    rating: number;
    reason: string;
  }) => Promise<void>;
  handleToggleReaction: (recId: string, kind: ReactionKind) => Promise<void>;
  handleToggleWantToPlay: (recId: string) => Promise<void>;
  handleDeleteRecommendation: (recId: string) => Promise<void>;
  handleAddComment: (recId: string, text: string) => Promise<void>;
  handleDeleteComment: (recId: string, commentId: string, authorName: string) => Promise<void>;

  // Wishlist shares
  handleCreateSuggestion: (input: {
    gameId: string;
    to: string;
    note: string;
  }) => Promise<void>;
  handleToggleSuggestionReaction: (sugId: string, kind: SuggestionReactionKind) => Promise<void>;
  handleAddSuggestionComment: (sugId: string, text: string) => Promise<void>;
  handleDeleteSuggestionComment: (sugId: string, commentId: string, authorName: string) => Promise<void>;
  handleDeleteSuggestion: (sugId: string) => Promise<void>;
  handleAddSuggestionToWishlist: (sug: GameSuggestion) => Promise<void>;

  // Circles
  handleCreateCircle: (name: string) => void;
  handleRenameCircle: (circleId: string, name: string) => void;
  handleDeleteCircle: (circleId: string) => void;
  handleToggleFriendCircle: (friendId: string, circleId: string) => void;

  // Misc
  handleCopyCode: () => void;
  saveProfile: () => Promise<void>;
  refreshUnseenCounts: () => void;
  clearUnseenTab: (key: "sessions" | "recs" | "suggestions" | "activity" | "dms") => void;
}

function toInvitation(friend: Friend): FriendInvitation {
  return {
    syncId: friend.syncId,
    name: displayName(friend),
    avatar: friend.avatar,
    status: friend.status,
    favoriteGame: friend.favoriteGame,
    libStats: friend.libStats,
    requestedAt: friend.incomingRequestAt ?? friend.requestedAt,
  };
}

export function useFriendsSocial(fd: UseFriendsDataResult): UseFriendsSocialResult {
  const { t } = useLanguage();
  const { games } = useGames();
  const { summaries, recentUnlocks } = useAchievements();
  const { wishlist, toggle } = useWishlistContext();
  const { showToast } = useToast();
  const { dmReadReceipts } = useSettings();
  const {
    sendChat,
    sendFriendRequest,
    acceptFriend,
    blockPeer,
    removePeer,
  } = useFriendsSync();

  const { profile } = fd;

  // ── State (all reloaded from storage on every local change) ─────

  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>(() => loadSuggestions());
  const [dms, setDms] = useState<DmThread[]>(() => loadDms());
  const [circles, setCircles] = useState<FriendCircle[]>(() => loadCircles());

  const [unseenCounts, setUnseenCounts] = useState(() => ({
    sessions: getUnseenTabItems("sessions"),
    recs: getUnseenTabItems("recs"),
    suggestions: getUnseenTabItems("suggestions"),
    activity: getUnseenTabItems("activity"),
    dms: getUnseenTabItems("dms"),
  }));

  // DM thread pane state (lifted for cross-tab jumps).
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);
  const [selectedDmFriendName, setSelectedDmFriendName] = useState("");

  // ── Refs (async handlers read the freshest values) ──────────────

  const friendsRef = useRef(friends);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const dmsRef = useRef(dms);
  useEffect(() => {
    dmsRef.current = dms;
  }, [dms]);
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const recommendationsRef = useRef(recommendations);
  useEffect(() => {
    recommendationsRef.current = recommendations;
  }, [recommendations]);
  const suggestionsRef = useRef(suggestions);
  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  // ── Reload from storage ─────────────────────────────────────────

  const refreshUnseenCounts = useCallback(() => {
    setUnseenCounts({
      sessions: getUnseenTabItems("sessions"),
      recs: getUnseenTabItems("recs"),
      suggestions: getUnseenTabItems("suggestions"),
      activity: getUnseenTabItems("activity"),
      dms: getUnseenTabItems("dms"),
    });
  }, []);

  const clearUnseenTab = useCallback(
    (key: "sessions" | "recs" | "suggestions" | "activity" | "dms") => {
      clearUnseenTabItems(key);
      refreshUnseenCounts();
    },
    [refreshUnseenCounts],
  );

  /**
   * Re-reads every social collection. `countNew` bumps the unseen badges for
   * items other people added since the last read; our own writes are skipped
   * by author, so a local mutation never badges itself.
   */
  const reloadAll = useCallback(
    (countNew = false) => {
      const next = {
        sessions: loadSessions(),
        recommendations: loadRecommendations(),
        suggestions: loadSuggestions(),
        dms: loadDms(),
      };

      if (countNew) {
        const deltas = countNewRemoteItems(
          {
            sessions: sessionsRef.current,
            recommendations: recommendationsRef.current,
            suggestions: suggestionsRef.current,
            dms: dmsRef.current,
          },
          next,
          profileRef.current.name,
        );
        addUnseenTabItems("sessions", deltas.sessions);
        addUnseenTabItems("recs", deltas.recs);
        addUnseenTabItems("suggestions", deltas.suggestions);
        addUnseenTabItems("dms", deltas.dms);
        addUnseenCommunityItems(deltas.sessions + deltas.recs + deltas.suggestions);
      }

      // Refs first: a second notification arriving before React renders must
      // diff against these values, not the stale ones, or items count twice.
      sessionsRef.current = next.sessions;
      recommendationsRef.current = next.recommendations;
      suggestionsRef.current = next.suggestions;
      dmsRef.current = next.dms;

      setSessions(next.sessions);
      setRecommendations(next.recommendations);
      setSuggestions(next.suggestions);
      setDms(next.dms);
      setFriends(loadFriends());
      setCircles(loadCircles());
      refreshUnseenCounts();
    },
    [refreshUnseenCounts],
  );

  // The engine writes merged remote data through friendsStorage, which fans
  // out a change notification — that is the reload trigger (no polling).
  useEffect(() => subscribeFriendsDbChange(() => reloadAll(true)), [reloadAll]);

  // The disk-DB load can land after mount; useFriendsData bumps its version.
  const prevDbLoadVersion = useRef(fd.dbLoadVersion);
  useEffect(() => {
    if (prevDbLoadVersion.current === fd.dbLoadVersion) return;
    prevDbLoadVersion.current = fd.dbLoadVersion;
    reloadAll(false);
  }, [fd.dbLoadVersion, reloadAll]);

  // ── Requests ────────────────────────────────────────────────────

  const { incoming, outgoing } = useMemo(
    () => classifyFriendsByConsent(friends),
    [friends],
  );
  const invitations = useMemo(
    () => incoming.map(toInvitation),
    [incoming],
  );
  const outgoingRequests = useMemo(
    () => outgoing.map(toInvitation),
    [outgoing],
  );

  // ── Self snapshot (used by the compare / race derivations) ──────

  const selfSharedGames = useMemo<SharedGameStat[]>(() => {
    return games.map((game) => {
      const achData = summaries[game.id];
      const achTotal = achData?.total || 0;
      const achUnlocked = achData?.unlocked || 0;
      const achievementPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : 0;
      return {
        id: game.id,
        name: game.name,
        playTimeMin: parsePlayTime(game.playTime),
        achievementPercent,
        genres: (game as { genres?: string[] }).genres || [],
      };
    });
  }, [games, summaries]);

  // ── Profile save (the storage write notifies the engine) ────────

  const saveProfile = useCallback(async () => {
    saveUserProfile(profile);
    showToast(t("friendsPage.profileUpdated"), "success");
  }, [profile, showToast, t]);

  // ── Friend mutations (authoritative here) ───────────────────────

  const persistFriends = useCallback((updated: Friend[]) => {
    setFriends(updated);
    saveFriends(updated);
  }, []);

  const handleTogglePin = useCallback(
    (friendId: string) => {
      persistFriends(friendsRef.current.map((f) => (f.id === friendId ? { ...f, pinned: !f.pinned } : f)));
    },
    [persistFriends],
  );

  const handleToggleBlock = useCallback(
    (friendId: string, friendName: string) => {
      const friend = friendsRef.current.find((f) => f.id === friendId);
      if (!friend) return;
      const blocking = !friend.blocked;
      persistFriends(
        friendsRef.current.map((f) => (f.id === friendId ? { ...f, blocked: blocking } : f)),
      );
      const pubkey = asPeerPubkey(friend.syncId);
      // Blocking drops the peer's cached revisions and queued events; the
      // local record keeps the block so a restart cannot resubscribe.
      if (blocking && pubkey) blockPeer(pubkey);
      showToast(
        blocking
          ? t("friendsPage.blockedFriend", { name: friendName })
          : t("friendsPage.unblockedFriend", { name: friendName }),
        "info",
      );
    },
    [persistFriends, blockPeer, showToast, t],
  );

  const handleDeleteFriend = useCallback(
    (friendId: string, friendName: string) => {
      const friend = friendsRef.current.find((f) => f.id === friendId);
      if (!friend) return;
      const pubkey = asPeerPubkey(friend.syncId);
      if (pubkey) {
        removePeer(pubkey);
      } else {
        persistFriends(friendsRef.current.filter((f) => f.id !== friendId));
      }
      setSelectedCompareFriendId((prev) => (prev === friendId ? "" : prev));
      showToast(t("friendsPage.removedFromFriends", { name: friendName }), "info");
    },
    [persistFriends, removePeer, showToast, t],
  );

  const handleSetNickname = useCallback(
    (friendId: string, nickname: string) => {
      persistFriends(
        friendsRef.current.map((f) => (f.id === friendId ? { ...f, nickname: nickname.trim() || undefined } : f)),
      );
    },
    [persistFriends],
  );

  // Accepting answers the peer with an `accept` envelope plus our first
  // snapshot; the engine does both, so nothing else is needed here.
  const handleAcceptInvitation = useCallback(
    (invite: FriendInvitation) => {
      const pubkey = asPeerPubkey(invite.syncId);
      if (!pubkey) return;
      acceptFriend(pubkey);
      showToast(t("friendsPage.acceptedInvitation", { name: invite.name }), "success");
    },
    [acceptFriend, showToast, t],
  );

  // Denying blocks the peer: the record stays, their envelopes are dropped,
  // and the invitation never comes back.
  const handleDenyInvitation = useCallback(
    (syncId: string) => {
      const pubkey = asPeerPubkey(syncId);
      if (pubkey) blockPeer(pubkey);
      showToast(t("friendsPage.invitationDenied"), "info");
    },
    [blockPeer, showToast, t],
  );

  const handleResendRequest = useCallback(
    (syncId: string) => {
      const pubkey = asPeerPubkey(syncId);
      if (!pubkey) return;
      sendFriendRequest(pubkey);
    },
    [sendFriendRequest],
  );

  const handleCopyCode = useCallback(() => {
    if (!fd.generatedFriendCode) return;
    navigator.clipboard.writeText(fd.generatedFriendCode);
    showToast(t("friendsPage.keyCopied"), "success");
  }, [fd.generatedFriendCode, showToast, t]);

  // ── Session mutations (authoritative here) ──────────────────────

  const persistSessions = useCallback(async (updated: GameSession[]) => {
    sessionsRef.current = updated;
    setSessions(updated);
    saveSessions(updated);
  }, []);

  const handleCreateSession = useCallback(
    async (input: CreateSessionInput): Promise<boolean> => {
      if (!input.gameId || !input.scheduledAt) {
        showToast(t("friendsPage.selectGameAndTime"), "error");
        return false;
      }
      const viewerTimezone = detectTimezone();
      const conflict = sessionsRef.current.find(
        (s) =>
          !s.deleted &&
          s.creatorName === profile.name &&
          sessionsConflict(s, { scheduledAt: input.scheduledAt, durationMin: input.durationMin }),
      );
      const newSession: GameSession = {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        gameId: input.gameId,
        gameName:
          input.gameName || games.find((g) => g.id === input.gameId)?.name || t("friendsPage.unknownGame"),
        scheduledAt: input.scheduledAt,
        maxPlayers: Number(input.maxPlayers) || 4,
        description: input.description,
        creatorName: profile.name,
        attendees: [profile.name],
        rsvps: { [profile.name]: "going" },
        updatedAt: Date.now(),
        creatorTimezone: viewerTimezone,
        invited: input.invited,
        durationMin: Number(input.durationMin) || 120,
        participants: [{ name: profile.name, role: "host", timezone: viewerTimezone }],
        messages: [],
      };
      let updated = [newSession, ...sessionsRef.current];
      if (conflict) {
        updated = updated.map((s) =>
          s.id === conflict.id
            ? {
                ...s,
                rsvps: { ...(s.rsvps || {}), [profile.name]: "declined" },
                attendees: (s.attendees || []).filter((n) => n !== profile.name),
                updatedAt: Date.now(),
              }
            : s,
        );
        showToast(t("friendsPage.scheduledAutoDeclined", { game: conflict.gameName }), "warning");
      } else {
        showToast(t("friendsPage.sessionScheduled"), "success");
      }
      await persistSessions(updated);
      return true;
    },
    [profile, games, persistSessions, showToast, t],
  );

  const handleSetRsvp = useCallback(
    async (sessionId: string, status: RsvpStatus) => {
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const rsvps = { ...(s.rsvps || {}) };
        if (rsvps[profile.name] === status) {
          delete rsvps[profile.name];
        } else {
          rsvps[profile.name] = status;
        }
        const isGoing = rsvps[profile.name] === "going";
        const attendees = isGoing
          ? Array.from(new Set([...(s.attendees || []), profile.name]))
          : (s.attendees || []).filter((n) => n !== profile.name);
        const existingParticipant = (s.participants || []).find((p) => p.name === profile.name);
        const participants = (s.participants || []).filter((p) => p.name !== profile.name);
        if (isGoing) {
          participants.unshift({
            ...(existingParticipant || {}),
            name: profile.name,
            role: existingParticipant?.role ?? "player",
            timezone: existingParticipant?.timezone || detectTimezone(),
          });
        }
        const label = rsvps[profile.name]
          ? t(
              rsvps[profile.name] === "going"
                ? "bigscreen.friends.going"
                : rsvps[profile.name] === "maybe"
                  ? "bigscreen.friends.maybe"
                  : "bigscreen.friends.decline",
            )
          : t("friendsPage.noResponse");
        showToast(t("friendsPage.rsvpSet", { status: label }), "info");
        return { ...s, rsvps, attendees, participants, updatedAt: Date.now() };
      });
      await persistSessions(updated);
    },
    [profile.name, persistSessions, showToast, t],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const updated = sessionsRef.current.map((s) =>
        s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s,
      );
      await persistSessions(updated);
      showToast(t("friendsPage.sessionRemoved"), "info");
    },
    [persistSessions, showToast, t],
  );

  const handleSendSessionMessage = useCallback(
    async (sessionId: string, text: string) => {
      const msg: SessionMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        author: profile.name,
        text,
        timestamp: Date.now(),
      };
      const updated = sessionsRef.current.map((s) =>
        s.id === sessionId
          ? { ...s, messages: [...(s.messages || []), msg], updatedAt: Date.now() }
          : s,
      );
      await persistSessions(updated);
    },
    [profile.name, persistSessions],
  );

  const handleSetRole = useCallback(
    async (sessionId: string, name: string, role: SessionRole) => {
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const participants = (s.participants || []).map((p) => (p.name === name ? { ...p, role } : p));
        if (!participants.some((p) => p.name === name)) participants.push({ name, role });
        return { ...s, participants, updatedAt: Date.now() };
      });
      await persistSessions(updated);
    },
    [persistSessions],
  );

  const handleAddGuest = useCallback(
    async (sessionId: string, guestName: string) => {
      const trimmed = guestName.trim();
      if (!trimmed) return;
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const participants = [...(s.participants || [])];
        if (!participants.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
          participants.push({ name: trimmed, role: "player", guest: true, timezone: detectTimezone() });
        }
        const rsvps = { ...(s.rsvps || {}) };
        if (rsvps[trimmed] === undefined) rsvps[trimmed] = "going";
        const attendees = Array.from(new Set([...(s.attendees || []), trimmed]));
        return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
      });
      await persistSessions(updated);
      showToast(t("friendsPage.guestAdded", { name: trimmed }), "success");
    },
    [persistSessions, showToast, t],
  );

  const handleRemoveGuest = useCallback(
    async (sessionId: string, guestName: string) => {
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const participants = (s.participants || []).filter((p) => !(p.guest && p.name === guestName));
        const rsvps = { ...(s.rsvps || {}) };
        delete rsvps[guestName];
        const attendees = (s.attendees || []).filter((n) => n !== guestName);
        return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
      });
      await persistSessions(updated);
    },
    [persistSessions],
  );

  const handleSetRsvpNote = useCallback(
    async (sessionId: string, note: string) => {
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const participants = [...(s.participants || [])];
        const idx = participants.findIndex((p) => p.name === profile.name);
        if (idx >= 0) participants[idx] = { ...participants[idx], note: note || undefined };
        else
          participants.push({
            name: profile.name,
            role: "player",
            note: note || undefined,
            timezone: detectTimezone(),
          });
        return { ...s, participants, updatedAt: Date.now() };
      });
      await persistSessions(updated);
    },
    [profile.name, persistSessions],
  );

  const handleTogglePinMessage = useCallback(
    async (sessionId: string, messageId: string) => {
      const updated = sessionsRef.current.map((s) => {
        if (s.id !== sessionId) return s;
        const messages = (s.messages || []).map((m) =>
          m.id === messageId ? { ...m, pinned: !m.pinned } : m,
        );
        return { ...s, messages, updatedAt: Date.now() };
      });
      await persistSessions(updated);
    },
    [persistSessions],
  );

  // ── DM handlers ─────────────────────────────────────────────────

  /** Resolve the peer behind a thread id (pubkey-addressed or legacy). */
  const peerForThread = useCallback(
    (threadId: string): string | null => {
      const thread = dmsRef.current.find((t) => t.id === threadId) ?? null;
      return peerPubkeyForThread(thread ?? { participants: [] }, friendsRef.current, {
        myPubkey: profileRef.current.syncId,
        myName: profileRef.current.name,
      });
    },
    [],
  );

  const handleOpenDmThread = useCallback(
    (threadId: string, friendName: string) => {
      setSelectedDmId(threadId);
      setSelectedDmFriendName(friendName);
      clearUnseenTabItems("dms");
      refreshUnseenCounts();

      const thread = dmsRef.current.find((t) => t.id === threadId);
      if (!thread) return;
      const lastRead = thread.lastReadAt?.[profile.name] || 0;
      const unread = (thread.messages || []).some(
        (m) => m.author !== profile.name && m.timestamp > lastRead,
      );
      if (!unread) return;

      const upTo = Date.now();
      const updated = dmsRef.current.map((t) =>
        t.id === threadId
          ? { ...t, lastReadAt: { ...(t.lastReadAt || {}), [profile.name]: upTo } }
          : t,
      );
      dmsRef.current = updated;
      setDms(updated);
      saveDmsAndPersist(updated);

      // Read receipts are opt-in: when disabled our read state never leaves
      // the device, and the local badge logic above still works.
      if (!dmReadReceipts) return;
      const peer = peerPubkeyForThread(thread, friendsRef.current, {
        myPubkey: profile.syncId,
        myName: profile.name,
      });
      if (peer) {
        sendChat(peer, { type: "read", threadId, upTo, at: upTo });
      }
    },
    [profile.name, profile.syncId, dmReadReceipts, sendChat, refreshUnseenCounts],
  );

  const handleSendDm = useCallback(
    async (friendName: string, text: string) => {
      const trimmed = text.trim();
      if (!friendName || !trimmed) return;

      // A name that maps to no friend, or to more than one, yields null and
      // the message stays local — we never guess a recipient.
      const peer = peerPubkeyForThread(
        { participants: [profile.name, friendName] },
        friendsRef.current,
        { myPubkey: profile.syncId, myName: profile.name },
      );
      // The pair thread both sides converge on; null while the identity is
      // still loading, in which case the message stays in a local thread.
      const pairThreadId = peer ? dmThreadIdForPeer(peer) : null;

      // Reuse the live thread with this friend, else start a fresh one (a
      // tombstoned conversation must not swallow the new messages).
      const existingThread =
        dmsRef.current.find(
          (th) =>
            !th.deleted &&
            th.participants.includes(profile.name) &&
            th.participants.includes(friendName),
        ) ??
        (pairThreadId
          ? dmsRef.current.find((th) => !th.deleted && th.id === pairThreadId)
          : undefined);
      const threadId = existingThread?.id ?? pairThreadId ?? startDmThreadId(profile.name, friendName, dmsRef.current);

      const msg: SessionMessage = {
        id: `dm_msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        author: profile.name,
        text: trimmed,
        timestamp: Date.now(),
      };
      const current = dmsRef.current;
      let updated = current.map((th) =>
        th.id === threadId
          ? { ...th, messages: [...(th.messages || []), msg], updatedAt: Date.now() }
          : th,
      );
      if (!updated.some((th) => th.id === threadId)) {
        updated = [
          {
            id: threadId,
            participants: [profile.name, friendName].sort(),
            messages: [msg],
            updatedAt: Date.now(),
          },
          ...updated,
        ];
      }
      // Sending counts as reading — record our read receipt locally (it is
      // only shared when read receipts are enabled).
      updated = updated.map((th) =>
        th.id === threadId
          ? { ...th, lastReadAt: { ...(th.lastReadAt || {}), [profile.name]: Date.now() } }
          : th,
      );
      dmsRef.current = updated;
      setDms(updated);
      saveDmsAndPersist(updated);
      // Sending in a thread counts as reading it — clear the dms badge.
      clearUnseenTabItems("dms");
      refreshUnseenCounts();

      // An ambiguous name (no match or several) keeps the message local: we
      // never guess a recipient for someone else's inbox.
      if (!peer) return;
      sendChat(peer, {
        type: "message",
        id: msg.id,
        threadId,
        body: trimmed,
        sentAt: msg.timestamp,
      });
    },
    [profile.name, profile.syncId, sendChat, refreshUnseenCounts],
  );

  // ── Recommendation handlers ─────────────────────────────────────

  const persistRecommendations = useCallback(
    async (updated: GameRecommendation[]) => {
      recommendationsRef.current = updated;
      setRecommendations(updated);
      saveRecommendations(updated);
    },
    [],
  );

  const handleCreateRecommendation = useCallback(
    async (input: { gameId: string; to: string; rating: number; reason: string }) => {
      if (!input.gameId || !input.reason.trim()) {
        showToast(t("friendsPage.selectGameAndNotes"), "error");
        return;
      }
      const game = games.find((g) => g.id === input.gameId);
      if (!game) return;
      const newRec: GameRecommendation = {
        id: `rec_${Date.now()}`,
        gameId: input.gameId,
        gameName: game.name,
        recommendedBy: profile.name,
        recommendedTo: input.to,
        reason: input.reason,
        rating: input.rating,
        comments: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await persistRecommendations([newRec, ...recommendationsRef.current]);
      showToast(t("friendsPage.gameRecommended"), "success");
    },
    [games, profile.name, persistRecommendations, showToast, t],
  );

  const handleToggleReaction = useCallback(
    async (recId: string, kind: ReactionKind) => {
      const updated = recommendationsRef.current.map((r) => {
        if (r.id !== recId) return r;
        const reactions = { ...(r.reactions || {}) };
        if (reactions[profile.name] === kind) {
          delete reactions[profile.name];
        } else {
          reactions[profile.name] = kind;
        }
        return { ...r, reactions, updatedAt: Date.now() };
      });
      await persistRecommendations(updated);
    },
    [profile.name, persistRecommendations],
  );

  const handleToggleWantToPlay = useCallback(
    async (recId: string) => {
      const updated = recommendationsRef.current.map((r) =>
        r.id === recId ? { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() } : r,
      );
      await persistRecommendations(updated);
      const rec = updated.find((r) => r.id === recId);
      showToast(
        rec?.wantToPlay ? t("friendsPage.addedToWantToPlay") : t("friendsPage.removedFromWantToPlay"),
        "info",
      );
    },
    [persistRecommendations, showToast, t],
  );

  const handleDeleteRecommendation = useCallback(
    async (recId: string) => {
      const updated = recommendationsRef.current.map((r) =>
        r.id === recId ? { ...r, deleted: true, updatedAt: Date.now() } : r,
      );
      await persistRecommendations(updated);
      showToast(t("friendsPage.recommendationRemoved"), "info");
    },
    [persistRecommendations, showToast, t],
  );

  const handleAddComment = useCallback(
    async (recId: string, text: string) => {
      const commentText = text.trim();
      if (!commentText) return;
      const newComment: RecommendationComment = {
        id: `comment_${Date.now()}`,
        authorName: profile.name,
        text: commentText,
        timestamp: Date.now(),
      };
      const updated = recommendationsRef.current.map((r) =>
        r.id === recId ? { ...r, comments: [...(r.comments ?? []), newComment], updatedAt: Date.now() } : r,
      );
      await persistRecommendations(updated);
      showToast(t("friendsPage.commentPosted"), "success");
    },
    [profile.name, persistRecommendations, showToast, t],
  );

  const handleDeleteComment = useCallback(
    async (recId: string, commentId: string, authorName: string) => {
      if (authorName !== profile.name) {
        showToast(t("friendsPage.cantDeleteOthers"), "error");
        return;
      }
      const updated = recommendationsRef.current.map((r) =>
        r.id === recId
          ? { ...r, comments: (r.comments ?? []).filter((c) => c.id !== commentId), updatedAt: Date.now() }
          : r,
      );
      await persistRecommendations(updated);
    },
    [profile.name, persistRecommendations, showToast, t],
  );

  // ── Wishlist share handlers ─────────────────────────────────────

  const persistSuggestions = useCallback(
    async (updated: GameSuggestion[]) => {
      suggestionsRef.current = updated;
      setSuggestions(updated);
      saveSuggestions(updated);
    },
    [],
  );

  const handleCreateSuggestion = useCallback(
    async (input: { gameId: string; to: string; note: string }) => {
      if (!input.gameId) {
        showToast(t("friendsPage.pickWishlistedGame"), "error");
        return;
      }
      const wishItem = wishlist.find((w) => w.slug === input.gameId);
      if (!wishItem) {
        showToast(t("friendsPage.gameNotInWishlist"), "error");
        return;
      }
      const newSug: GameSuggestion = {
        id: `sug_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
        gameId: wishItem.slug,
        gameName: wishItem.name,
        coverUrl: wishItem.coverUrl || undefined,
        note: input.note.trim(),
        suggestedBy: profile.name,
        suggestedTo: input.to,
        comments: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await persistSuggestions([newSug, ...suggestionsRef.current]);
      showToast(t("friendsPage.sharedFromWishlist", { game: wishItem.name }), "success");
    },
    [wishlist, profile.name, persistSuggestions, showToast, t],
  );

  const handleDeleteSuggestion = useCallback(
    async (sugId: string) => {
      const updated = suggestionsRef.current.map((s) =>
        s.id === sugId ? { ...s, deleted: true, updatedAt: Date.now() } : s,
      );
      await persistSuggestions(updated);
      showToast(t("friendsPage.suggestionRemoved"), "info");
    },
    [persistSuggestions, showToast, t],
  );

  const handleToggleSuggestionReaction = useCallback(
    async (sugId: string, kind: SuggestionReactionKind) => {
      const updated = suggestionsRef.current.map((s) => {
        if (s.id !== sugId) return s;
        const reactions = { ...(s.reactions || {}) };
        if (reactions[profile.name] === kind) {
          delete reactions[profile.name];
        } else {
          reactions[profile.name] = kind;
        }
        return { ...s, reactions, updatedAt: Date.now() };
      });
      await persistSuggestions(updated);
    },
    [profile.name, persistSuggestions],
  );

  const handleAddSuggestionComment = useCallback(
    async (sugId: string, text: string) => {
      const commentText = text.trim();
      if (!commentText) return;
      const comment: SuggestionComment = {
        id: `sugc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        authorName: profile.name,
        text: commentText,
        timestamp: Date.now(),
      };
      const updated = suggestionsRef.current.map((s) =>
        s.id === sugId
          ? { ...s, comments: [...(s.comments ?? []), comment], updatedAt: Date.now() }
          : s,
      );
      await persistSuggestions(updated);
    },
    [profile.name, persistSuggestions],
  );

  const handleDeleteSuggestionComment = useCallback(
    async (sugId: string, commentId: string, authorName: string) => {
      if (authorName !== profile.name) {
        showToast(t("friendsPage.cantDeleteOthers"), "error");
        return;
      }
      const updated = suggestionsRef.current.map((s) =>
        s.id === sugId
          ? {
              ...s,
              comments: (s.comments ?? []).filter((c) => c.id !== commentId),
              updatedAt: Date.now(),
            }
          : s,
      );
      await persistSuggestions(updated);
    },
    [profile.name, persistSuggestions, showToast, t],
  );

  const handleAddSuggestionToWishlist = useCallback(
    async (sug: GameSuggestion) => {
      const alreadyThere = wishlist.some((w) => w.slug === sug.gameId);
      if (alreadyThere) {
        showToast(t("friendsPage.alreadyInWishlist", { game: sug.gameName }), "info");
      } else {
        toggle({
          id: 0,
          slug: sug.gameId,
          name: sug.gameName,
          summary: null,
          rating: null,
          aggregatedRating: null,
          coverUrl: sug.coverUrl || null,
          logoUrl: null,
          genres: [],
          platforms: [],
          firstReleaseDate: null,
          totalRatingCount: 0,
          hypes: 0,
        });
        showToast(t("friendsPage.addedToWishlistToast", { game: sug.gameName }), "success");
      }
      const updated = suggestionsRef.current.map((s) =>
        s.id === sug.id ? { ...s, addedToWishlist: true, updatedAt: Date.now() } : s,
      );
      await persistSuggestions(updated);
    },
    [wishlist, toggle, persistSuggestions, showToast, t],
  );

  // ── Circles ─────────────────────────────────────────────────────

  const handleCreateCircle = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const circle: FriendCircle = {
        id: `circle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: trimmed,
      };
      const updated = [...circles, circle];
      setCircles(updated);
      saveCircles(updated);
    },
    [circles],
  );

  const handleRenameCircle = useCallback(
    (circleId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const updated = circles.map((c) => (c.id === circleId ? { ...c, name: trimmed } : c));
      setCircles(updated);
      saveCircles(updated);
    },
    [circles],
  );

  const handleDeleteCircle = useCallback(
    (circleId: string) => {
      const updatedCircles = circles.filter((c) => c.id !== circleId);
      setCircles(updatedCircles);
      saveCircles(updatedCircles);
      const updatedFriends = friends.map((f) => ({
        ...f,
        groups: (f.groups || []).filter((g) => g !== circleId),
      }));
      setFriends(updatedFriends);
      saveFriends(updatedFriends);
    },
    [circles, friends],
  );

  const handleToggleFriendCircle = useCallback(
    (friendId: string, circleId: string) => {
      const updated = friends.map((f) => {
        if (f.id !== friendId) return f;
        const groups = f.groups || [];
        return {
          ...f,
          groups: groups.includes(circleId)
            ? groups.filter((g) => g !== circleId)
            : [...groups, circleId],
        };
      });
      setFriends(updated);
      saveFriends(updated);
    },
    [friends],
  );

  // ── Derived feeds ───────────────────────────────────────────────

  const myGameIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  const activityFeed = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    sessions
      .filter((s) => !s.deleted)
      .forEach((s) => {
        const mine = s.creatorName === profile.name;
        const myRsvp = s.rsvps?.[profile.name];
        if (mine || myRsvp) {
          items.push({
            key: `session_${s.id}`,
            timestamp: s.updatedAt || new Date(s.scheduledAt).getTime(),
            kind: "session",
            title: t("friendsPage.activitySession", {
              who: mine ? t("friendsPage.me") : s.creatorName,
              game: s.gameName,
            }),
            detail: formatDateTimeLocal(s.scheduledAt, s.creatorTimezone),
            gameName: s.gameName,
          });
        } else if (s.invited?.includes(profile.name)) {
          items.push({
            key: `session_inv_${s.id}`,
            timestamp: s.updatedAt || new Date(s.scheduledAt).getTime(),
            kind: "session",
            title: t("friendsPage.activityInvited", { who: s.creatorName, game: s.gameName }),
            detail: formatDateTimeLocal(s.scheduledAt, s.creatorTimezone),
            gameName: s.gameName,
          });
        }
      });
    recommendations
      .filter((r) => !r.deleted && r.recommendedTo === "All Friends")
      .forEach((r) => {
        items.push({
          key: `rec_${r.id}`,
          timestamp: r.createdAt || r.updatedAt,
          kind: "rec",
          title: t("friendsPage.activityRec", { who: r.recommendedBy, game: r.gameName }),
          detail: r.reason || "",
          gameName: r.gameName,
        });
      });
    suggestions
      .filter((s) => !s.deleted && s.suggestedTo === "All Friends")
      .forEach((s) => {
        items.push({
          key: `suggestion_${s.id}`,
          timestamp: s.createdAt || s.updatedAt,
          kind: "suggestion",
          title: t("friendsPage.activitySuggestion", { who: s.suggestedBy, game: s.gameName }),
          detail: s.note || "",
          gameName: s.gameName,
        });
      });
    friends.forEach((f) => {
      items.push({
        key: `friend_${f.id}`,
        timestamp: f.addedAt || 0,
        kind: "friend",
        title: t("friendsPage.activityFriend", { who: displayName(f) }),
        detail: formatFriendsSinceLocal(f.addedAt, t),
      });
    });
    const unlockWindow = 30 * 24 * 60 * 60 * 1000;
    recentUnlocks.forEach((r) => {
      const a = r.achievement;
      if (!(a.achieved && a.unlockTime > 0)) return;
      if (Date.now() - a.unlockTime * 1000 >= unlockWindow) return;
      const game = games.find((g) => g.id === r.gameId);
      if (!game) return;
      items.push({
        key: `ach_${r.gameId}_${a.apiName}`,
        timestamp: a.unlockTime * 1000,
        kind: "achievement",
        title: t("friendsPage.activityUnlock", { game: game.name, ach: a.displayName }),
        detail: "",
        gameName: game.name,
      });
    });
    return items
      .filter((i) => i.timestamp > 0)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [sessions, recommendations, suggestions, friends, recentUnlocks, games, profile.name, t]);

  const playingNow = useMemo<PlayingNowEntry[]>(() => {
    const byName = new Map<string, Game>();
    games.forEach((g) => byName.set(g.name.toLowerCase(), g));
    const entries: PlayingNowEntry[] = [];
    for (const f of friends) {
      if (f.blocked) continue;
      const playing = safeCurrentlyPlaying(f.currentlyPlaying);
      if (!playing) continue;
      entries.push({ friend: f, playing, game: byName.get(playing.toLowerCase()) });
      if (entries.length >= 12) break;
    }
    return entries;
  }, [friends, games]);

  // ── Leaderboard / Race ──────────────────────────────────────────

  const [leaderboardMetric, setLeaderboardMetric] = useState<"playtime" | "games" | "achievements">("playtime");

  const leaderboardPlayers = useMemo<LeaderboardPlayer[]>(() => {
    const players: Omit<LeaderboardPlayer, "rank" | "value" | "max">[] = [
      {
        key: "me",
        name: profile.name,
        avatar: profile.avatar,
        isYou: true,
        currentlyPlaying: safeCurrentlyPlaying(profile.currentlyPlaying),
        gamesCount: fd.selfStats.gamesCount,
        playtimeMinutes: fd.selfStats.playtimeMinutes,
        achievementsCount: fd.selfStats.achievementsCount,
      },
      ...friends
        .filter((f) => !f.blocked)
        .map((f) => ({
          key: f.id,
          name: displayName(f),
          avatar: f.avatar,
          isYou: false,
          currentlyPlaying: safeCurrentlyPlaying(f.currentlyPlaying),
          gamesCount: f.libStats?.gamesCount || 0,
          playtimeMinutes: f.libStats?.playtimeMinutes || 0,
          achievementsCount: f.libStats?.achievementsCount || 0,
        })),
    ];
    const scoreOf = (p: (typeof players)[number]) =>
      leaderboardMetric === "playtime"
        ? p.playtimeMinutes
        : leaderboardMetric === "games"
          ? p.gamesCount
          : p.achievementsCount;
    const ranked = [...players].sort((a, b) => scoreOf(b) - scoreOf(a));
    const top = scoreOf(ranked[0] || players[0]) || 1;
    return ranked.map((p, i) => ({ ...p, rank: i + 1, value: scoreOf(p), max: top }));
  }, [friends, profile, fd.selfStats, leaderboardMetric]);

  const achievementRaces = useMemo<RaceEntry[]>(() => {
    const selfPercent = new Map<string, number>();
    selfSharedGames.forEach((g) => selfPercent.set(g.id, g.achievementPercent));
    const races: RaceEntry[] = [];
    friends
      .filter((f) => !f.blocked && f.games && f.games.length > 0)
      .forEach((f) => {
        (f.games || []).forEach((g) => {
          if (isAppBlacklisted(g.name, g.id)) return;
          const me = selfPercent.get(g.id);
          if (me === undefined) return;
          races.push({
            key: `${f.id}_${g.id}`,
            gameId: g.id,
            gameName: g.name,
            friendName: displayName(f),
            me,
            them: g.achievementPercent || 0,
          });
        });
      });
    return races.sort((a, b) => Math.abs(b.me - b.them) - Math.abs(a.me - a.them));
  }, [friends, selfSharedGames]);

  // ── Compare state + derivations ─────────────────────────────────

  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState("");
  const [compareSubTab, setCompareSubTab] = useState<"overview" | "games" | "genres" | "insights">("overview");
  const [compareFilter, setCompareFilter] = useState<"all" | "shared" | "me_only" | "friend_only">("all");
  const [compareSort, setCompareSort] = useState<"name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement">("name");
  const [compareGenre, setCompareGenre] = useState("all");
  const [compareSearch, setCompareSearch] = useState("");

  useEffect(() => {
    setCompareSubTab("overview");
    setCompareFilter("all");
    setCompareGenre("all");
    setCompareSearch("");
  }, [selectedCompareFriendId]);

  const compareFriend = useMemo(
    () => friends.find((f) => f.id === selectedCompareFriendId) || null,
    [friends, selectedCompareFriendId],
  );

  const comparisonData = useMemo<CompareItem[]>(() => {
    if (!compareFriend) return [];
    const friendGames = (compareFriend.games || []).filter((g) => !isAppBlacklisted(g.name, g.id));
    const friendGameMap = new Map(friendGames.map((g) => [g.id, g]));
    const friendName = compareFriend.name;
    let hash = 0;
    for (let i = 0; i < friendName.length; i++) {
      hash = friendName.charCodeAt(i) + ((hash << 5) - hash);
    }
    let seed = Math.abs(hash);
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    const compareList: CompareItem[] = [];
    const selfById = new Map(games.map((g) => [g.id, g]));
    const ids = new Set<string>([
      ...games.filter((g) => !isAppBlacklisted(g.name, g.id)).map((g) => g.id),
      ...friendGames.map((g) => g.id),
    ]);
    ids.forEach((id) => {
      const myGame = selfById.get(id);
      const friendGame = friendGameMap.get(id);
      const selfAchData = myGame ? summaries[myGame.id] : undefined;
      const selfAchTotal = selfAchData?.total || 0;
      const selfAchUnlocked = selfAchData?.unlocked || 0;
      const selfAchPercent = selfAchTotal > 0 ? Math.round((selfAchUnlocked / selfAchTotal) * 100) : 0;
      const name = myGame?.name || friendGame?.name || id;
      const legacyOwned = friendGames.length === 0 ? prng() > 0.45 : false;
      const ownedByFriend = friendGame ? true : legacyOwned;
      const playTimeFriend = friendGame
        ? friendGame.playTimeMin
        : legacyOwned
          ? Math.floor(prng() * 12000) + 120
          : 0;
      const achievementFriend = friendGame
        ? friendGame.achievementPercent
        : legacyOwned
          ? Math.floor(prng() * 100)
          : 0;
      compareList.push({
        id,
        name,
        ownedByMe: !!myGame,
        ownedByFriend,
        playTimeMe: myGame ? parsePlayTime(myGame.playTime) : 0,
        playTimeFriend,
        achievementMe: selfAchPercent,
        achievementFriend,
        genres: (myGame as { genres?: string[] })?.genres || friendGame?.genres || [],
        estimated: friendGames.length === 0,
      });
    });
    return compareList;
  }, [games, summaries, compareFriend]);

  const matchScore = useMemo(() => {
    if (!compareFriend || comparisonData.length === 0) return 0;
    const sharedCount = comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend).length;
    return comparisonData.length > 0 ? Math.round((sharedCount / comparisonData.length) * 100) : 0;
  }, [compareFriend, comparisonData]);

  const genreBreakdown = useMemo<GenreRow[]>(() => {
    if (!comparisonData.length) return [];
    const map = new Map<string, GenreRow>();
    comparisonData.forEach((item) => {
      const genres: string[] = item.genres.length ? item.genres : [t("friendsPage.uncategorized")];
      genres.forEach((g) => {
        const key = g || t("friendsPage.uncategorized");
        const row =
          map.get(key) ||
          { genre: key, meOwned: 0, friendOwned: 0, shared: 0, mePlay: 0, friendPlay: 0, total: 0 };
        row.total++;
        if (item.ownedByMe) {
          row.meOwned++;
          row.mePlay += item.playTimeMe;
        }
        if (item.ownedByFriend) {
          row.friendOwned++;
          row.friendPlay += item.playTimeFriend;
        }
        if (item.ownedByMe && item.ownedByFriend) row.shared++;
        map.set(key, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [comparisonData, t]);

  const genreAffinity = useMemo(() => {
    if (!genreBreakdown.length) return 0;
    const shared = genreBreakdown.filter((g) => g.meOwned > 0 && g.friendOwned > 0).length;
    return Math.round((shared / genreBreakdown.length) * 100);
  }, [genreBreakdown]);

  const compatibilityScore = useMemo(
    () => Math.round(matchScore * 0.6 + genreAffinity * 0.4),
    [matchScore, genreAffinity],
  );

  const comparisonSummary = useMemo<CompareSummary | null>(() => {
    if (!comparisonData.length) return null;
    let sharedCount = 0;
    let myPlaytime = 0;
    let friendPlaytime = 0;
    let myAchievementsSum = 0;
    let friendAchievementsSum = 0;
    comparisonData.forEach((item) => {
      if (item.ownedByMe && item.ownedByFriend) sharedCount++;
      myPlaytime += item.playTimeMe;
      friendPlaytime += item.playTimeFriend;
      myAchievementsSum += item.achievementMe;
      friendAchievementsSum += item.achievementFriend;
    });
    const myOwned = comparisonData.filter((i) => i.ownedByMe).length;
    const friendOwned = comparisonData.filter((i) => i.ownedByFriend).length;
    return {
      sharedCount,
      myOwned,
      friendOwned,
      meOnlyCount: comparisonData.filter((i) => i.ownedByMe && !i.ownedByFriend).length,
      friendOnlyCount: comparisonData.filter((i) => !i.ownedByMe && i.ownedByFriend).length,
      myPlaytime,
      friendPlaytime,
      averageMyAchievements: Math.round(myAchievementsSum / (myOwned || 1)),
      averageFriendAchievements: Math.round(friendAchievementsSum / (friendOwned || 1)),
    };
  }, [comparisonData]);

  const compareInsights = useMemo<CompareInsights | null>(() => {
    if (!comparisonData.length || !compareFriend) return null;
    const shared = comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend);
    const meOnly = comparisonData.filter((i) => i.ownedByMe && !i.ownedByFriend);
    const friendOnly = comparisonData.filter((i) => !i.ownedByMe && i.ownedByFriend);
    const iPlayMore = [...shared]
      .filter((i) => i.playTimeMe > i.playTimeFriend)
      .sort((a, b) => b.playTimeMe - b.playTimeFriend - (a.playTimeMe - a.playTimeFriend))
      .slice(0, 5);
    const theyPlayMore = [...shared]
      .filter((i) => i.playTimeFriend > i.playTimeMe)
      .sort((a, b) => b.playTimeFriend - b.playTimeMe - (a.playTimeFriend - a.playTimeMe))
      .slice(0, 5);
    const forYou = [...friendOnly].sort((a, b) => b.playTimeFriend - a.playTimeFriend).slice(0, 6);
    const forThem = [...meOnly].sort((a, b) => b.playTimeMe - a.playTimeMe).slice(0, 6);
    const topShared = [...shared].sort(
      (a, b) => b.playTimeMe + b.playTimeFriend - (a.playTimeMe + a.playTimeFriend),
    )[0];
    const achLeaderMe = shared.filter((i) => i.achievementMe > i.achievementFriend).length;
    const achLeaderFriend = shared.filter((i) => i.achievementFriend > i.achievementMe).length;
    return { iPlayMore, theyPlayMore, forYou, forThem, topShared, achLeaderMe, achLeaderFriend };
  }, [comparisonData, compareFriend]);

  const compareGenres = useMemo(() => {
    const set = new Set<string>();
    comparisonData.forEach((item) => item.genres.forEach((g) => set.add(g)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [comparisonData]);

  // ── Session cover resolver ──────────────────────────────────────

  const gameCoverForSession = useMemo(() => {
    const libMap = new Map<string, string>();
    games.forEach((g) => {
      if (g.coverArtUrl) libMap.set(String(g.id), g.coverArtUrl);
    });
    return (session: GameSession): string | undefined => {
      const id = session.gameId;
      if (id.startsWith("store_")) {
        const slug = id.slice("store_".length);
        try {
          const raw = localStorage.getItem("gamelib.store.cache");
          if (raw) {
            const storeCache = JSON.parse(raw);
            const all = Object.values(storeCache?.categories || {}) as {
              data?: { id: number | string; coverUrl?: string }[];
            }[];
            for (const entry of all) {
              const found = (entry?.data || []).find((g) => String(g.id) === slug);
              if (found?.coverUrl) return found.coverUrl;
            }
          }
        } catch {
          /* ignore */
        }
        return undefined;
      }
      return libMap.get(id);
    };
  }, [games]);

  return {
    friends,
    sessions,
    recommendations,
    suggestions,
    dms,
    circles,
    invitations,
    outgoingRequests,
    unseenCounts,
    activityFeed,
    playingNow,
    leaderboardPlayers,
    achievementRaces,
    myGameIds,
    gameCoverForSession,
    peerForThread,
    selectedCompareFriendId,
    setSelectedCompareFriendId,
    compareSubTab,
    setCompareSubTab,
    compareFilter,
    setCompareFilter,
    compareSort,
    setCompareSort,
    compareGenre,
    setCompareGenre,
    compareSearch,
    setCompareSearch,
    compareFriend,
    comparisonData,
    comparisonSummary,
    compareInsights,
    genreBreakdown,
    genreAffinity,
    matchScore,
    compatibilityScore,
    compareGenres,
    leaderboardMetric,
    setLeaderboardMetric,
    selectedDmId,
    selectedDmFriendName,
    setSelectedDmId,
    setSelectedDmFriendName,
    handleOpenDmThread,
    handleSendDm,
    handleTogglePin,
    handleToggleBlock,
    handleDeleteFriend,
    handleSetNickname,
    handleAcceptInvitation,
    handleDenyInvitation,
    handleResendRequest,
    handleCreateSession,
    handleSetRsvp,
    handleDeleteSession,
    handleSendSessionMessage,
    handleSetRole,
    handleAddGuest,
    handleRemoveGuest,
    handleSetRsvpNote,
    handleTogglePinMessage,
    handleCreateRecommendation,
    handleToggleReaction,
    handleToggleWantToPlay,
    handleDeleteRecommendation,
    handleAddComment,
    handleDeleteComment,
    handleCreateSuggestion,
    handleToggleSuggestionReaction,
    handleAddSuggestionComment,
    handleDeleteSuggestionComment,
    handleDeleteSuggestion,
    handleAddSuggestionToWishlist,
    handleCreateCircle,
    handleRenameCircle,
    handleDeleteCircle,
    handleToggleFriendCircle,
    handleCopyCode,
    saveProfile,
    refreshUnseenCounts,
    clearUnseenTab,
  };
}

// Local formatting wrappers (t-bound, matching desktop output).
function formatDateTimeLocal(dateTimeStr: string, tz?: string): string {
  try {
    const d = new Date(dateTimeStr);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    if (tz) {
      try {
        opts.timeZone = tz;
      } catch {
        /* ignore */
      }
    }
    return d.toLocaleString(undefined, opts);
  } catch {
    return dateTimeStr;
  }
}

function formatFriendsSinceLocal(
  addedAt: number | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (!addedAt) return "";
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days < 1) return t("friendsPage.formatFriendsSinceToday");
  if (days < 30)
    return t(days === 1 ? "friendsPage.friendsForDay" : "friendsPage.friendsForDays", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12)
    return t(months === 1 ? "friendsPage.friendsForMonth" : "friendsPage.friendsForMonths", { count: months });
  const years = Math.floor(months / 12);
  return t(years > 1 || months >= 24 ? "friendsPage.friendsForYears" : "friendsPage.friendsForYear", {
    count: years,
  });
}
