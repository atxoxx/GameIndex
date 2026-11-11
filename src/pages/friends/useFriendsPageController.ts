import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { parsePlayTime, slugify, type StoreGameSummary } from "../../types/game";
import { useFriendsSync } from "../../sync/friends/FriendsSyncProvider";
import { dmThreadIdForPeer } from "../../sync/friends/adapter";
import {
  type UserProfile,
  type Friend,
  type GameSession,
  type GameRecommendation,
  type GameSuggestion,
  type FriendCircle,
  type DmThread,
  type SessionMessage,
  type DmAttachment,
  type SharedGameStat,
  type SessionRole,
  type RsvpStatus,
  type ReactionKind,
  type SuggestionReactionKind,
  type UnseenTabKey,
  loadUserProfile,
  saveUserProfile,
  loadFriends,
  saveFriends,
  loadSessions,
  saveSessions,
  loadRecommendations,
  saveRecommendations,
  loadSuggestions,
  saveSuggestions,
  loadCircles,
  saveCircles,
  loadDms,
  saveDmsAndPersist,
  areDmReadReceiptsEnabled,
  decodeFriendCode,
  encodeFriendCode,
  displayName,
  initNostrKeys,
  loadFriendsDbToLocalStorage,
  subscribeFriendsDbChange,
  addUnseenCommunityItems,
  getUnseenTabItems,
  addUnseenTabItems,
  clearUnseenTabItems,
} from "../friendsStorage";
import { nextOccurrence, detectTimezone } from "./friendsUtils";
import {
  asPeerPubkey,
  classifyFriendsByConsent,
  peerPubkeyForThread,
} from "./friendsSyncHelpers";
import type { FriendInvitation, UnseenCounts } from "./friendsTypes";

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Everything the Friends page needs except purely presentational state.
 *
 * Networking lives entirely in the always-on sync engine
 * (`src/sync/friends`): this hook reads and writes local storage, delegates
 * every sync action to `useFriendsSync()`, and reloads from storage whenever
 * the engine merges something in — it never talks to a relay itself.
 */
export function useFriendsPageController() {
  const { t } = useLanguage();
  const { games, runningGameIds } = useGames();
  const { summaries } = useAchievements();
  const { showToast } = useToast();
  const { wishlist, toggle: toggleWishlist } = useWishlistContext();
  const { friendsNotifications } = useSettings();

  const {
    status,
    syncNow,
    sendChat,
    sendFriendRequest,
    acceptFriend,
    blockPeer,
    removePeer,
  } = useFriendsSync();

  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>(() => loadSuggestions());
  const [circles, setCircles] = useState<FriendCircle[]>(() => loadCircles());
  const [dms, setDms] = useState<DmThread[]>(() => loadDms());

  const [unseenCounts, setUnseenCounts] = useState<UnseenCounts>(() => ({
    sessions: getUnseenTabItems("sessions"),
    recs: getUnseenTabItems("recs"),
    suggestions: getUnseenTabItems("suggestions"),
    activity: getUnseenTabItems("activity"),
    dms: getUnseenTabItems("dms"),
  }));

  const dmsRef = useRef<DmThread[]>(dms);
  useEffect(() => {
    dmsRef.current = dms;
  }, [dms]);

  const [deniedIds, setDeniedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gamelib.friends.denied") || "[]");
    } catch {
      return [];
    }
  });

  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);

  // ── Derived library / profile data ──────────────────────────────────

  const selfStats = useMemo(() => {
    let playtimeMinutes = 0;
    games.forEach((game) => {
      if (game.playTime) playtimeMinutes += parsePlayTime(game.playTime);
    });

    let achievementsCount = 0;
    for (const s of Object.values(summaries)) achievementsCount += s.unlocked;

    return { gamesCount: games.length, playtimeMinutes, achievementsCount };
  }, [games, summaries]);

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

  const myGameIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  const generatedFriendCode = useMemo(
    () => encodeFriendCode(profile, selfStats, profile.favoriteGameName),
    [profile, selfStats]
  );

  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | undefined>(profile.currentlyPlaying);

  useEffect(() => {
    if (!runningGameIds || runningGameIds.length === 0) {
      setCurrentlyPlaying(undefined);
      return;
    }
    const game = games.find((g) => g.id === runningGameIds[0]);
    setCurrentlyPlaying(game ? game.name : undefined);
  }, [games, runningGameIds]);

  useEffect(() => {
    setProfile((prev) => {
      if (prev.currentlyPlaying === currentlyPlaying) return prev;
      const updated = { ...prev, currentlyPlaying };
      saveUserProfile(updated);
      return updated;
    });
  }, [currentlyPlaying]);

  // Keeps the background callbacks off a stale render's profile name.
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const reminderNotifiedRef = useRef<Map<string, number>>(new Map());
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());

  const fireNotification = (title: string, body: string) => {
    if (!friendsNotifications) return;
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else if (Notification.permission !== "denied") {
        void Notification.requestPermission().then((perm) => {
          if (perm === "granted") new Notification(title, { body });
        });
      }
    } catch {
      /* notification API unavailable */
    }
  };

  const sessionStartMs = (s: GameSession): number | null => {
    if (s.recurrence) {
      const next = nextOccurrence(s.scheduledAt, s.recurrence, Date.now());
      return next ? new Date(next).getTime() : null;
    }
    const time = new Date(s.scheduledAt).getTime();
    return Number.isNaN(time) ? null : time;
  };

  // ── Storage ⇄ state ─────────────────────────────────────────────────

  const refreshUnseen = () => {
    setUnseenCounts({
      sessions: getUnseenTabItems("sessions"),
      recs: getUnseenTabItems("recs"),
      suggestions: getUnseenTabItems("suggestions"),
      activity: getUnseenTabItems("activity"),
      dms: getUnseenTabItems("dms"),
    });
  };

  // Ids already shown to the user, so a merge only counts what is genuinely
  // new instead of re-badging the whole collection on every reload.
  const knownSessionIds = useRef<Set<string>>(new Set());
  const knownRecIds = useRef<Set<string>>(new Set());
  const knownSuggestionIds = useRef<Set<string>>(new Set());
  const knownMessageIds = useRef<Map<string, Set<string>>>(new Map());

  const primeKnownIds = (db: {
    sessions: GameSession[];
    recommendations: GameRecommendation[];
    suggestions: GameSuggestion[];
    dms: DmThread[];
  }) => {
    knownSessionIds.current = new Set(db.sessions.map((s) => s.id));
    knownRecIds.current = new Set(db.recommendations.map((r) => r.id));
    knownSuggestionIds.current = new Set(db.suggestions.map((s) => s.id));
    knownMessageIds.current = new Map(
      db.dms.map((thread) => [
        thread.id,
        new Set((thread.messages || []).map((m) => m.id)),
      ])
    );
  };

  /**
   * Re-reads everything the engine can merge. Badges are derived from the
   * difference against the last snapshot, so the counters stay honest without
   * polling.
   */
  const reloadFromStorage = () => {
    const myName = profileRef.current.name;
    const myPubkey = profileRef.current.syncId;
    const nextFriends = loadFriends();
    const nextSessions = loadSessions();
    const nextRecommendations = loadRecommendations();
    const nextSuggestions = loadSuggestions();
    const nextDms = loadDms();

    const freshSessions = nextSessions.filter(
      (s) => !s.deleted && !knownSessionIds.current.has(s.id) && s.creatorName !== myName
    );
    const newRecs = nextRecommendations.filter(
      (r) => !r.deleted && !knownRecIds.current.has(r.id) && r.recommendedBy !== myName
    ).length;
    const newSuggestions = nextSuggestions.filter(
      (s) => !s.deleted && !knownSuggestionIds.current.has(s.id) && s.suggestedBy !== myName
    ).length;
    const newSessions = freshSessions.length;

    let newDmMessages = 0;
    const freshMessages: Array<{ name: string; text: string }> = [];
    nextDms.forEach((thread) => {
      if (thread.deleted) return;
      const known = knownMessageIds.current.get(thread.id);
      const fresh = (thread.messages || []).filter(
        (m) =>
          !m.deleted &&
          m.author !== myName &&
          !known?.has(m.id) &&
          !notifiedMsgIdsRef.current.has(m.id)
      );
      if (fresh.length === 0) return;
      fresh.forEach((m) => notifiedMsgIdsRef.current.add(m.id));
      newDmMessages += fresh.length;

      const other = (thread.participants || []).find(
        (participant) => participant !== myName && participant !== myPubkey
      );
      const friend = nextFriends.find(
        (candidate) => candidate.syncId === other || candidate.name === other
      );
      freshMessages.push({
        name: friend?.name || other || "Friend",
        text: fresh[fresh.length - 1].text || "",
      });
    });
    if (notifiedMsgIdsRef.current.size > 5000) notifiedMsgIdsRef.current.clear();

    primeKnownIds({
      sessions: nextSessions,
      recommendations: nextRecommendations,
      suggestions: nextSuggestions,
      dms: nextDms,
    });

    setFriends(nextFriends);
    setSessions(nextSessions);
    setRecommendations(nextRecommendations);
    setSuggestions(nextSuggestions);
    setDms(nextDms);

    if (newSessions > 0) addUnseenTabItems("sessions", newSessions);
    if (newRecs > 0) addUnseenTabItems("recs", newRecs);
    if (newSuggestions > 0) addUnseenTabItems("suggestions", newSuggestions);
    if (newDmMessages > 0) addUnseenTabItems("dms", newDmMessages);
    if (newSessions + newRecs + newSuggestions > 0) {
      addUnseenCommunityItems(newSessions + newRecs + newSuggestions);
    }
    if (newSessions + newRecs + newSuggestions + newDmMessages > 0) refreshUnseen();

    freshMessages.forEach(({ name, text }) => {
      fireNotification(t("friendsPage.notifNewMessage", { name }), text);
    });
    if (freshSessions.length > 0) {
      fireNotification(
        t("friendsPage.notifNewSession", { name: freshSessions[0].creatorName }),
        freshSessions[0].gameName
      );
    }
  };

  // The engine announces every merge through this subscription; nothing here
  // polls, so an idle page costs nothing. The ids are primed before the
  // subscription opens so the first merge cannot badge the whole history.
  const reloadRef = useRef(reloadFromStorage);
  reloadRef.current = reloadFromStorage;
  useEffect(() => {
    primeKnownIds({ sessions, recommendations, suggestions, dms });
    return subscribeFriendsDbChange(() => reloadRef.current());
  }, []);

  // ── Initial load ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The database is a mirror of localStorage, not the live store:
        // hydrate from it only when this profile has nothing yet, otherwise a
        // boot-time read could clobber a snapshot the engine just merged.
        const hasLocalData =
          loadFriends().length > 0 || loadSessions().length > 0 || loadDms().length > 0;
        if (!hasLocalData) await loadFriendsDbToLocalStorage();

        await initNostrKeys();
        if (cancelled) return;

        const nextFriends = loadFriends();
        const nextSessions = loadSessions();
        const nextRecommendations = loadRecommendations();
        const nextSuggestions = loadSuggestions();
        const nextDms = loadDms();

        setProfile(loadUserProfile());
        setFriends(nextFriends);
        setSessions(nextSessions);
        setRecommendations(nextRecommendations);
        setSuggestions(nextSuggestions);
        setDms(nextDms);
        setCircles(loadCircles());
        primeKnownIds({
          sessions: nextSessions,
          recommendations: nextRecommendations,
          suggestions: nextSuggestions,
          dms: nextDms,
        });
      } catch (err) {
        console.error("Failed to initialize the friends page:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDecodedFriend(friendCodeInput.trim() ? decodeFriendCode(friendCodeInput) : null);
  }, [friendCodeInput]);

  // ── Sync surface ────────────────────────────────────────────────────

  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  /**
   * Kept for the page's "sync now" affordances. The engine owns the loop, so
   * this only asks it to run a cycle; results arrive as `syncStatus` changes.
   */
  const performSync = async (_force = false): Promise<void> => {
    syncNowRef.current();
  };

  // A scope change alters what the snapshot contains, so republish at once.
  useEffect(() => {
    const onScopeChange = () => syncNowRef.current();
    window.addEventListener("gamelib:nostr-share-scope-changed", onScopeChange);
    return () => window.removeEventListener("gamelib:nostr-share-scope-changed", onScopeChange);
  }, []);

  const lastSyncedTime = useMemo(
    () => (status.lastSyncedAt ? formatClockTime(status.lastSyncedAt) : ""),
    [status.lastSyncedAt]
  );

  const lastSyncMessage = useMemo(() => {
    if (status.lastError) return t("friendsPage.syncFailed", { reason: status.lastError });
    if (status.lastSyncedAt) return t("friendsPage.upToDatePublished");
    return "";
  }, [status.lastError, status.lastSyncedAt, t]);

  // ── Consent / invitations ───────────────────────────────────────────

  const consentGroups = useMemo(() => classifyFriendsByConsent(friends), [friends]);

  const invitations = useMemo<FriendInvitation[]>(() => {
    return consentGroups.incoming
      .filter((friend) => {
        const pubkey = asPeerPubkey(friend.syncId) ?? friend.syncId;
        return !deniedIds.includes(pubkey);
      })
      .map((friend) => ({
        syncId: asPeerPubkey(friend.syncId) ?? friend.syncId,
        name: friend.name,
        avatar: friend.avatar,
        status: friend.status,
        favoriteGame: friend.favoriteGame,
        libStats: friend.libStats,
      }));
  }, [consentGroups, deniedIds]);

  /** Requests we sent that the peer has not answered yet. */
  const outgoingRequests = consentGroups.outgoing;

  // ── Unseen badges ───────────────────────────────────────────────────

  const resetUnseen = (key: UnseenTabKey) => {
    if (key === "activity") {
      clearUnseenTabItems("sessions");
      clearUnseenTabItems("recs");
      clearUnseenTabItems("suggestions");
      clearUnseenTabItems("activity");
      setUnseenCounts((prev) => ({ ...prev, sessions: 0, recs: 0, suggestions: 0, activity: 0 }));
      return;
    }
    clearUnseenTabItems(key);
    setUnseenCounts((prev) => ({ ...prev, [key]: 0 }));
  };

  // ── Friend actions ──────────────────────────────────────────────────

  const removeFriendRecords = (friendIds: string[]) => {
    const targets = friends.filter((friend) => friendIds.includes(friend.id));
    const legacyIds = new Set<string>();

    targets.forEach((friend) => {
      const pubkey = asPeerPubkey(friend.syncId);
      if (pubkey) removePeer(pubkey);
      else legacyIds.add(friend.id);
    });

    if (legacyIds.size > 0) {
      const remaining = loadFriends().filter((friend) => !legacyIds.has(friend.id));
      setFriends(remaining);
      saveFriends(remaining);
    }
  };

  const handleAddFriend = (): boolean => {
    if (!decodedFriend) return false;
    const pubkey = asPeerPubkey(decodedFriend.syncId);
    if (!pubkey) return false;
    if (pubkey === asPeerPubkey(profile.syncId)) {
      showToast(t("friendsPage.cannotAddYourself"), "error");
      return false;
    }
    const existing = friends.find((friend) => asPeerPubkey(friend.syncId) === pubkey);
    if (existing) {
      showToast(t("friendsPage.alreadyInFriends", { name: displayName(existing) }), "error");
      return false;
    }

    // The engine records the pending friend itself and sends the request.
    sendFriendRequest(pubkey);
    showToast(t("friendsPage.friendRequestSent", { name: decodedFriend.name }), "success");
    setFriendCodeInput("");
    return true;
  };

  const handleAcceptInvitation = (invite: FriendInvitation) => {
    const pubkey = asPeerPubkey(invite.syncId);
    if (!pubkey) return;
    acceptFriend(pubkey);
    showToast(t("friendsPage.acceptedInvitation", { name: invite.name }), "success");
  };

  const handleDenyInvitation = (syncId: string) => {
    const pubkey = asPeerPubkey(syncId) ?? syncId;
    const nextDenied = deniedIds.includes(pubkey) ? deniedIds : [...deniedIds, pubkey];
    setDeniedIds(nextDenied);
    localStorage.setItem("gamelib.friends.denied", JSON.stringify(nextDenied));
    removePeer(pubkey);
    showToast(t("friendsPage.invitationDenied"), "info");
  };

  const handleDeleteFriend = (friendId: string, friendName: string) => {
    removeFriendRecords([friendId]);
    showToast(t("friendsPage.removedFromFriends", { name: friendName }), "info");
  };

  const handleTogglePin = (friendId: string) => {
    const updated = friends.map((f) => (f.id === friendId ? { ...f, pinned: !f.pinned } : f));
    setFriends(updated);
    saveFriends(updated);
  };

  const handleSetNickname = (friendId: string, nickname: string) => {
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, nickname: nickname.trim() || undefined } : f
    );
    setFriends(updated);
    saveFriends(updated);
  };

  const handleToggleBlock = (friendId: string, friendName: string) => {
    const friend = friends.find((f) => f.id === friendId);
    if (!friend) return;

    if (friend.blocked) {
      // Blocking is engine-owned; unblocking is just clearing the flag.
      const updated = friends.map((f) => (f.id === friendId ? { ...f, blocked: false } : f));
      setFriends(updated);
      saveFriends(updated);
      showToast(t("friendsPage.unblockedFriend", { name: friendName }), "info");
      return;
    }

    const pubkey = asPeerPubkey(friend.syncId);
    if (pubkey) {
      blockPeer(pubkey);
    } else {
      const updated = friends.map((f) => (f.id === friendId ? { ...f, blocked: true } : f));
      setFriends(updated);
      saveFriends(updated);
    }
    showToast(t("friendsPage.blockedFriend", { name: friendName }), "info");
  };

  const handleBulkPin = (ids: string[]) => {
    const set = new Set(ids);
    const updated = friends.map((f) => (set.has(f.id) ? { ...f, pinned: true } : f));
    setFriends(updated);
    saveFriends(updated);
    showToast(t("friendsPage.pinnedFriends"), "info");
  };

  const handleBulkUnpin = (ids: string[]) => {
    const set = new Set(ids);
    const updated = friends.map((f) => (set.has(f.id) ? { ...f, pinned: false } : f));
    setFriends(updated);
    saveFriends(updated);
    showToast(t("friendsPage.unpinnedFriends"), "info");
  };

  const handleBulkBlock = (ids: string[]) => {
    const set = new Set(ids);
    const updated = friends.map((f) => (set.has(f.id) ? { ...f, blocked: true } : f));
    setFriends(updated);
    saveFriends(updated);
    showToast(t("friendsPage.blockedFriends"), "info");
  };

  const handleBulkRemove = (ids: string[]) => {
    removeFriendRecords(ids);
    showToast(t("friendsPage.removedFriends"), "info");
  };

  // ── Circles ─────────────────────────────────────────────────────────

  const handleCreateCircle = (name: string, color?: string) => {
    const circle: FriendCircle = {
      id: `circle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      color,
    };
    const updated = [...circles, circle];
    setCircles(updated);
    saveCircles(updated);
  };

  const handleRenameCircle = (circleId: string, name: string) => {
    const updated = circles.map((c) => (c.id === circleId ? { ...c, name } : c));
    setCircles(updated);
    saveCircles(updated);
  };

  const handleDeleteCircle = (circleId: string) => {
    const updatedCircles = circles.filter((c) => c.id !== circleId);
    setCircles(updatedCircles);
    saveCircles(updatedCircles);
    const updatedFriends = friends.map((f) => ({
      ...f,
      groups: (f.groups || []).filter((g) => g !== circleId),
    }));
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
  };

  const handleToggleFriendCircle = (friendId: string, circleId: string) => {
    const updated = friends.map((f) => {
      if (f.id !== friendId) return f;
      const groups = f.groups || [];
      const has = groups.includes(circleId);
      return { ...f, groups: has ? groups.filter((g) => g !== circleId) : [...groups, circleId] };
    });
    setFriends(updated);
    saveFriends(updated);
  };

  // ── Sessions ────────────────────────────────────────────────────────

  const handleRsvp = (sessionId: string, status: RsvpStatus) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const rsvps = { ...(s.rsvps || {}) };
      if (rsvps[profile.name] === status) delete rsvps[profile.name];
      else rsvps[profile.name] = status;
      const isGoing = rsvps[profile.name] === "going";
      const attendees = isGoing
        ? Array.from(new Set([...(s.attendees || []), profile.name]))
        : (s.attendees || []).filter((n) => n !== profile.name);

      const existingParticipant = (s.participants || []).find((p) => p.name === profile.name);
      const participants = (s.participants || []).filter((p) => p.name !== profile.name);
      if (isGoing) {
        participants.unshift({ ...(existingParticipant || {}), name: profile.name, role: existingParticipant?.role ?? "player" });
      }
      return { ...s, rsvps, attendees, participants, updatedAt: Date.now() };
    });

    setSessions(updated);
    saveSessions(updated);
  };

  const handleCreateSession = (sessionData: Omit<GameSession, "id" | "updatedAt">) => {
    const newSession: GameSession = {
      ...sessionData,
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      updatedAt: Date.now(),
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friends.sessionCreated"), "success");
  };

  const handleDeleteSession = (sessionId: string) => {
    const updated = sessions.map((s) => (s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s));
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.sessionDeleted"), "info");
  };

  const handleEditSession = (sessionId: string, sessionData: Omit<GameSession, "id" | "updatedAt">) => {
    const updated = sessions.map((s) => (s.id === sessionId ? { ...s, ...sessionData, updatedAt: Date.now() } : s));
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.sessionEdited"), "success");
  };

  const handleVotePoll = (sessionId: string, optionId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId || !s.poll) return s;
      const votes: Record<string, string[]> = {};
      s.poll.options.forEach((o) => {
        votes[o.id] = (s.poll!.votes?.[o.id] || []).filter((v) => v !== profile.name);
      });
      votes[optionId] = [...(votes[optionId] || []), profile.name];
      return { ...s, poll: { ...s.poll, votes }, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleFinalizePoll = (sessionId: string, optionId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId || !s.poll) return s;
      const option = s.poll.options.find((o) => o.id === optionId);
      if (!option) return s;
      return { ...s, scheduledAt: option.label, poll: undefined, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.pollFinalized"), "success");
  };

  const handleSetSessionRole = (sessionId: string, name: string, role: SessionRole) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).map((p) => (p.name === name ? { ...p, role } : p));
      if (!participants.some((p) => p.name === name)) participants.push({ name, role });
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleAddSessionGuest = (sessionId: string, guestName: string) => {
    const name = guestName.trim();
    if (!name) return;
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = [...(s.participants || [])];
      if (!participants.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        participants.push({ name, role: "player" as SessionRole, guest: true, timezone: detectTimezone() });
      }
      const rsvps = { ...(s.rsvps || {}) };
      if (rsvps[name] === undefined) rsvps[name] = "going";
      const attendees = Array.from(new Set([...(s.attendees || []), name]));
      return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleRemoveSessionGuest = (sessionId: string, guestName: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).filter((p) => !(p.name === guestName && p.guest));
      const rsvps = { ...(s.rsvps || {}) };
      delete rsvps[guestName];
      const attendees = (s.attendees || []).filter((n) => n !== guestName);
      return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleSetSessionRsvpNote = (sessionId: string, note: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = [...(s.participants || [])];
      const idx = participants.findIndex((p) => p.name === profile.name);
      if (idx >= 0) participants[idx] = { ...participants[idx], note: note || undefined };
      else participants.push({ name: profile.name, role: "player", note: note || undefined, timezone: detectTimezone() });
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleSendSessionMessage = (sessionId: string, text: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = [
        ...(s.messages || []),
        { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, author: profile.name, text, timestamp: Date.now() },
      ];
      return { ...s, messages, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  const handleTogglePinSessionMessage = (sessionId: string, messageId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = (s.messages || []).map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m));
      return { ...s, messages, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
  };

  // ── Recommendations ─────────────────────────────────────────────────

  const handleReactRec = (recId: string, kind: ReactionKind) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      const reactions = { ...(r.reactions || {}) };
      if (reactions[profile.name] === kind) delete reactions[profile.name];
      else reactions[profile.name] = kind;
      return { ...r, reactions, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
  };

  const handleToggleWantToPlay = (recId: string) => {
    const updated = recommendations.map((r) => (r.id === recId ? { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() } : r));
    setRecommendations(updated);
    saveRecommendations(updated);
  };

  const handleSetWantToPlayBulk = (recIds: string[], wantToPlay: boolean) => {
    if (recIds.length === 0) return;
    const ids = new Set(recIds);
    const now = Date.now();
    const updated = recommendations.map((r) =>
      ids.has(r.id) && !!r.wantToPlay !== wantToPlay ? { ...r, wantToPlay, updatedAt: now } : r
    );
    setRecommendations(updated);
    saveRecommendations(updated);
  };

  const handleAddRecComment = (recId: string, text: string) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      const comments = [
        ...(r.comments || []),
        { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, authorName: profile.name, text, timestamp: Date.now() },
      ];
      return { ...r, comments, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
  };

  const handleCreateRec = (recData: Omit<GameRecommendation, "id" | "comments" | "createdAt" | "updatedAt">) => {
    const newRec: GameRecommendation = {
      ...recData,
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [newRec, ...recommendations];
    setRecommendations(updated);
    saveRecommendations(updated);
    showToast(t("friendsPage.recPostedSuccess"), "success");
  };

  const handleDeleteRec = (recId: string) => {
    const updated = recommendations.map((r) => (r.id === recId ? { ...r, deleted: true, updatedAt: Date.now() } : r));
    setRecommendations(updated);
    saveRecommendations(updated);
    showToast(t("friendsPage.recDeleted"), "info");
  };

  const handleOpenRecGame = async (_gameId: string, gameName: string, slug?: string) => {
    if (slug && slug.trim()) return { slug: slug.trim() };
    try {
      const res = await invoke<StoreGameSummary[]>("search_store_games", { query: gameName, offset: 0, limit: 1 });
      const hit = res?.[0];
      if (hit?.slug) return { slug: hit.slug };
    } catch {
      /* fall back to slugified name */
    }
    return { slug: slugify(gameName) };
  };

  // ── Wishlist suggestions ────────────────────────────────────────────

  const handleReactSuggestion = (sugId: string, kind: SuggestionReactionKind) => {
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      const reactions = { ...(s.reactions || {}) };
      if (reactions[profile.name] === kind) delete reactions[profile.name];
      else reactions[profile.name] = kind;
      return { ...s, reactions, updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
  };

  const handleToggleWishlistSuggestion = (gameId: string, gameName: string) => {
    toggleWishlist({
      id: Number(gameId) || 0,
      name: gameName,
      slug: gameId,
      summary: null,
      rating: null,
      aggregatedRating: null,
      coverUrl: null,
      logoUrl: null,
      genres: [],
      platforms: [],
      firstReleaseDate: null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  const handleAddSuggestionComment = (sugId: string, text: string) => {
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      const comments = [
        ...(s.comments || []),
        { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, authorName: profile.name, text, timestamp: Date.now() },
      ];
      return { ...s, comments, updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
  };

  const handleCreateSuggestion = (
    sugData: Omit<GameSuggestion, "id" | "comments" | "createdAt" | "updatedAt">
  ) => {
    const newSug: GameSuggestion = {
      ...sugData,
      id: `sug_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [newSug, ...suggestions];
    setSuggestions(updated);
    saveSuggestions(updated);
    showToast(t("friendsPage.sugPostedSuccess"), "success");
  };

  const handleDeleteSuggestion = (sugId: string) => {
    const updated = suggestions.map((s) => (s.id === sugId ? { ...s, deleted: true, updatedAt: Date.now() } : s));
    setSuggestions(updated);
    saveSuggestions(updated);
    showToast(t("friendsPage.suggestionDeleted"), "info");
  };

  // ── Direct messages ─────────────────────────────────────────────────

  /** Peer a thread's chat envelopes belong to, or null when it is ambiguous. */
  const peerForThread = (thread: DmThread | undefined): string | null => {
    if (!thread) return null;
    return peerPubkeyForThread(thread, friends, {
      myPubkey: profile.syncId,
      myName: profile.name,
    });
  };

  const handleSendDmMessage = (
    threadId: string,
    text: string,
    otherName: string,
    attachments?: DmAttachment[]
  ) => {
    const now = Date.now();
    const newMsg: SessionMessage = {
      id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
      author: profile.name,
      text,
      timestamp: now,
      attachments,
    };

    let updated = dmsRef.current.map((th) =>
      th.id === threadId ? { ...th, messages: [...(th.messages || []), newMsg], updatedAt: now } : th
    );

    if (!updated.some((th) => th.id === threadId)) {
      const newThread: DmThread = {
        id: threadId,
        participants: [profile.name, otherName].sort(),
        messages: [newMsg],
        updatedAt: now,
      };
      updated = [newThread, ...updated];
    }

    dmsRef.current = updated;
    setDms(updated);
    saveDmsAndPersist(updated);

    const thread = updated.find((th) => th.id === threadId);
    const peer = peerForThread(thread);
    if (!peer) return;

    const attachment = attachments?.[0];
    sendChat(peer, {
      type: "message",
      id: newMsg.id,
      threadId: dmThreadIdForPeer(peer) ?? threadId,
      body: text,
      sentAt: now,
      ...(attachment
        ? {
            attachment: {
              name: attachment.name,
              mimeType: attachment.mimeType,
              dataUrl: attachment.dataUrl,
            },
          }
        : {}),
    });
  };

  const handleTogglePinDmMessage = (threadId: string, messageId: string) => {
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m));
      return { ...th, messages, updatedAt: Date.now() };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
  };

  const handleReactDmMessage = (threadId: string, messageId: string, emoji: string) => {
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).map((m) => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions || {}) };
        if (reactions[profile.name] === emoji) delete reactions[profile.name];
        else reactions[profile.name] = emoji;
        return { ...m, reactions };
      });
      return { ...th, messages, updatedAt: Date.now() };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
  };

  const markDmThreadRead = (threadId: string) => {
    const thread = dmsRef.current.find((t) => t.id === threadId);
    if (!thread || thread.deleted) return;

    const myReadKey = asPeerPubkey(profile.syncId) ?? profile.name;
    const lastRead = Math.max(
      thread.lastReadAt?.[profile.syncId] ?? 0,
      thread.lastReadAt?.[profile.name] ?? 0
    );
    const unread = (thread.messages || []).some((m) => m.author !== profile.name && m.timestamp > lastRead);
    if (!unread) return;

    const now = Date.now();
    const updated = dmsRef.current.map((t) =>
      t.id === threadId ? { ...t, lastReadAt: { ...(t.lastReadAt || {}), [myReadKey]: now } } : t
    );
    dmsRef.current = updated;
    setDms(updated);
    saveDmsAndPersist(updated);

    // The badge stays local; the receipt only leaves when the user allows it.
    if (!areDmReadReceiptsEnabled()) return;

    const peer = peerForThread(thread);
    if (!peer) return;
    sendChat(peer, {
      type: "read",
      threadId: dmThreadIdForPeer(peer) ?? thread.id,
      upTo: now,
      at: now,
    });
  };

  const handleDeleteDmMessage = (threadId: string, messageId: string) => {
    const now = Date.now();
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).map((m) => (m.id === messageId ? { ...m, deleted: true } : m));
      return { ...th, messages, updatedAt: now };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
  };

  const handleDeleteDmThread = (threadId: string) => {
    const now = Date.now();
    const updated = dms.map((th) => (th.id === threadId ? { ...th, deleted: true, updatedAt: now } : th));
    setDms(updated);
    saveDmsAndPersist(updated);
    showToast(t("friendsPage.threadDeleted"), "info");
  };

  // ── Profile ─────────────────────────────────────────────────────────

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    saveUserProfile(profile);
    showToast(t("friendsPage.profileUpdated"), "success");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast(t("friendsPage.fileTooLarge"), "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxDim = 96;
        canvas.width = maxDim;
        canvas.height = maxDim;

        if (ctx) {
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxDim, maxDim);

          try {
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.6);
            const updated = { ...profile, avatar: compressedBase64 };
            setProfile(updated);
            saveUserProfile(updated);
            showToast(t("friendsPage.avatarUploaded"), "success");
          } catch {
            showToast(t("friendsPage.imageProcessingFailed"), "error");
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Session start reminders.
  useEffect(() => {
    if (!friendsNotifications) return;
    const check = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      const windowMs = 15 * 60 * 1000;
      sessions.forEach((s) => {
        if (s.deleted) return;
        const involved =
          s.rsvps?.[profile.name] === "going" || s.invited?.includes(profile.name) || s.attendees?.includes(profile.name);
        if (!involved) return;
        const start = sessionStartMs(s);
        if (!start || start <= now || start - now > windowMs) return;
        const key = `${s.id}@${start}`;
        if (reminderNotifiedRef.current.has(key)) return;
        reminderNotifiedRef.current.set(key, now);
        fireNotification(
          t("friendsPage.notifSessionSoon", {
            game: s.gameName,
            time: new Date(start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
          }),
          s.gameName
        );
      });
      const cutoff = now - 24 * 60 * 60 * 1000;
      reminderNotifiedRef.current.forEach((ts, key) => {
        if (ts < cutoff) reminderNotifiedRef.current.delete(key);
      });
    };
    const iv = setInterval(check, 30_000);
    check();
    return () => clearInterval(iv);
  }, [sessions, friendsNotifications, profile.name, t]);

  return {
    // data
    profile,
    setProfile,
    friends,
    sessions,
    recommendations,
    suggestions,
    circles,
    dms,
    invitations,
    outgoingRequests,
    unseenCounts,
    // derived
    selfStats,
    selfSharedGames,
    myGameIds,
    generatedFriendCode,
    currentlyPlaying,
    // sync
    syncStatus: status,
    lastSyncedTime,
    lastSyncMessage,
    pendingPublish: status.pendingPublish,
    peerStatuses: status.peers,
    performSync,
    // friend code
    friendCodeInput,
    setFriendCodeInput,
    decodedFriend,
    // friend actions
    handleAddFriend,
    handleAcceptInvitation,
    handleDenyInvitation,
    handleDeleteFriend,
    handleTogglePin,
    handleSetNickname,
    handleToggleBlock,
    handleBulkPin,
    handleBulkUnpin,
    handleBulkBlock,
    handleBulkRemove,
    // circles
    handleCreateCircle,
    handleRenameCircle,
    handleDeleteCircle,
    handleToggleFriendCircle,
    // sessions
    handleRsvp,
    handleCreateSession,
    handleDeleteSession,
    handleEditSession,
    handleVotePoll,
    handleFinalizePoll,
    handleSetSessionRole,
    handleAddSessionGuest,
    handleRemoveSessionGuest,
    handleSetSessionRsvpNote,
    handleSendSessionMessage,
    handleTogglePinSessionMessage,
    // recs
    handleReactRec,
    handleToggleWantToPlay,
    handleSetWantToPlayBulk,
    handleAddRecComment,
    handleCreateRec,
    handleDeleteRec,
    handleOpenRecGame,
    // suggestions
    handleReactSuggestion,
    handleToggleWishlistSuggestion,
    handleAddSuggestionComment,
    handleCreateSuggestion,
    handleDeleteSuggestion,
    // dms
    handleSendDmMessage,
    handleTogglePinDmMessage,
    handleReactDmMessage,
    markDmThreadRead,
    handleDeleteDmMessage,
    handleDeleteDmThread,
    // profile
    handleSaveProfile,
    handleImageUpload,
    // unseen
    resetUnseen,
    // misc
    wishlist,
  };
}

export type FriendsPageController = ReturnType<typeof useFriendsPageController>;
