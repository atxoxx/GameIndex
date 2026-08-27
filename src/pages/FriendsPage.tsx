import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../context/SettingsContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useLanguage } from "../context/LanguageContext";
import { consumePendingSuggestion } from "./friendSuggestionSignal";
import { parsePlayTime } from "../types/game";
import {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
  GameSuggestion,
  FriendCircle,
  DmThread,
  SessionMessage,
  DmAttachment,
  SharedGameStat,
  SessionRole,
  RsvpStatus,
  ReactionKind,
  SuggestionReactionKind,
  SyncResult,
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
  dmThreadId,
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
  loadFriendsDbToLocalStorage,
  setDeviceId,
  listPeerOutboxes,
  addUnseenCommunityItems,
  getUnseenTabItems,
  addUnseenTabItems,
  clearUnseenTabItems,
  FriendsDatabase,
} from "./friendsStorage";

import type {
  FriendsTabKey,
  FriendInvitation,
  SyncLogEntry,
  UnseenCounts,
} from "../components/friends/friendsTypes";

import FriendsToolbar from "../components/friends/FriendsToolbar";
import FriendsHeroStats from "../components/friends/FriendsHeroStats";
import FriendsListTab from "../components/friends/FriendsListTab";
import FriendsActivityTab from "../components/friends/FriendsActivityTab";
import FriendsDmsTab from "../components/friends/FriendsDmsTab";
import FriendsSessionsTab from "../components/friends/FriendsSessionsTab";
import FriendsRecsTab from "../components/friends/FriendsRecsTab";
import FriendsSuggestionsTab from "../components/friends/FriendsSuggestionsTab";
import FriendsCompareTab from "../components/friends/FriendsCompareTab";
import FriendsLeaderboardTab from "../components/friends/FriendsLeaderboardTab";
import FriendsRaceTab from "../components/friends/FriendsRaceTab";
import FriendsProfileTab from "../components/friends/FriendsProfileTab";
import { nextOccurrence } from "../components/friends/friendsUtils";

import AddFriendModal from "../components/friends/AddFriendModal";
import FriendsCirclesModal from "../components/friends/FriendsCirclesModal";
import FriendsSyncModal from "../components/friends/FriendsSyncModal";
import EditNicknameModal from "../components/friends/EditNicknameModal";

import "./friends.css";
import "../styles/page-friends.css";

const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.primal.net",
];

export default function FriendsPage() {
  const { t } = useLanguage();
  const { games, runningGameIds, launchGame } = useGames();
  const { wishlist, toggle: toggleWishlist } = useWishlistContext();
  const { cache } = useAchievements();
  const { showToast } = useToast();
  const { friendsNotifications, dmReadReceipts, isSimpleUi } = useSettings();

  const [activeTab, setActiveTab] = useState<FriendsTabKey>("friends");

  const isSecondaryFriendsTab =
    activeTab === "sessions" ||
    activeTab === "recs" ||
    activeTab === "suggestions" ||
    activeTab === "compare" ||
    activeTab === "leaderboard" ||
    activeTab === "race";
  const effectiveTab: FriendsTabKey = isSimpleUi && isSecondaryFriendsTab ? "friends" : activeTab;

  // Data States
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

  // DM active thread ref
  const dmsRef = useRef<DmThread[]>(dms);
  useEffect(() => {
    dmsRef.current = dms;
  }, [dms]);

  // Invitations State
  const [invitations, setInvitations] = useState<FriendInvitation[]>([]);
  const [deniedIds, setDeniedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gamelib.friends.denied") || "[]");
    } catch {
      return [];
    }
  });

  // Modals State
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCirclesModal, setShowCirclesModal] = useState(false);
  const [showP2pModal, setShowP2pModal] = useState(false);
  const [nicknameModalFriend, setNicknameModalFriend] = useState<Friend | null>(null);

  // Friend invited from a card's "Invite to session" action — pre-fills the
  // create-session form when the Sessions tab opens.
  const [pendingSessionInvite, setPendingSessionInvite] = useState<string | null>(null);

  // Friend Code input & live decode
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);

  // DM selection
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);
  const [selectedDmFriendName, setSelectedDmFriendName] = useState("");

  // Compare Tab Friend selection
  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState("");

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState("");
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);

  // Nostr pool
  const nostrPool = useMemo(() => new SimplePool(), []);

  // Compute Self Library Stats
  const selfStats = useMemo(() => {
    const gamesCount = games.length;
    let playtimeMinutes = 0;
    games.forEach((game) => {
      if (game.playTime) {
        playtimeMinutes += parsePlayTime(game.playTime);
      }
    });

    let achievementsCount = 0;
    if (cache && cache.games) {
      Object.keys(cache.games).forEach((gameId) => {
        const achData = cache.games[gameId];
        if (achData && typeof achData.unlocked === "number") {
          achievementsCount += achData.unlocked;
        }
      });
    }

    return { gamesCount, playtimeMinutes, achievementsCount };
  }, [games, cache]);

  // Self Shared Games snapshot
  const selfSharedGames = useMemo<SharedGameStat[]>(() => {
    return games.map((game) => {
      const achData = cache?.games?.[game.id];
      const achTotal = achData?.total || 0;
      const achUnlocked = achData?.unlocked || 0;
      const achievementPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : 0;
      return {
        id: game.id,
        name: game.name,
        playTimeMin: parsePlayTime(game.playTime),
        achievementPercent,
        genres: (game as any).genres || [],
      };
    });
  }, [games, cache]);

  const myGameIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  // Generate User's Friend Code
  const generatedFriendCode = useMemo(() => {
    return encodeFriendCode(profile, selfStats, profile.favoriteGameName);
  }, [profile, selfStats]);

  const nostrKeys = useMemo(() => getNostrKeys(), []);

  // Live Currently Playing status
  const currentlyPlaying = useMemo(() => {
    if (!runningGameIds || runningGameIds.length === 0) return undefined;
    const game = games.find((g) => g.id === runningGameIds[0]);
    return game ? game.name : undefined;
  }, [runningGameIds, games]);

  useEffect(() => {
    setProfile((prev) => {
      if (prev.currentlyPlaying === currentlyPlaying) return prev;
      const updated = { ...prev, currentlyPlaying };
      saveUserProfile(updated);
      return updated;
    });
  }, [currentlyPlaying]);

  // Refs keep the latest profile/stats for the background sync loop so it never
  // publishes a stale closure after the user launches/quits a game or gains stats.
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

  // Signature of the last outbox we published, used to skip redundant
  // file writes + Nostr publishes when an idle poll finds nothing changed.
  const lastPushedSignatureRef = useRef("");

  // Dedupe refs so a single event (message, cancellation, reminder) never
  // fires two notifications when both the folder sync and the Nostr
  // subscription deliver the same data.
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
      /* notification API unavailable — ignore */
    }
  };

  /** Effective start time of a session in ms: the next recurrence when it repeats, else its own time. */
  const sessionStartMs = (s: GameSession): number | null => {
    if (s.recurrence) {
      const next = nextOccurrence(s.scheduledAt, s.recurrence, Date.now());
      return next ? new Date(next).getTime() : null;
    }
    const t = new Date(s.scheduledAt).getTime();
    return Number.isNaN(t) ? null : t;
  };

  /** Sessions that involve me and were just cancelled by a sync (tombstoned). */
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

  /** Fires one notification per thread that gained new incoming messages, deduped by message id across sync sources. */
  const notifyNewDmMessages = (remoteThreads: DmThread[], knownIdsByThread: Map<string, Set<string>>, myName: string, senderName: string) => {
    remoteThreads.forEach((rt) => {
      const known = knownIdsByThread.get(rt.id);
      const fresh = (rt.messages || []).filter(
        (m) => m.author !== myName && !known?.has(m.id) && !notifiedMsgIdsRef.current.has(m.id)
      );
      if (fresh.length === 0) return;
      fresh.forEach((m) => notifiedMsgIdsRef.current.add(m.id));
      if (notifiedMsgIdsRef.current.size > 5000) notifiedMsgIdsRef.current.clear();
      const last = fresh[fresh.length - 1];
      fireNotification(t("friendsPage.notifNewMessage", { name: senderName }), last.text || "");
    });
  };

  // Handle incoming Wishlist Suggestion jump signal
  useEffect(() => {
    const pending = consumePendingSuggestion();
    if (pending) {
      setActiveTab("suggestions");
    }
  }, []);

  // Clear unseen badge when opening tab
  useEffect(() => {
    if (activeTab === "sessions") {
      clearUnseenTabItems("sessions");
      setUnseenCounts((prev) => ({ ...prev, sessions: 0 }));
    } else if (activeTab === "recs") {
      clearUnseenTabItems("recs");
      setUnseenCounts((prev) => ({ ...prev, recs: 0 }));
    } else if (activeTab === "suggestions") {
      clearUnseenTabItems("suggestions");
      setUnseenCounts((prev) => ({ ...prev, suggestions: 0 }));
    } else if (activeTab === "activity") {
      clearUnseenTabItems("sessions");
      clearUnseenTabItems("recs");
      clearUnseenTabItems("suggestions");
      clearUnseenTabItems("activity");
      setUnseenCounts((prev) => ({
        ...prev,
        sessions: 0,
        recs: 0,
        suggestions: 0,
        activity: 0,
      }));
    } else if (activeTab === "dms") {
      clearUnseenTabItems("dms");
      setUnseenCounts((prev) => ({ ...prev, dms: 0 }));
    }
  }, [activeTab]);

  // Parse Friend Code Input
  useEffect(() => {
    if (!friendCodeInput.trim()) {
      setDecodedFriend(null);
      return;
    }
    const decoded = decodeFriendCode(friendCodeInput);
    setDecodedFriend(decoded);
  }, [friendCodeInput]);

  // Fetch preview details for friend code
  useEffect(() => {
    if (!decodedFriend || !decodedFriend.syncId) return;
    let cancelled = false;

    const fetchPreview = async () => {
      try {
        const remoteOutbox = await fetchFriendOutbox(decodedFriend.syncId);
        if (remoteOutbox && remoteOutbox.profile && !cancelled) {
          setDecodedFriend((prev) => {
            if (!prev || prev.syncId !== decodedFriend.syncId) return prev;
            return {
              ...prev,
              name: remoteOutbox.profile.name,
              avatar: remoteOutbox.profile.avatar,
              status: remoteOutbox.profile.status,
              favoriteGame: remoteOutbox.profile.favoriteGame || undefined,
              currentlyPlaying: remoteOutbox.profile.currentlyPlaying || undefined,
              libStats: remoteOutbox.profile.libStats,
              lastActive: remoteOutbox.profile.lastActive,
            };
          });
        }
      } catch (err) {
        console.error("Failed to fetch friend preview outbox:", err);
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [decodedFriend?.syncId]);

  // Initial load from disk DB and resolve device ID
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
        if (!cancelled && id) {
          setDeviceId(id);
        }
      } catch (err) {
        console.error("Failed to initialize database or resolve device ID:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Sync Implementation ─────────────────────────────────────────────

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
    // Read receipts are opt-in: when disabled, our own read-state never
    // leaves the device (the sanitized copy is also what the signature
    // compares against, so a receipt-only change stays a no-op).
    const outDms = sanitizeDmsForPush(currDms || [], profile.name, dmReadReceipts);
    const signature = JSON.stringify(
      buildOutboxPayload(currProfile, currStats, currSessions, currRecs, currSharedGames, currSuggestions, outDms)
    );

    // Background polls skip the write + Nostr publish when the outbox payload
    // is byte-identical to the last one we pushed — the common idle case.
    if (!force && signature === lastPushedSignatureRef.current) {
      return { ok: true };
    }

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
      friends: friends,
      sessions: currSessions,
      recommendations: currRecs,
      suggestions: currSuggestions || [],
      dms: outDms,
    };
    publishToNostr(db, currSharedGames, currStats);
    lastPushedSignatureRef.current = signature;
    return res;
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
          const theyAddedUs = remoteDb.friends?.some((f) => f.syncId === localProfile.syncId);
          if (theyAddedUs) {
            const newInvite: FriendInvitation = {
              syncId: remoteProfile.syncId,
              name: remoteProfile.name,
              avatar: remoteProfile.avatar,
              status: remoteProfile.status,
              favoriteGame: remoteProfile.favoriteGameName || undefined,
              libStats: remoteProfile.libStats
                ? {
                    gamesCount: (remoteProfile.libStats as any).gamesCount || 0,
                    playtimeMinutes: (remoteProfile.libStats as any).playtimeMinutes || 0,
                    achievementsCount: (remoteProfile.libStats as any).achievementsCount || 0,
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

      // Count genuinely new items (from friends, not ourselves) for badges.
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
      localDms.forEach((t) => knownIdsByThread.set(t.id, new Set((t.messages || []).map((m) => m.id))));
      (remoteDb.dms || []).forEach((remoteThread) => {
        const known = knownIdsByThread.get(remoteThread.id);
        newDmMessages += (remoteThread.messages || []).filter(
          (m) => m.author !== localProfile.name && !known?.has(m.id)
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

      if (addedSessions > 0 || addedRecs > 0 || addedSuggestions > 0 || newDmMessages > 0) {
        setUnseenCounts({
          sessions: getUnseenTabItems("sessions"),
          recs: getUnseenTabItems("recs"),
          suggestions: getUnseenTabItems("suggestions"),
          activity: getUnseenTabItems("activity"),
          dms: getUnseenTabItems("dms"),
        });
      }
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
      if (!currProfile.syncId) {
        const keys = getNostrKeys();
        const updated = { ...currProfile, syncId: keys.publicKey };
        saveUserProfile(updated);
        setProfile(updated);
        profileRef.current = updated;
      }

      const folder = await getSyncFolder();
      if (!folder) {
        if (manual) {
          showToast(t("friendsPage.syncFolderMissing"), "error");
        }
        return;
      }

      const localSessions = loadSessions();
      const localRecs = loadRecommendations();
      const localSuggestions = loadSuggestions();
      const localFriends = loadFriends();
      const localDms = loadDms();

      // Presence heartbeat: bump `lastActive` (and republish the outbox)
      // every 2 minutes while the friends page is open so friends see an
      // accurate online state. The signature skip keeps idle polls a no-op
      // in between.
      const heartbeatSecs = Math.floor(Date.now() / 1000);
      if (!currProfile.lastActive || heartbeatSecs - currProfile.lastActive > 120) {
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

      // Fetch every non-blocked friend's outbox concurrently instead of awaiting
      // each one in series — the main sync speedup when there are many friends.
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
              const prevLength = mergedSessions.length;
              const prevIds = new Set(mergedSessions.map((s) => s.id));
              mergedSessions = mergeSessions(mergedSessions, remoteOutbox.sessions);
              const addedSessions = remoteOutbox.sessions.filter((s) => !prevIds.has(s.id)).length;
              newCommunityItems += addedSessions;
              if (addedSessions > 0) {
                addUnseenTabItems("sessions", addedSessions);
                const firstNew = remoteOutbox.sessions.find((s) => !prevIds.has(s.id));
                if (firstNew) fireNotification(t("friendsPage.notifNewSession", { name: friendName }), firstNew.gameName);
              }
              if (mergedSessions.length !== prevLength) {
                changesMade = true;
                friendSessions = remoteOutbox.sessions.length;
                pulledSessions += friendSessions;
              }
            }

            if (remoteOutbox.recommendations && remoteOutbox.recommendations.length > 0) {
              const prevLength = mergedRecs.length;
              const prevIds = new Set(mergedRecs.map((r) => r.id));
              mergedRecs = mergeRecommendations(mergedRecs, remoteOutbox.recommendations);
              const addedRecs = remoteOutbox.recommendations.filter((r) => !prevIds.has(r.id)).length;
              newCommunityItems += addedRecs;
              if (addedRecs > 0) addUnseenTabItems("recs", addedRecs);
              if (mergedRecs.length !== prevLength) {
                changesMade = true;
                friendRecs = remoteOutbox.recommendations.length;
                pulledRecs += friendRecs;
              }
            }

            if (remoteOutbox.suggestions && remoteOutbox.suggestions.length > 0) {
              const prevLength = mergedSuggestions.length;
              const prevIds = new Set(mergedSuggestions.map((s) => s.id));
              mergedSuggestions = mergeSuggestions(mergedSuggestions, remoteOutbox.suggestions);
              const addedSuggestions = remoteOutbox.suggestions.filter((s) => !prevIds.has(s.id)).length;
              newCommunityItems += addedSuggestions;
              if (addedSuggestions > 0) addUnseenTabItems("suggestions", addedSuggestions);
              if (mergedSuggestions.length !== prevLength) {
                changesMade = true;
              }
            }

            if (remoteOutbox.dms && remoteOutbox.dms.length > 0) {
              const knownMessages = new Map<string, Set<string>>();
              mergedDms.forEach((t) => knownMessages.set(t.id, new Set((t.messages || []).map((m) => m.id))));
              const prevDmCount = mergedDms.length;
              mergedDms = mergeDms(mergedDms, remoteOutbox.dms, currProfile.name);
              let newIncoming = 0;
              remoteOutbox.dms.forEach((rt) => {
                const known = knownMessages.get(rt.id);
                if (!known) {
                  newIncoming += (rt.messages || []).filter((m) => m.author !== currProfile.name).length;
                } else {
                  newIncoming += (rt.messages || []).filter((m) => !known.has(m.id) && m.author !== currProfile.name).length;
                }
              });
              notifyNewDmMessages(remoteOutbox.dms, knownMessages, currProfile.name, friendName);
              if (newIncoming > 0) addUnseenTabItems("dms", newIncoming);
              if (mergedDms.length !== prevDmCount || newIncoming > 0) changesMade = true;
            }

            if (remoteOutbox.profile) {
              const remoteProfile = remoteOutbox.profile;
              const hasDiff =
                friend.name !== remoteProfile.name ||
                friend.avatar !== remoteProfile.avatar ||
                friend.status !== remoteProfile.status ||
                friend.favoriteGame !== remoteProfile.favoriteGame ||
                friend.currentlyPlaying !== remoteOutbox.profile.currentlyPlaying ||
                (friend as any).bio !== (remoteProfile.bio || "") ||
                (friend as any).region !== (remoteProfile.region || "") ||
                friend.lastActive !== remoteProfile.lastActive ||
                JSON.stringify(friend.libStats) !== JSON.stringify(remoteProfile.libStats);

              if (hasDiff) profileChanged = true;

              if (hasDiff) {
                friendsUpdated = true;
                updatedFriends.push({
                  ...friend,
                  name: remoteProfile.name,
                  avatar: remoteProfile.avatar,
                  status: remoteProfile.status,
                  favoriteGame: remoteProfile.favoriteGame || undefined,
                  currentlyPlaying: remoteProfile.currentlyPlaying || undefined,
                  bio: remoteProfile.bio || undefined,
                  region: remoteProfile.region || undefined,
                  libStats: remoteProfile.libStats,
                  games: remoteOutbox.games || friend.games,
                  lastActive: remoteProfile.lastActive,
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

            // Only bump `lastSeen` (and thus mark the friend as updated) when
            // the value meaningfully changes — otherwise every 15s poll would
            // flag every friend as "updated", rewriting storage + re-rendering
            // the whole page. 5-minute granularity is plenty for a "last seen"
            // label and keeps idle polls a true no-op.
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

      // ── Anti-race re-merge before the final write ─────────────────────
      // The engine read storage when the sync started; a local mutation made
      // while it was running (session message, RSVP, create session,
      // rec/suggestion, friend edit…) would otherwise be overwritten by that
      // stale snapshot. Re-read + re-merge current storage against the
      // engine's result immediately before persisting — in-flight edits carry
      // a newer updatedAt and win the merge.
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
        setUnseenCounts({
          sessions: getUnseenTabItems("sessions"),
          recs: getUnseenTabItems("recs"),
          suggestions: getUnseenTabItems("suggestions"),
          activity: getUnseenTabItems("activity"),
          dms: getUnseenTabItems("dms"),
        });
      }

      if (friendsUpdated) {
        // Overlay the engine's remote profile updates over FRESH storage so a
        // mid-sync add/delete/pin/block/nickname is never clobbered either.
        const freshFriends = loadFriends();
        const engineById = new Map(updatedFriends.map((f) => [f.syncId, f]));
        const finalFriends = freshFriends.map((f) => {
          const engineF = engineById.get(f.syncId);
          if (!engineF) return f;
          // Remote profile data wins; local-only fields stay authoritative.
          return { ...f, ...engineF, pinned: f.pinned, blocked: f.blocked, nickname: f.nickname, groups: f.groups };
        });
        saveFriends(finalFriends);
        setFriends(finalFriends);
      }

      const pushed = await pushMyOutbox(
        currProfile,
        selfStatsRef.current,
        finalSessions,
        finalRecs,
        selfSharedGamesRef.current,
        finalSuggestions,
        finalDms,
        manual
      );

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

      setSyncLog((prev) =>
        [{ time: syncedAt, message: logMsg, details: friendLogs }, ...prev].slice(0, 12)
      );

      if (manual) {
        if (!pushed.ok) {
          showToast(t("friendsPage.syncFailed", { reason: pushed.reason || t("friendsPage.couldNotWriteOutbox") }), "error");
        } else if (pullErrors.length > 0) {
          showToast(
            t("friendsPage.syncedWithErrors", { count: pullErrors.length, errors: pullErrors.join("; ") }),
            "warning"
          );
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

      await checkFolderInvitations(currProfile.syncId, localFriends);
      addUnseenCommunityItems(newCommunityItems);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }

    if (pendingManualSync.current) {
      pendingManualSync.current = false;
      performSync(true);
    }
  };

  const checkFolderInvitations = async (mySyncId: string, currentFriends: Friend[]) => {
    if (!mySyncId) return;
    try {
      const peers = await listPeerOutboxes();
      const newInvites: FriendInvitation[] = [];

      for (const peerId of peers) {
        if (currentFriends.some((f) => f.syncId === peerId)) continue;
        if (peerId === mySyncId) continue;
        if (deniedIds.includes(peerId)) continue;

        const remoteOutbox = await fetchFriendOutbox(peerId);
        if (remoteOutbox && remoteOutbox.friends && remoteOutbox.friends.includes(mySyncId)) {
          newInvites.push({
            syncId: peerId,
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
          if (!merged.some((i) => i.syncId === invite.syncId)) {
            merged.push(invite);
          }
        });
        return merged;
      });
    } catch (e) {
      console.error("Failed to check folder invitations:", e);
    }
  };

  // Run initial sync on mount
  useEffect(() => {
    performSync(false);
  }, [profile.syncId]);

  // Background polling interval (15s)
  useEffect(() => {
    const interval = setInterval(() => {
      performSync(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [friends, profile.syncId]);

  // Session start reminders: check every 30s for sessions I'm attending that
  // start within 15 minutes, and notify once per occurrence.
  useEffect(() => {
    if (!friendsNotifications) return;
    const check = () => {
      const now = Date.now();
      const windowMs = 15 * 60 * 1000;
      sessions.forEach((s) => {
        if (s.deleted) return;
        const involved =
          s.rsvps?.[profile.name] === "going" ||
          s.invited?.includes(profile.name) ||
          s.attendees?.includes(profile.name);
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
      // Drop reminder keys older than a day so the map can't grow unbounded.
      const cutoff = now - 24 * 60 * 60 * 1000;
      reminderNotifiedRef.current.forEach((ts, k) => {
        if (ts < cutoff) reminderNotifiedRef.current.delete(k);
      });
    };
    const iv = setInterval(check, 30_000);
    check();
    return () => clearInterval(iv);
  }, [sessions, friendsNotifications, profile.name, t]);

  // Incoming P2P sync listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setupListener() {
      unlisten = await listen<string>("internet-sync-received", (event) => {
        try {
          const remoteDb = JSON.parse(event.payload) as FriendsDatabase;
          handleReceiveRemoteData(remoteDb);
        } catch (err) {
          console.error("Failed to parse/merge remote sync data:", err);
        }
      });
    }
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [deniedIds]);

  // Stable key of the friends' valid Nostr pubkeys, so the subscription is only
  // torn down when the set of friends actually changes (not on pin/nickname/block).
  const nostrFriendKeys = useMemo(
    () => friends.map((f) => f.syncId).filter((id) => /^[0-9a-fA-F]{64}$/.test(id)).sort().join(","),
    [friends]
  );

  // Nostr subscription
  useEffect(() => {
    const pubkeys = nostrFriendKeys ? nostrFriendKeys.split(",") : [];
    if (pubkeys.length === 0) return;

    const sub = nostrPool.subscribeMany(
      NOSTR_RELAYS,
      {
        authors: pubkeys,
        kinds: [30078],
        "#d": ["gamelib-friends-outbox"],
      },
      {
        onevent(event) {
          if (!verifyEvent(event)) return;
          try {
            // Public relay — never adopt DM threads from this channel.
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

  // ── Friend Actions ──────────────────────────────────────────────────

  const handleAddFriend = () => {
    if (!decodedFriend) return;
    const exists = friends.some((f) => f.syncId === decodedFriend.syncId);
    if (exists) {
      showToast(t("friendsPage.alreadyInFriends", { name: decodedFriend.name }), "error");
      return;
    }

    const updatedFriends = [...friends, decodedFriend];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    showToast(t("friendsPage.friendAdded", { name: decodedFriend.name }), "success");
    setFriendCodeInput("");
    setShowAddModal(false);

    setTimeout(() => {
      performSync(false);
    }, 100);
  };

  const handleAcceptInvitation = (invite: FriendInvitation) => {
    const exists = friends.some((f) => f.syncId === invite.syncId);
    if (exists) {
      setInvitations((prev) => prev.filter((i) => i.syncId !== invite.syncId));
      return;
    }

    const newFriend: Friend = {
      id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

    setTimeout(() => {
      performSync(true);
    }, 100);
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
    if (selectedCompareFriendId === friendId) setSelectedCompareFriendId("");
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
    if (set.has(selectedCompareFriendId)) setSelectedCompareFriendId("");
    showToast(t("friendsPage.removedFriends"), "info");
  };

  // Cross-tab actions from cards
  const handleCompareFromCard = (friend: Friend) => {
    setSelectedCompareFriendId(friend.id);
    setActiveTab("compare");
  };

  const handleInviteToSession = (friend: Friend) => {
    setPendingSessionInvite(displayName(friend));
    setActiveTab("sessions");
    showToast(t("friendsPage.invitingToSession", { name: displayName(friend) }), "info");
  };

  const handleMessageFriend = (friend: Friend) => {
    const existing = dmsRef.current.find(
      (th) => th.participants.includes(profile.name) && th.participants.includes(friend.name)
    );
    const tid = existing ? existing.id : dmThreadId(profile.name, friend.name);
    setSelectedDmId(tid);
    setSelectedDmFriendName(friend.name);
    setActiveTab("dms");
  };

  // ── Circles Handlers ────────────────────────────────────────────────

  const handleCreateCircle = (name: string, color?: string) => {
    const circle: FriendCircle = {
      id: `circle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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

  // ── Session Handlers ────────────────────────────────────────────────

  const handleRsvp = async (sessionId: string, status: RsvpStatus) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const rsvps = { ...(s.rsvps || {}) };
      if (rsvps[profile.name] === status) {
        delete rsvps[profile.name];
      } else {
        rsvps[profile.name] = status;
      }
      const isGoing = rsvps[profile.name] === "going";
      const attendees = isGoing
        ? Array.from(new Set([...s.attendees, profile.name]))
        : s.attendees.filter((n) => n !== profile.name);

      const participants = (s.participants || []).filter((p) => p.name !== profile.name);
      if (isGoing) {
        participants.push({ name: profile.name, role: "player" });
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
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, ...sessionData, updatedAt: Date.now() } : s
    );
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
        votes[o.id] = (s.poll!.votes[o.id] || []).filter((v) => v !== profile.name);
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
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleAddSessionGuest = async (sessionId: string, guestName: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = [...(s.participants || []), { name: guestName, role: "player" as SessionRole, guest: true }];
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleRemoveSessionGuest = async (sessionId: string, guestName: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).filter((p) => !(p.name === guestName && p.guest));
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions, dms);
  };

  const handleSetSessionRsvpNote = async (sessionId: string, note: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).map((p) => (p.name === profile.name ? { ...p, note } : p));
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
        { id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, author: profile.name, text, timestamp: Date.now() },
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

  // ── Recommendations Handlers ────────────────────────────────────────

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
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      return { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions, dms);
  };

  const handleAddRecComment = async (recId: string, text: string) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      const comments = [
        ...(r.comments || []),
        { id: `c_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, authorName: profile.name, text, timestamp: Date.now() },
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
      id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

  // ── Suggestions Handlers ────────────────────────────────────────────

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
        { id: `c_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, authorName: profile.name, text, timestamp: Date.now() },
      ];
      return { ...s, comments, updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated, dms);
  };

  const handleCreateSuggestion = async (sugData: Omit<GameSuggestion, "id" | "comments" | "createdAt" | "updatedAt">) => {
    const newSug: GameSuggestion = {
      ...sugData,
      id: `sug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

  // ── DMs Handlers ────────────────────────────────────────────────────

  const handleSelectDmThread = (threadId: string, friendName: string) => {
    setSelectedDmId(threadId);
    setSelectedDmFriendName(friendName);
    clearUnseenTabItems("dms");
    setUnseenCounts((prev) => ({ ...prev, dms: 0 }));
  };

  const handleSendDmMessage = async (threadId: string, text: string, attachments?: DmAttachment[]) => {
    const otherName = selectedDmFriendName;
    const now = Date.now();
    const newMsg: SessionMessage = {
      id: `msg_${now}_${Math.random().toString(36).substr(2, 6)}`,
      author: profile.name,
      text,
      timestamp: now,
      attachments,
    };

    let updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      return { ...th, messages: [...(th.messages || []), newMsg], updatedAt: now };
    });

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
    if (!thread) return;
    const lastRead = thread.lastReadAt?.[profile.name] || 0;
    const unread = (thread.messages || []).some((m) => m.author !== profile.name && m.timestamp > lastRead);
    if (!unread) return;
    const updated = dmsRef.current.map((t) =>
      t.id === threadId
        ? { ...t, lastReadAt: { ...(t.lastReadAt || {}), [profile.name]: Date.now() } }
        : t
    );
    dmsRef.current = updated;
    setDms(updated);
    saveDmsAndPersist(updated);
    void pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  // Auto-mark the open thread as read whenever it gains messages; the friend
  // only ever sees the receipt when read receipts are enabled (pushMyOutbox
  // strips our read-state otherwise).
  useEffect(() => {
    if (activeTab !== "dms" || !selectedDmId) return;
    markDmThreadRead(selectedDmId);
  }, [selectedDmId, activeTab, dms]);

  const handleDeleteDmMessage = async (threadId: string, messageId: string) => {
    const updated = dms.map((th) => {
      if (th.id !== threadId) return th;
      const messages = (th.messages || []).filter((m) => m.id !== messageId);
      return { ...th, messages, updatedAt: Date.now() };
    });
    setDms(updated);
    saveDmsAndPersist(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  const handleDeleteDmThread = async (threadId: string) => {
    const updated = dms.filter((th) => th.id !== threadId);
    setDms(updated);
    saveDmsAndPersist(updated);
    if (selectedDmId === threadId) setSelectedDmId(null);
    showToast(t("friendsPage.threadDeleted"), "info");
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions, updated);
  };

  // ── Profile Handlers ────────────────────────────────────────────────

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
            pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions, dms);
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

  return (
    <div className="friends-page page">
      {/* Tab Navigation Toolbar */}
      <FriendsToolbar
        activeTab={effectiveTab}
        onSelectTab={setActiveTab}
        friendsCount={friends.filter((f) => !f.blocked).length}
        unseenCounts={unseenCounts}
        isSyncing={isSyncing}
        lastSyncedTime={lastSyncedTime}
        onSyncNow={() => performSync(true)}
        onOpenP2pModal={() => setShowP2pModal(true)}
      />

      {/* Hero Stats Summary */}
      <div className="ui-complete-only">
        <FriendsHeroStats friends={friends} sessions={sessions} myGameIds={myGameIds} />
      </div>

      {/* Main Tab Panels */}
      <div className="friends-panel">
        {effectiveTab === "friends" && (
          <FriendsListTab
            friends={friends}
            circles={circles}
            invitations={invitations}
            myGameIds={myGameIds}
            onOpenAddModal={() => setShowAddModal(true)}
            onOpenCirclesModal={() => setShowCirclesModal(true)}
            onAcceptInvitation={handleAcceptInvitation}
            onDenyInvitation={handleDenyInvitation}
            onCompareFriend={handleCompareFromCard}
            onInviteFriend={handleInviteToSession}
            onMessageFriend={handleMessageFriend}
            onTogglePin={handleTogglePin}
            onEditNickname={setNicknameModalFriend}
            onToggleBlock={handleToggleBlock}
            onDeleteFriend={handleDeleteFriend}
            onBulkPin={handleBulkPin}
            onBulkUnpin={handleBulkUnpin}
            onBulkBlock={handleBulkBlock}
            onBulkRemove={handleBulkRemove}
          />
        )}

        {effectiveTab === "activity" && (
          <FriendsActivityTab
            friends={friends}
            sessions={sessions}
            recommendations={recommendations}
            suggestions={suggestions}
            profile={profile}
            onNavigateTab={setActiveTab}
            onSelectCompareFriend={(fid) => {
              setSelectedCompareFriendId(fid);
              setActiveTab("compare");
            }}
          />
        )}

        {effectiveTab === "dms" && (
          <FriendsDmsTab
            dms={dms}
            friends={friends}
            profile={profile}
            selectedDmId={selectedDmId}
            selectedDmFriendName={selectedDmFriendName}
            onSelectThread={handleSelectDmThread}
            onSendMessage={handleSendDmMessage}
            onReactMessage={handleReactDmMessage}
            readReceiptsEnabled={dmReadReceipts}
            onTogglePinMessage={handleTogglePinDmMessage}
            onDeleteMessage={handleDeleteDmMessage}
            onDeleteThread={handleDeleteDmThread}
            onCompareFriend={handleCompareFromCard}
          />
        )}

        {effectiveTab === "sessions" && (
          <FriendsSessionsTab
            sessions={sessions}
            profile={profile}
            friends={friends}
            libraryGames={games}
            prefillInvite={pendingSessionInvite}
            onPrefillConsumed={() => setPendingSessionInvite(null)}
            onRsvp={handleRsvp}
            onCreateSession={handleCreateSession}
            onEditSession={handleEditSession}
            onDeleteSession={handleDeleteSession}
            onVotePoll={handleVotePoll}
            onFinalizePoll={handleFinalizePoll}
            onSetRole={handleSetSessionRole}
            onAddGuest={handleAddSessionGuest}
            onRemoveGuest={handleRemoveSessionGuest}
            onSetRsvpNote={handleSetSessionRsvpNote}
            onSendMessage={handleSendSessionMessage}
            onTogglePinMessage={handleTogglePinSessionMessage}
            onLaunchGame={(gid) => {
              const match = games.find((g) => g.id === gid);
              if (match) launchGame(match);
            }}
          />
        )}

        {effectiveTab === "recs" && (
          <FriendsRecsTab
            recommendations={recommendations}
            profile={profile}
            friends={friends}
            libraryGames={games}
            onReact={handleReactRec}
            onToggleWantToPlay={handleToggleWantToPlay}
            onAddComment={handleAddRecComment}
            onCreateRec={handleCreateRec}
            onDeleteRec={handleDeleteRec}
            onOpenGame={(_gid, gname) => {
              const match = games.find((g) => g.name.toLowerCase() === gname.toLowerCase());
              if (match) launchGame(match);
            }}
          />
        )}

        {effectiveTab === "suggestions" && (
          <FriendsSuggestionsTab
            suggestions={suggestions}
            profile={profile}
            friends={friends}
            wishlistGames={wishlist}
            onReact={handleReactSuggestion}
            onToggleWishlist={handleToggleWishlistSuggestion}
            onAddComment={handleAddSuggestionComment}
            onCreateSuggestion={handleCreateSuggestion}
            onDeleteSuggestion={handleDeleteSuggestion}
            onOpenGame={(_gid, gname) => {
              const match = games.find((g) => g.name.toLowerCase() === gname.toLowerCase());
              if (match) launchGame(match);
            }}
          />
        )}

        {effectiveTab === "compare" && (
          <FriendsCompareTab
            friends={friends}
            selfSharedGames={selfSharedGames}
            selectedFriendId={selectedCompareFriendId}
            onSelectFriendId={setSelectedCompareFriendId}
            onLaunchGame={(gid) => {
              const match = games.find((g) => g.id === gid);
              if (match) launchGame(match);
            }}
          />
        )}

        {effectiveTab === "leaderboard" && (
          <FriendsLeaderboardTab
            friends={friends}
            profile={profile}
            selfStats={selfStats}
            selfSharedGames={selfSharedGames}
            onSelectFriend={handleCompareFromCard}
          />
        )}

        {effectiveTab === "race" && (
          <FriendsRaceTab
            friends={friends}
            profile={profile}
            selfSharedGames={selfSharedGames}
            libraryGames={games}
          />
        )}

        {effectiveTab === "profile" && (
          <FriendsProfileTab
            profile={profile}
            setProfile={setProfile}
            selfStats={selfStats}
            libraryGames={games}
            myFriendCode={generatedFriendCode}
            nostrPublicKey={nostrKeys.publicKey}
            onSaveProfile={handleSaveProfile}
            onImageUpload={handleImageUpload}
          />
        )}
      </div>

      {/* Modals */}
      <AddFriendModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        myFriendCode={generatedFriendCode}
        nostrPublicKey={nostrKeys.publicKey}
        friendCodeInput={friendCodeInput}
        onFriendCodeInputChange={setFriendCodeInput}
        decodedFriend={decodedFriend}
        onAddFriend={handleAddFriend}
      />

      <FriendsCirclesModal
        isOpen={showCirclesModal}
        onClose={() => setShowCirclesModal(false)}
        circles={circles}
        friends={friends.filter((f) => !f.blocked)}
        onCreateCircle={handleCreateCircle}
        onRenameCircle={handleRenameCircle}
        onDeleteCircle={handleDeleteCircle}
        onToggleFriendCircle={handleToggleFriendCircle}
      />

      <FriendsSyncModal
        isOpen={showP2pModal}
        onClose={() => setShowP2pModal(false)}
        isSyncing={isSyncing}
        lastSyncedTime={lastSyncedTime}
        syncLog={syncLog}
        onTriggerSync={() => performSync(true)}
      />

      <EditNicknameModal
        friend={nicknameModalFriend}
        isOpen={!!nicknameModalFriend}
        onClose={() => setNicknameModalFriend(null)}
        onSave={handleSetNickname}
      />
    </div>
  );
}
