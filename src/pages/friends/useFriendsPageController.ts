import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { parsePlayTime, slugify, type StoreGameSummary } from "../../types/game";
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
  type SyncResult,
  type FriendsDatabase,
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
  mergeSessions,
  mergeRecommendations,
  mergeSuggestions,
  mergeDatabases,
  mergeDms,
  sanitizeDmsForPush,
  decodeFriendCode,
  encodeFriendCode,
  displayName,
  getNostrKeys,
  getSyncFolder,
  fetchFriendOutbox,
  pushMyOutbox as pushMyOutboxStorage,
  buildOutboxPayload,
  buildNostrOutboxPayload,
  publishNostrOutbox,
  stripDms,
  NOSTR_RELAYS,
  getNostrShareScope,
  isNostrIdentityReady,
  initNostrKeys,
  remoteFriendsInclude,
  loadFriendsDbToLocalStorage,
  setDeviceId,
  listPeerOutboxes,
  addUnseenCommunityItems,
  getUnseenTabItems,
  addUnseenTabItems,
  clearUnseenTabItems,
} from "../friendsStorage";
import { nextOccurrence, detectTimezone } from "./friendsUtils";
import type { FriendInvitation, SyncLogEntry, UnseenCounts } from "./friendsTypes";

/**
 * Everything the Friends page needs except purely presentational state.
 *
 * The sync engine is a straight move of the code that used to live in
 * FriendsPage: same storage helpers, same merge order, same notifications.
 * Keeping it here lets the page shrink to layout + navigation.
 */
export function useFriendsPageController() {
  const { t } = useLanguage();
  const { games, runningGameIds } = useGames();
  const { summaries } = useAchievements();
  const { showToast } = useToast();
  const { wishlist, toggle: toggleWishlist } = useWishlistContext();
  const { friendsNotifications, dmReadReceipts } = useSettings();

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

  const [invitations, setInvitations] = useState<FriendInvitation[]>([]);
  const [deniedIds, setDeniedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gamelib.friends.denied") || "[]");
    } catch {
      return [];
    }
  });

  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState("");
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);

  const nostrPool = useMemo(() => new SimplePool(), []);

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

  // Refs keep the background sync loop from publishing a stale closure.
  const profileRef = useRef(profile);
  const selfStatsRef = useRef(selfStats);
  const selfSharedGamesRef = useRef(selfSharedGames);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    selfStatsRef.current = selfStats;
  }, [selfStats]);
  useEffect(() => {
    selfSharedGamesRef.current = selfSharedGames;
  }, [selfSharedGames]);

  const lastPushedSignatureRef = useRef("");
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());
  const cancelledNotifiedRef = useRef<Set<string>>(new Set());
  const reminderNotifiedRef = useRef<Map<string, number>>(new Map());

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

  const detectCancelledSessions = (prev: GameSession[], next: GameSession[]): GameSession[] => {
    const prevById = new Map(prev.map((s) => [s.id, s]));
    return next.filter((s) => {
      const before = prevById.get(s.id);
      if (!before || before.deleted || !s.deleted) return false;
      return (
        s.creatorName !== profileRef.current.name &&
        (s.rsvps?.[profileRef.current.name] === "going" ||
          s.attendees?.includes(profileRef.current.name) ||
          s.invited?.includes(profileRef.current.name))
      );
    });
  };

  const notifyCancelledSessions = (cancelled: GameSession[]) => {
    cancelled.forEach((s) => {
      if (cancelledNotifiedRef.current.has(s.id)) return;
      cancelledNotifiedRef.current.add(s.id);
      showToast(t("friendsPage.sessionCancelledToast", { game: s.gameName }), "warning");
      fireNotification(t("friendsPage.notifSessionCancelled"), s.gameName);
    });
  };

  const notifyNewDmMessages = (
    remoteThreads: DmThread[],
    knownIdsByThread: Map<string, Set<string>>,
    myName: string,
    senderName: string
  ) => {
    remoteThreads.forEach((rt) => {
      if (rt.deleted) return;
      const known = knownIdsByThread.get(rt.id);
      const fresh = (rt.messages || []).filter(
        (m) => !m.deleted && m.author !== myName && !known?.has(m.id) && !notifiedMsgIdsRef.current.has(m.id)
      );
      if (fresh.length === 0) return;
      fresh.forEach((m) => notifiedMsgIdsRef.current.add(m.id));
      if (notifiedMsgIdsRef.current.size > 5000) notifiedMsgIdsRef.current.clear();
      const last = fresh[fresh.length - 1];
      fireNotification(t("friendsPage.notifNewMessage", { name: senderName }), last.text || "");
    });
  };

  // ── Initial load ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadFriendsDbToLocalStorage();
        if (!cancelled && loaded) {
          setProfile(loadUserProfile());
          setFriends(loadFriends());
          setSessions(loadSessions());
          setRecommendations(loadRecommendations());
          setSuggestions(loadSuggestions());
          setDms(loadDms());
          setCircles(loadCircles());
        }

        const id = await invoke<string>("get_friends_device_id");
        if (!cancelled && id) setDeviceId(id);
      } catch (err) {
        console.error("Failed to initialize database or resolve device ID:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!friendCodeInput.trim()) {
      setDecodedFriend(null);
      return;
    }
    setDecodedFriend(decodeFriendCode(friendCodeInput));
  }, [friendCodeInput]);

  useEffect(() => {
    if (!decodedFriend || !decodedFriend.syncId) return;
    let cancelled = false;
    (async () => {
      try {
        const remoteOutbox = await fetchFriendOutbox(decodedFriend.syncId);
        if (remoteOutbox && remoteOutbox.profile && !cancelled) {
          setDecodedFriend((prev) => {
            if (!prev || prev.syncId !== decodedFriend.syncId) return prev;
            return {
              ...prev,
              name: remoteOutbox.profile!.name,
              avatar: remoteOutbox.profile!.avatar,
              status: remoteOutbox.profile!.status,
              favoriteGame: remoteOutbox.profile!.favoriteGame || undefined,
              currentlyPlaying: remoteOutbox.profile!.currentlyPlaying || undefined,
              libStats: remoteOutbox.profile!.libStats,
              lastActive: remoteOutbox.profile!.lastActive,
            };
          });
        }
      } catch (err) {
        console.error("Failed to fetch friend preview outbox:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decodedFriend?.syncId]);

  // ── Sync engine ─────────────────────────────────────────────────────

  const publishToNostr = async (
    db: FriendsDatabase,
    sharedGames?: SharedGameStat[],
    stats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number } = selfStats
  ) => {
    const payload = buildNostrOutboxPayload(
      db.profile || profile,
      stats,
      db.sessions,
      db.recommendations,
      sharedGames,
      db.suggestions
    );
    await publishNostrOutbox(payload);
  };

  const pushMyOutbox = async (
    currProfile: UserProfile,
    currStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
    currSessions: GameSession[],
    currRecs: GameRecommendation[],
    currSharedGames?: SharedGameStat[],
    currSuggestions?: GameSuggestion[],
    currDms?: DmThread[],
    force = true
  ): Promise<SyncResult> => {
    if (!isNostrIdentityReady()) return { ok: true };
    const outDms = sanitizeDmsForPush(currDms || [], profile.name, dmReadReceipts);
    const signature =
      JSON.stringify(
        buildOutboxPayload(currProfile, currStats, currSessions, currRecs, currSharedGames, currSuggestions, outDms)
      ) +
      "|scope:" +
      getNostrShareScope();

    if (!force && signature === lastPushedSignatureRef.current) return { ok: true };

    const res = await pushMyOutboxStorage(
      currProfile,
      currStats,
      currSessions,
      currRecs,
      currSharedGames,
      currSuggestions,
      outDms
    );

    const db: FriendsDatabase = {
      profile: currProfile,
      friends,
      sessions: currSessions,
      recommendations: currRecs,
      suggestions: currSuggestions || [],
      dms: outDms,
    };
    await publishToNostr(db, currSharedGames, currStats);
    lastPushedSignatureRef.current = signature;
    return res;
  };

  const refreshUnseen = () => {
    setUnseenCounts({
      sessions: getUnseenTabItems("sessions"),
      recs: getUnseenTabItems("recs"),
      suggestions: getUnseenTabItems("suggestions"),
      activity: getUnseenTabItems("activity"),
      dms: getUnseenTabItems("dms"),
    });
  };

  const handleReceiveRemoteData = (remoteDb: FriendsDatabase) => {
    try {
      const localProfile = loadUserProfile();
      const localFriends = loadFriends();

      const remoteProfile = remoteDb.profile;
      if (remoteProfile && remoteProfile.syncId) {
        const isFriend = localFriends.some((f) => f.syncId === remoteProfile.syncId);
        const isSelf = remoteProfile.syncId === localProfile.syncId;
        const isDenied = deniedIds.includes(remoteProfile.syncId);

        if (!isFriend && !isSelf && !isDenied) {
          const theyAddedUs = remoteFriendsInclude(remoteDb.friends, localProfile.syncId);
          if (theyAddedUs) {
            const newInvite: FriendInvitation = {
              syncId: remoteProfile.syncId,
              name: remoteProfile.name,
              avatar: remoteProfile.avatar,
              status: remoteProfile.status,
              favoriteGame: ((remoteProfile as any).favoriteGameName || (remoteProfile as any).favoriteGame) || undefined,
              libStats: remoteProfile.libStats
                ? {
                    gamesCount: remoteProfile.libStats.gamesCount || 0,
                    playtimeMinutes: remoteProfile.libStats.playtimeMinutes || 0,
                    achievementsCount: remoteProfile.libStats.achievementsCount || 0,
                  }
                : undefined,
            };

            setInvitations((prev) => {
              if (prev.some((i) => i.syncId === newInvite.syncId)) return prev;
              return [...prev, newInvite];
            });
            showToast(t("friendsPage.newInvitation", { name: remoteProfile.name }), "info");
            fireNotification(t("friendsPage.notifNewInvitation", { name: remoteProfile.name }), "");
            return;
          }
        }

        if (!isFriend) return;
      }

      const localSessions = loadSessions();
      const localRecs = loadRecommendations();
      const localSuggestions = loadSuggestions();
      const localDms = loadDms();

      const merged = mergeDatabases(
        {
          profile: localProfile,
          friends: localFriends,
          sessions: localSessions,
          recommendations: localRecs,
          suggestions: localSuggestions,
          dms: localDms,
        },
        remoteDb
      );

      const localSessionIds = new Set(localSessions.map((s) => s.id));
      const localRecIds = new Set(localRecs.map((r) => r.id));
      const localSuggestionIds = new Set(localSuggestions.map((s) => s.id));

      const addedSessions = merged.sessions.filter(
        (s) => !localSessionIds.has(s.id) && !s.deleted && s.creatorName !== localProfile.name
      ).length;
      if (addedSessions > 0) {
        const firstNew = merged.sessions.find(
          (s) => !localSessionIds.has(s.id) && !s.deleted && s.creatorName !== localProfile.name
        );
        if (firstNew) fireNotification(t("friendsPage.notifNewSession", { name: firstNew.creatorName }), firstNew.gameName);
      }
      notifyCancelledSessions(detectCancelledSessions(localSessions, merged.sessions));
      const addedRecs = merged.recommendations.filter(
        (r) => !localRecIds.has(r.id) && !r.deleted && r.recommendedBy !== localProfile.name
      ).length;
      const addedSuggestions = merged.suggestions.filter(
        (s) => !localSuggestionIds.has(s.id) && !s.deleted && s.suggestedBy !== localProfile.name
      ).length;

      let newDmMessages = 0;
      const knownIdsByThread = new Map<string, Set<string>>();
      localDms.forEach((thread) => knownIdsByThread.set(thread.id, new Set((thread.messages || []).map((m) => m.id))));
      (remoteDb.dms || []).forEach((remoteThread) => {
        if (remoteThread.deleted) return;
        const known = knownIdsByThread.get(remoteThread.id);
        newDmMessages += (remoteThread.messages || []).filter(
          (m) => !m.deleted && m.author !== localProfile.name && !known?.has(m.id)
        ).length;
      });
      if (remoteProfile) notifyNewDmMessages(remoteDb.dms || [], knownIdsByThread, localProfile.name, remoteProfile.name);

      setFriends(merged.friends);
      setSessions(merged.sessions);
      setRecommendations(merged.recommendations);
      setSuggestions(merged.suggestions);
      setDms(merged.dms);

      saveFriends(merged.friends);
      saveSessions(merged.sessions);
      saveRecommendations(merged.recommendations);
      saveSuggestions(merged.suggestions);
      saveDmsAndPersist(merged.dms);

      if (addedSessions > 0) addUnseenTabItems("sessions", addedSessions);
      if (addedRecs > 0) addUnseenTabItems("recs", addedRecs);
      if (addedSuggestions > 0) addUnseenTabItems("suggestions", addedSuggestions);
      if (newDmMessages > 0) addUnseenTabItems("dms", newDmMessages);

      if (addedSessions > 0 || addedRecs > 0 || addedSuggestions > 0 || newDmMessages > 0) refreshUnseen();
    } catch (err) {
      console.error("Failed to parse/merge remote sync data:", err);
    }
  };

  const pendingManualSync = useRef(false);
  const isSyncingRef = useRef(false);

  const performSync = async (manual = false) => {
    if (isSyncingRef.current) {
      if (manual) pendingManualSync.current = true;
      return;
    }
    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      let currProfile = profileRef.current;
      if (!isNostrIdentityReady()) await initNostrKeys();
      const identityReady = isNostrIdentityReady();
      if (identityReady) {
        const keys = getNostrKeys();
        if (currProfile.syncId !== keys.publicKey) {
          const updated = { ...currProfile, syncId: keys.publicKey };
          saveUserProfile(updated);
          setProfile(updated);
          profileRef.current = updated;
          currProfile = updated;
        }
      }

      const folder = await getSyncFolder();
      if (!folder) {
        if (manual) showToast(t("friendsPage.syncFolderMissing"), "error");
        return;
      }

      const localSessions = loadSessions();
      const localRecs = loadRecommendations();
      const localSuggestions = loadSuggestions();
      const localFriends = loadFriends();
      const localDms = loadDms();

      const heartbeatSecs = Math.floor(Date.now() / 1000);
      if (identityReady && (!currProfile.lastActive || heartbeatSecs - currProfile.lastActive > 120)) {
        const heartbeated = { ...currProfile, lastActive: heartbeatSecs };
        saveUserProfile(heartbeated);
        setProfile(heartbeated);
        profileRef.current = heartbeated;
        currProfile = heartbeated;
      }

      let changesMade = false;
      let friendsUpdated = false;
      let pulledSessions = 0;
      let pulledRecs = 0;
      let newCommunityItems = 0;
      const pullErrors: string[] = [];
      const friendLogs: string[] = [];

      let mergedSessions = [...localSessions];
      let mergedRecs = [...localRecs];
      let mergedSuggestions = [...localSuggestions];
      let mergedDms = [...localDms];

      const updatedFriends: Friend[] = [];
      const nowSecs = Math.floor(Date.now() / 1000);

      const outboxBySyncId = new Map<
        string,
        { remoteOutbox: Awaited<ReturnType<typeof fetchFriendOutbox>>; error: string | null }
      >();
      await Promise.all(
        localFriends
          .filter((f) => !f.blocked)
          .map(async (friend) => {
            try {
              const remoteOutbox = await fetchFriendOutbox(friend.syncId);
              outboxBySyncId.set(friend.syncId, { remoteOutbox, error: null });
            } catch (err) {
              outboxBySyncId.set(friend.syncId, {
                remoteOutbox: null,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
      );

      for (const friend of localFriends) {
        const friendName = displayName(friend);
        if (friend.blocked) {
          friendLogs.push(`⛔ ${friendName}: blocked — skipped`);
          updatedFriends.push(friend);
          continue;
        }

        try {
          const result = outboxBySyncId.get(friend.syncId);
          if (result?.error) throw result.error;
          const remoteOutbox = result?.remoteOutbox;
          if (remoteOutbox) {
            let friendSessions = 0;
            let friendRecs = 0;
            let profileChanged = false;

            if (remoteOutbox.sessions && remoteOutbox.sessions.length > 0) {
              const prevIds = new Set(mergedSessions.map((s) => s.id));
              const beforeJson = JSON.stringify(mergedSessions);
              mergedSessions = mergeSessions(mergedSessions, remoteOutbox.sessions);
              const afterJson = JSON.stringify(mergedSessions);
              const sessionChanged = beforeJson !== afterJson;
              const addedSessions = remoteOutbox.sessions.filter((s) => !prevIds.has(s.id)).length;
              newCommunityItems += addedSessions;
              if (addedSessions > 0) {
                addUnseenTabItems("sessions", addedSessions);
                const firstNew = remoteOutbox.sessions.find((s) => !prevIds.has(s.id));
                if (firstNew) fireNotification(t("friendsPage.notifNewSession", { name: friendName }), firstNew.gameName);
              }
              if (sessionChanged) {
                changesMade = true;
                friendSessions = remoteOutbox.sessions.length;
                pulledSessions += friendSessions;
              }
            }

            if (remoteOutbox.recommendations && remoteOutbox.recommendations.length > 0) {
              const prevIds = new Set(mergedRecs.map((r) => r.id));
              const beforeJson = JSON.stringify(mergedRecs);
              mergedRecs = mergeRecommendations(mergedRecs, remoteOutbox.recommendations);
              const afterJson = JSON.stringify(mergedRecs);
              const recChanged = beforeJson !== afterJson;
              const addedRecs = remoteOutbox.recommendations.filter((r) => !prevIds.has(r.id)).length;
              newCommunityItems += addedRecs;
              if (addedRecs > 0) addUnseenTabItems("recs", addedRecs);
              if (recChanged) {
                changesMade = true;
                friendRecs = remoteOutbox.recommendations.length;
                pulledRecs += friendRecs;
              }
            }

            if (remoteOutbox.suggestions && remoteOutbox.suggestions.length > 0) {
              const prevIds = new Set(mergedSuggestions.map((s) => s.id));
              const beforeJson = JSON.stringify(mergedSuggestions);
              mergedSuggestions = mergeSuggestions(mergedSuggestions, remoteOutbox.suggestions);
              const afterJson = JSON.stringify(mergedSuggestions);
              const suggestionChanged = beforeJson !== afterJson;
              const addedSuggestions = remoteOutbox.suggestions.filter((s) => !prevIds.has(s.id)).length;
              newCommunityItems += addedSuggestions;
              if (addedSuggestions > 0) addUnseenTabItems("suggestions", addedSuggestions);
              if (suggestionChanged) changesMade = true;
            }

            if (remoteOutbox.dms && remoteOutbox.dms.length > 0) {
              const knownMessages = new Map<string, Set<string>>();
              mergedDms.forEach((thread) =>
                knownMessages.set(thread.id, new Set((thread.messages || []).map((m) => m.id)))
              );
              const beforeJson = JSON.stringify(mergedDms);
              mergedDms = mergeDms(mergedDms, remoteOutbox.dms, currProfile.name);
              const afterJson = JSON.stringify(mergedDms);
              const dmChanged = beforeJson !== afterJson;
              let newIncoming = 0;
              remoteOutbox.dms.forEach((remoteThread) => {
                if (remoteThread.deleted) return;
                const known = knownMessages.get(remoteThread.id);
                if (!known) {
                  newIncoming += (remoteThread.messages || []).filter(
                    (m) => !m.deleted && m.author !== currProfile.name
                  ).length;
                } else {
                  newIncoming += (remoteThread.messages || []).filter(
                    (m) => !m.deleted && !known.has(m.id) && m.author !== currProfile.name
                  ).length;
                }
              });
              notifyNewDmMessages(remoteOutbox.dms, knownMessages, currProfile.name, friendName);
              if (newIncoming > 0) addUnseenTabItems("dms", newIncoming);
              if (dmChanged || newIncoming > 0) changesMade = true;
            }

            if (remoteOutbox.profile) {
              const remoteProfile = remoteOutbox.profile;
              const remoteIsCore = remoteOutbox.scope === "core" || (remoteOutbox.scope == null && remoteOutbox.v === 2);
              const remoteName = remoteProfile.name || friend.name;
              const remoteAvatar = remoteProfile.avatar || friend.avatar;
              const remoteStatus = remoteProfile.status || friend.status;
              const remoteCurrentlyPlaying =
                remoteProfile.currentlyPlaying === undefined
                  ? friend.currentlyPlaying
                  : remoteProfile.currentlyPlaying || undefined;
              const remoteFavoriteGameRaw = (remoteProfile as any).favoriteGameName ?? remoteProfile.favoriteGame;
              const remoteFavoriteGame = remoteFavoriteGameRaw ?? (remoteIsCore ? friend.favoriteGame : undefined);
              const remoteBio = remoteProfile.bio ?? (remoteIsCore ? friend.bio : undefined);
              const remoteRegion = remoteProfile.region ?? (remoteIsCore ? friend.region : undefined);
              const remoteLibStats = remoteProfile.libStats ?? (remoteIsCore ? friend.libStats : undefined);
              const remoteGames = remoteOutbox.games ?? (remoteIsCore ? friend.games : undefined);
              const remoteLastActive = remoteProfile.lastActive || friend.lastActive;

              const hasDiff =
                friend.name !== remoteName ||
                friend.avatar !== remoteAvatar ||
                friend.status !== remoteStatus ||
                friend.favoriteGame !== (remoteFavoriteGame || undefined) ||
                friend.currentlyPlaying !== remoteCurrentlyPlaying ||
                (friend.bio || "") !== (remoteBio || "") ||
                (friend.region || "") !== (remoteRegion || "") ||
                friend.lastActive !== remoteLastActive ||
                JSON.stringify(friend.libStats) !== JSON.stringify(remoteLibStats) ||
                JSON.stringify(friend.games) !== JSON.stringify(remoteGames);

              if (hasDiff) profileChanged = true;

              if (hasDiff) {
                friendsUpdated = true;
                updatedFriends.push({
                  ...friend,
                  name: remoteName,
                  avatar: remoteAvatar,
                  status: remoteStatus,
                  favoriteGame: remoteFavoriteGame || undefined,
                  currentlyPlaying: remoteCurrentlyPlaying || undefined,
                  bio: remoteBio || undefined,
                  region: remoteRegion || undefined,
                  libStats: remoteLibStats,
                  games: remoteGames,
                  lastActive: remoteLastActive,
                  lastSeen: nowSecs,
                });
                friendLogs.push(
                  `🔄 ${friendName}: profile updated` +
                    (friendSessions ? `, +${friendSessions} session(s)` : "") +
                    (friendRecs ? `, +${friendRecs} rec(s)` : "")
                );
                continue;
              }
            }

            const lastSeenStale = !friend.lastSeen || nowSecs - friend.lastSeen > 300;
            if (lastSeenStale) {
              friendsUpdated = true;
              updatedFriends.push({ ...friend, lastSeen: nowSecs });
              friendLogs.push(
                `✓ ${friendName}: synced` +
                  (friendSessions ? `, +${friendSessions} session(s)` : "") +
                  (friendRecs ? `, +${friendRecs} rec(s)` : "") +
                  (profileChanged ? ", profile updated" : "")
              );
              continue;
            }

            friendLogs.push(`• ${friendName}: up to date`);
          } else {
            friendLogs.push(`⚠ ${friendName}: no outbox found`);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          pullErrors.push(`${friendName}: ${reason}`);
          friendLogs.push(`✕ ${friendName}: error — ${reason}`);
        }
        updatedFriends.push(friend);
      }

      notifyCancelledSessions(detectCancelledSessions(localSessions, mergedSessions));

      let finalSessions = mergedSessions;
      let finalRecs = mergedRecs;
      let finalSuggestions = mergedSuggestions;
      let finalDms = mergedDms;

      if (changesMade) {
        finalSessions = mergeSessions(loadSessions(), mergedSessions);
        finalRecs = mergeRecommendations(loadRecommendations(), mergedRecs);
        finalSuggestions = mergeSuggestions(loadSuggestions(), mergedSuggestions);
        finalDms = mergeDms(loadDms(), mergedDms, currProfile.name);
        saveSessions(finalSessions);
        saveRecommendations(finalRecs);
        saveSuggestions(finalSuggestions);
        saveDmsAndPersist(finalDms);
        setSessions(finalSessions);
        setRecommendations(finalRecs);
        setSuggestions(finalSuggestions);
        setDms(finalDms);
        refreshUnseen();
      }

      if (friendsUpdated) {
        const freshFriends = loadFriends();
        const engineById = new Map(updatedFriends.map((f) => [f.syncId, f]));
        const finalFriends = freshFriends.map((f) => {
          const engineF = engineById.get(f.syncId);
          if (!engineF) return f;
          return { ...f, ...engineF, pinned: f.pinned, blocked: f.blocked, nickname: f.nickname, groups: f.groups };
        });
        saveFriends(finalFriends);
        setFriends(finalFriends);
      }

      let pushed: SyncResult = { ok: true };
      if (identityReady) {
        pushed = await pushMyOutbox(
          currProfile,
          selfStatsRef.current,
          finalSessions,
          finalRecs,
          selfSharedGamesRef.current,
          finalSuggestions,
          finalDms,
          manual
        );
      }

      const syncedAt = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      setLastSyncedTime(syncedAt);

      const changes: string[] = [];
      if (pulledSessions > 0) changes.push(t("friendsPage.sessionsCount", { count: pulledSessions }));
      if (pulledRecs > 0) changes.push(t("friendsPage.recommendationsCount", { count: pulledRecs }));
      if (friendsUpdated) changes.push(t("friendsPage.profileUpdates"));
      if (pullErrors.length > 0) changes.push(t("friendsPage.syncErrors", { count: pullErrors.length }));

      const logMsg = pushed.ok
        ? changes.length > 0
          ? t("friendsPage.syncPulled", { items: changes.join(", ") })
          : t("friendsPage.upToDatePublished")
        : t("friendsPage.syncPublishFailed", { reason: pushed.reason || t("friendsPage.unknownReason") });

      setSyncLog((prev) => [{ time: syncedAt, message: logMsg, details: friendLogs }, ...prev].slice(0, 12));

      if (manual) {
        if (!pushed.ok) {
          showToast(t("friendsPage.syncFailed", { reason: pushed.reason || t("friendsPage.couldNotWriteOutbox") }), "error");
        } else if (pullErrors.length > 0) {
          showToast(t("friendsPage.syncedWithErrors", { count: pullErrors.length, errors: pullErrors.join("; ") }), "warning");
        } else if (pulledSessions > 0 || pulledRecs > 0 || friendsUpdated || changesMade) {
          const bits: string[] = [];
          if (pulledSessions > 0) bits.push(t("friendsPage.sessionsCount", { count: pulledSessions }));
          if (pulledRecs > 0) bits.push(t("friendsPage.recommendationsCount", { count: pulledRecs }));
          if (friendsUpdated) bits.push(t("friendsPage.profileUpdates"));
          showToast(t("friendsPage.syncSuccessDetails", { details: bits.join(", ") }), "success");
        } else {
          showToast(t("friendsPage.syncUpToDate"), "success");
        }
      }

      if (identityReady) await checkFolderInvitations(currProfile.syncId, localFriends);
      addUnseenCommunityItems(newCommunityItems);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }

    if (pendingManualSync.current) {
      pendingManualSync.current = false;
      void performSync(true);
    }
  };

  const performSyncRef = useRef(performSync);
  useEffect(() => {
    performSyncRef.current = performSync;
  }, [performSync]);

  useEffect(() => {
    const onScopeChange = () => {
      void performSyncRef.current(true);
    };
    window.addEventListener("gamelib:nostr-share-scope-changed", onScopeChange);
    return () => window.removeEventListener("gamelib:nostr-share-scope-changed", onScopeChange);
  }, []);

  const checkFolderInvitations = async (mySyncId: string, currentFriends: Friend[]) => {
    if (!mySyncId) return;
    try {
      const peers = await listPeerOutboxes();
      const newInvites: FriendInvitation[] = [];

      for (const peerId of peers) {
        if (peerId === mySyncId) continue;
        if (deniedIds.includes(peerId)) continue;

        const remoteOutbox = await fetchFriendOutbox(peerId);
        if (!remoteOutbox || !remoteOutbox.profile) continue;
        const friendSyncId = remoteOutbox.syncId || peerId;
        if (friendSyncId === mySyncId) continue;
        if (deniedIds.includes(friendSyncId)) continue;
        if (currentFriends.some((f) => f.syncId === friendSyncId || f.syncId === peerId)) continue;

        if (remoteFriendsInclude(remoteOutbox.friends, mySyncId)) {
          newInvites.push({
            syncId: friendSyncId,
            name: remoteOutbox.profile.name,
            avatar: remoteOutbox.profile.avatar,
            status: remoteOutbox.profile.status,
            favoriteGame: remoteOutbox.profile.favoriteGame || undefined,
            libStats: remoteOutbox.profile.libStats,
          });
        }
      }

      setInvitations((prev) => {
        const merged = [...prev];
        newInvites.forEach((invite) => {
          if (!merged.some((i) => i.syncId === invite.syncId)) merged.push(invite);
        });
        return merged;
      });
    } catch (e) {
      console.error("Failed to check folder invitations:", e);
    }
  };

  // Initial sync + 15 s background polling.
  useEffect(() => {
    void performSync(false);
  }, [profile.syncId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void performSync(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [friends, profile.syncId]);

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

  // Incoming P2P sync listener.
  const receiveRemoteDataRef = useRef(handleReceiveRemoteData);
  receiveRemoteDataRef.current = handleReceiveRemoteData;
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<string>("internet-sync-received", (event) => {
      if (disposed) return;
      try {
        receiveRemoteDataRef.current(JSON.parse(event.payload) as FriendsDatabase);
      } catch (err) {
        console.error("Failed to parse/merge remote sync data:", err);
      }
    });
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, [deniedIds]);

  const nostrFriendKeys = useMemo(
    () =>
      friends
        .map((f) => f.syncId)
        .filter((id) => /^[0-9a-fA-F]{64}$/.test(id))
        .sort()
        .join(","),
    [friends]
  );

  useEffect(() => {
    const pubkeys = nostrFriendKeys ? nostrFriendKeys.split(",") : [];
    if (pubkeys.length === 0) return;

    const sub = nostrPool.subscribeMany(
      [...NOSTR_RELAYS],
      { authors: pubkeys, kinds: [30078], "#d": ["gamelib-friends-outbox"] },
      {
        onevent(event) {
          if (!verifyEvent(event)) return;
          try {
            const remoteDb = stripDms(JSON.parse(event.content) as FriendsDatabase);
            handleReceiveRemoteData(remoteDb);
          } catch (err) {
            console.error("Nostr: failed to parse remote data:", err);
          }
        },
      }
    );

    return () => {
      sub.close();
    };
  }, [nostrFriendKeys, nostrPool]);

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

  const handleAddFriend = (): boolean => {
    if (!decodedFriend) return false;
    if (decodedFriend.syncId === profile.syncId) {
      showToast(t("friendsPage.cannotAddYourself"), "error");
      return false;
    }
    if (friends.some((f) => f.syncId === decodedFriend.syncId)) {
      showToast(t("friendsPage.alreadyInFriends", { name: decodedFriend.name }), "error");
      return false;
    }

    const updatedFriends = [...friends, decodedFriend];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    showToast(t("friendsPage.friendAdded", { name: decodedFriend.name }), "success");
    setFriendCodeInput("");
    setTimeout(() => void performSync(false), 100);
    return true;
  };

  const handleAcceptInvitation = (invite: FriendInvitation) => {
    if (friends.some((f) => f.syncId === invite.syncId)) {
      setInvitations((prev) => prev.filter((i) => i.syncId !== invite.syncId));
      return;
    }

    const newFriend: Friend = {
      id: `friend_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      name: invite.name,
      avatar: invite.avatar,
      status: invite.status,
      favoriteGame: invite.favoriteGame,
      libStats: invite.libStats,
      addedAt: Date.now(),
      syncId: invite.syncId,
    };

    const updatedFriends = [...friends, newFriend];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    setInvitations((prev) => prev.filter((i) => i.syncId !== invite.syncId));
    showToast(t("friendsPage.acceptedInvitation", { name: invite.name }), "success");
    setTimeout(() => void performSync(true), 100);
  };

  const handleDenyInvitation = (syncId: string) => {
    const nextDenied = [...deniedIds, syncId];
    setDeniedIds(nextDenied);
    localStorage.setItem("gamelib.friends.denied", JSON.stringify(nextDenied));
    setInvitations((prev) => prev.filter((i) => i.syncId !== syncId));
    showToast(t("friendsPage.invitationDenied"), "info");
  };

  const handleDeleteFriend = (friendId: string, friendName: string) => {
    const updated = friends.filter((f) => f.id !== friendId);
    setFriends(updated);
    saveFriends(updated);
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
    const updated = friends.map((f) => (f.id === friendId ? { ...f, blocked: !f.blocked } : f));
    setFriends(updated);
    saveFriends(updated);
    showToast(
      friend.blocked
        ? t("friendsPage.unblockedFriend", { name: friendName })
        : t("friendsPage.blockedFriend", { name: friendName }),
      "info"
    );
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
    const set = new Set(ids);
    const updated = friends.filter((f) => !set.has(f.id));
    setFriends(updated);
    saveFriends(updated);
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

  const handleRsvp = async (sessionId: string, status: RsvpStatus) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleCreateSession = async (sessionData: Omit<GameSession, "id" | "updatedAt">) => {
    const newSession: GameSession = {
      ...sessionData,
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      updatedAt: Date.now(),
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friends.sessionCreated"), "success");
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.map((s) => (s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s));
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.sessionDeleted"), "info");
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleEditSession = async (sessionId: string, sessionData: Omit<GameSession, "id" | "updatedAt">) => {
    const updated = sessions.map((s) => (s.id === sessionId ? { ...s, ...sessionData, updatedAt: Date.now() } : s));
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.sessionEdited"), "success");
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleVotePoll = async (sessionId: string, optionId: string) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleFinalizePoll = async (sessionId: string, optionId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId || !s.poll) return s;
      const option = s.poll.options.find((o) => o.id === optionId);
      if (!option) return s;
      return { ...s, scheduledAt: option.label, poll: undefined, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    showToast(t("friendsPage.pollFinalized"), "success");
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleSetSessionRole = async (sessionId: string, name: string, role: SessionRole) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).map((p) => (p.name === name ? { ...p, role } : p));
      if (!participants.some((p) => p.name === name)) participants.push({ name, role });
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleAddSessionGuest = async (sessionId: string, guestName: string) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleRemoveSessionGuest = async (sessionId: string, guestName: string) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleSetSessionRsvpNote = async (sessionId: string, note: string) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleSendSessionMessage = async (sessionId: string, text: string) => {
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
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleTogglePinSessionMessage = async (sessionId: string, messageId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = (s.messages || []).map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m));
      return { ...s, messages, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  // ── Recommendations ─────────────────────────────────────────────────

  const handleReactRec = async (recId: string, kind: ReactionKind) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      const reactions = { ...(r.reactions || {}) };
      if (reactions[profile.name] === kind) delete reactions[profile.name];
      else reactions[profile.name] = kind;
      return { ...r, reactions, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleToggleWantToPlay = async (recId: string) => {
    const updated = recommendations.map((r) => (r.id === recId ? { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() } : r));
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleSetWantToPlayBulk = async (recIds: string[], wantToPlay: boolean) => {
    if (recIds.length === 0) return;
    const ids = new Set(recIds);
    const now = Date.now();
    const updated = recommendations.map((r) =>
      ids.has(r.id) && !!r.wantToPlay !== wantToPlay ? { ...r, wantToPlay, updatedAt: now } : r
    );
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleAddRecComment = async (recId: string, text: string) => {
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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleCreateRec = async (recData: Omit<GameRecommendation, "id" | "comments" | "createdAt" | "updatedAt">) => {
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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleDeleteRec = async (recId: string) => {
    const updated = recommendations.map((r) => (r.id === recId ? { ...r, deleted: true, updatedAt: Date.now() } : r));
    setRecommendations(updated);
    saveRecommendations(updated);
    showToast(t("friendsPage.recDeleted"), "info");
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
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

  const handleReactSuggestion = async (sugId: string, kind: SuggestionReactionKind) => {
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      const reactions = { ...(s.reactions || {}) };
      if (reactions[profile.name] === kind) delete reactions[profile.name];
      else reactions[profile.name] = kind;
      return { ...s, reactions, updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated, dms);
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

  const handleAddSuggestionComment = async (sugId: string, text: string) => {
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
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated, dms);
  };

  const handleCreateSuggestion = async (
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
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated, dms);
  };

  const handleDeleteSuggestion = async (sugId: string) => {
    const updated = suggestions.map((s) => (s.id === sugId ? { ...s, deleted: true, updatedAt: Date.now() } : s));
    setSuggestions(updated);
    saveSuggestions(updated);
    showToast(t("friendsPage.suggestionDeleted"), "info");
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated, dms);
  };

  // ── Direct messages ─────────────────────────────────────────────────

  const handleSendDmMessage = async (threadId: string, text: string, otherName: string, attachments?: DmAttachment[]) => {
    const now = Date.now();
    const newMsg: SessionMessage = {
      id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
      author: profile.name,
      text,
      timestamp: now,
      attachments,
    };

    let updated = dms.map((th) =>
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

    setDms(updated);
    saveDmsAndPersist(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const handleTogglePinDmMessage = async (threadId: string, messageId: string) => {
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m));
      return { ...th, messages, updatedAt: Date.now() };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const handleReactDmMessage = async (threadId: string, messageId: string, emoji: string) => {
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
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const markDmThreadRead = (threadId: string) => {
    const thread = dmsRef.current.find((t) => t.id === threadId);
    if (!thread || thread.deleted) return;
    const lastRead = thread.lastReadAt?.[profile.name] || 0;
    const unread = (thread.messages || []).some((m) => m.author !== profile.name && m.timestamp > lastRead);
    if (!unread) return;
    const updated = dmsRef.current.map((t) =>
      t.id === threadId ? { ...t, lastReadAt: { ...(t.lastReadAt || {}), [profile.name]: Date.now() } } : t
    );
    dmsRef.current = updated;
    setDms(updated);
    saveDmsAndPersist(updated);
    void pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const handleDeleteDmMessage = async (threadId: string, messageId: string) => {
    const now = Date.now();
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).map((m) => (m.id === messageId ? { ...m, deleted: true } : m));
      return { ...th, messages, updatedAt: now };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const handleDeleteDmThread = async (threadId: string) => {
    const now = Date.now();
    const updated = dms.map((th) => (th.id === threadId ? { ...th, deleted: true, updatedAt: now } : th));
    setDms(updated);
    saveDmsAndPersist(updated);
    showToast(t("friendsPage.threadDeleted"), "info");
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  // ── Profile ─────────────────────────────────────────────────────────

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    saveUserProfile(profile);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, dms);
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
            void pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions, dms);
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
    unseenCounts,
    // derived
    selfStats,
    selfSharedGames,
    myGameIds,
    generatedFriendCode,
    currentlyPlaying,
    // sync
    isSyncing,
    lastSyncedTime,
    syncLog,
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
