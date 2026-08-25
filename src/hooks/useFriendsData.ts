// useFriendsData — self-contained data layer + handlers for the Big
// Screen Friends hub.
//
// Extracted from FriendsPage so the bigscreen component can render
// without threading 20 props from the desktop page. Mirrors the exact
// storage helpers / behavior FriendsPage uses (load/save via
// friendsStorage, folder sync via pushMyOutbox/fetchFriendOutbox,
// Nostr publish on sync) so the desktop and bigscreen friends data
// stay in sync and behave identically.
//
// Desktop FriendsPage keeps its own (unchanged) implementation — this
// hook only powers BigScreenFriends.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { parsePlayTime } from "../types/game";
import {
  type UserProfile,
  type Friend,
  type GameSession,
  type GameRecommendation,
  type GameSuggestion,
  type SharedGameStat,
  type DmThread,
  type RsvpStatus,
  type SessionMessage,
  type FriendsDatabase,
  type SyncResult,
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
  loadDms,
  saveDmsAndPersist,
  encodeFriendCode,
  decodeFriendCode,
  displayName,
  getNostrKeys,
  getSyncFolder,
  fetchFriendOutbox,
  pushMyOutbox as pushMyOutboxStorage,
  loadFriendsDbToLocalStorage,
  setDeviceId,
  mergeSessions,
  mergeRecommendations,
  mergeSuggestions,
  mergeDatabases,
  mergeDms,
  addUnseenTabItems,
  addUnseenCommunityItems,
  buildOutboxPayload,
  buildNostrOutboxPayload,
  publishNostrOutbox,
  sanitizeDmsForPush,
  stripDms,
} from "../pages/friendsStorage";

const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.primal.net",
];

export interface UseFriendsDataResult {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  friends: Friend[];
  sessions: GameSession[];
  selfStats: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  generatedFriendCode: string;
  friendCodeInput: string;
  setFriendCodeInput: (val: string) => void;
  decodedFriend: Friend | null;
  dbLoadVersion: number;
  isSyncing: boolean;
  performSync: (manual?: boolean) => Promise<void>;
  handleSetRsvp: (sessionId: string, status: RsvpStatus) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleSendMessage: (sessionId: string, text: string) => Promise<void>;
  handleSaveProfile: (e?: React.FormEvent) => Promise<void>;
  handleAddFriend: () => void;
  handleTogglePin: (friendId: string) => void;
  handleToggleBlock: (friendId: string, friendName: string) => void;
  handleDeleteFriend: (friendId: string, friendName: string) => void;
}

export function useFriendsData(): UseFriendsDataResult {
  const { t } = useLanguage();
  const { games, runningGameIds } = useGames();
  const { cache } = useAchievements();
  const { showToast } = useToast();
  const { dmReadReceipts } = useSettings();

  // Load state (single active profile, matching FriendsPage's hardcoded "A")
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>(() => loadSuggestions());
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  // Bumped whenever the disk DB is loaded into localStorage, so the
  // companion social hook can re-read storage even without a sync cycle.
  const [dbLoadVersion, setDbLoadVersion] = useState(0);

  // Manual sync requests that arrive while a sync is already running are
  // queued so the user's "Sync" click is never silently dropped.
  const pendingManualSync = useRef(false);
  // Refs (not state) guard the sync loop — the state value captured in a
  // 15s-interval closure goes stale the moment a cycle starts, letting a
  // slow cycle (relay timeouts) overlap with the next tick.
  const isSyncingRef = useRef(false);
  // Signature of the last outbox payload we actually pushed; background
  // polls skip the file write + 4× relay publish when nothing changed.
  const lastPushedSignatureRef = useRef<string | null>(null);

  const nostrPool = useMemo(() => new SimplePool(), []);

  // Dynamic self library stats
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

  // Lightweight per-game snapshot published to friends for truthful comparison.
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

  // Generate User's Friend Code
  const generatedFriendCode = useMemo(() => {
    return encodeFriendCode(profile, selfStats, profile.favoriteGameName);
  }, [profile, selfStats]);

  // Derive the game we're currently playing from the live watcher state.
  const currentlyPlaying = useMemo(() => {
    if (!runningGameIds || runningGameIds.length === 0) return undefined;
    const game = games.find((g) => g.id === runningGameIds[0]);
    return game ? game.name : undefined;
  }, [runningGameIds, games]);

  // Keep the profile's "currentlyPlaying" field in sync with the watcher so
  // it is included in the outbox and visible to friends.
  useEffect(() => {
    setProfile((prev) => {
      if (prev.currentlyPlaying === currentlyPlaying) return prev;
      const updated = { ...prev, currentlyPlaying };
      saveUserProfile(updated);
      return updated;
    });
  }, [currentlyPlaying]);

  // Handle friend code paste parsing
  useEffect(() => {
    if (!friendCodeInput.trim()) {
      setDecodedFriend(null);
      return;
    }
    const decoded = decodeFriendCode(friendCodeInput);
    setDecodedFriend(decoded);
  }, [friendCodeInput]);

  // Asynchronously fetch real profile details for the friend code preview
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

  // Load local JSON database from disk, and resolve stable device ID on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Initial load from local JSON file
        const loaded = await loadFriendsDbToLocalStorage();
        if (!cancelled && loaded) {
          setProfile(loadUserProfile());
          setFriends(loadFriends());
          setSessions(loadSessions());
          setRecommendations(loadRecommendations());
          setSuggestions(loadSuggestions());
          setDbLoadVersion((v) => v + 1);
        }

        // 2. Resolve device ID
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

  // Local wrapper around pushMyOutbox that handles both local files and Nostr relays.
  // Mirrors FriendsPage: read receipts are opt-in (our read-state never leaves the
  // device when disabled), and background pushes skip the write + relay publish when
  // the outbox payload is byte-identical to the last one we pushed — the common idle case.
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
    const outDms = sanitizeDmsForPush(currDms || [], currProfile.name, dmReadReceipts);
    const signature = JSON.stringify(
      buildOutboxPayload(currProfile, currStats, currSessions, currRecs, currSharedGames, currSuggestions, outDms)
    );
    if (!force && signature === lastPushedSignatureRef.current) {
      return { ok: true };
    }

    const res = await pushMyOutboxStorage(currProfile, currStats, currSessions, currRecs, currSharedGames, currSuggestions, outDms);

    // Also publish to Nostr (the public-relay payload deliberately excludes
    // DM threads — those only travel through the private folder / P2P sync).
    const payload = buildNostrOutboxPayload(
      currProfile,
      currStats,
      currSessions,
      currRecs,
      currSharedGames,
      currSuggestions
    );
    await publishNostrOutbox(payload);
    lastPushedSignatureRef.current = signature;
    return res;
  };

  // ── Sync Engine (mirrors FriendsPage's performSync) ────────────────

  const performSync = async (manual = false) => {
    if (isSyncingRef.current) {
      if (manual) pendingManualSync.current = true;
      return;
    }
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
    // Make sure we always have a stable Nostr public key before publishing.
    let currProfile = profileRef.current;
    if (!currProfile.syncId) {
      const keys = getNostrKeys();
      const updated = { ...currProfile, syncId: keys.publicKey };
      saveUserProfile(updated);
      setProfile(updated);
      profileRef.current = updated;
      currProfile = updated;
    }

    // Presence heartbeat: bump `lastActive` (and republish the outbox) every
    // 2 minutes while the hub is open so friends see an accurate online state.
    const heartbeatSecs = Math.floor(Date.now() / 1000);
    if (!currProfile.lastActive || heartbeatSecs - currProfile.lastActive > 120) {
      const heartbeated = { ...currProfile, lastActive: heartbeatSecs };
      saveUserProfile(heartbeated);
      setProfile(heartbeated);
      profileRef.current = heartbeated;
      currProfile = heartbeated;
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

    // NOTE: Friends are added manually via friend codes only. We intentionally
    // do NOT auto-discover peers in the shared sync folder, because that would
    // also pull in the player's own outbox (appearing as a "friend").

    let changesMade = false;
    let friendsUpdated = false;
    let pulledSessions = 0;
    let pulledRecs = 0;
    // Genuinely new social items pulled from friends this sync — drives the
    // "new items" number badge on the Community tab.
    let newCommunityItems = 0;
    const pullErrors: string[] = [];

    let mergedSessions = [...localSessions];
    let mergedRecs = [...localRecs];
    let mergedSuggestions = [...localSuggestions];
    let mergedDms = [...loadDms()];

    // Read the outbox of each friend from the sync folder
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
      // Skipped (blocked) peers: keep them locally but never sync their data.
      if (friend.blocked) {
        updatedFriends.push(friend);
        continue;
      }
      try {
        const result = outboxBySyncId.get(friend.syncId);
        if (result?.error) throw result.error;
        const remoteOutbox = result?.remoteOutbox;
        if (remoteOutbox) {
          // Merge sessions
          if (remoteOutbox.sessions && remoteOutbox.sessions.length > 0) {
            const prevLength = mergedSessions.length;
            const prevIds = new Set(mergedSessions.map((s) => s.id));
            mergedSessions = mergeSessions(mergedSessions, remoteOutbox.sessions);
            const addedSessions = remoteOutbox.sessions.filter((s) => !prevIds.has(s.id)).length;
            newCommunityItems += addedSessions;
            if (addedSessions > 0) addUnseenTabItems("sessions", addedSessions);
            if (mergedSessions.length !== prevLength) {
              changesMade = true;
              pulledSessions += remoteOutbox.sessions.length;
            }
          }

          // Merge recommendations
          if (remoteOutbox.recommendations && remoteOutbox.recommendations.length > 0) {
            const prevLength = mergedRecs.length;
            const prevIds = new Set(mergedRecs.map((r) => r.id));
            mergedRecs = mergeRecommendations(mergedRecs, remoteOutbox.recommendations);
            const addedRecs = remoteOutbox.recommendations.filter((r) => !prevIds.has(r.id)).length;
            newCommunityItems += addedRecs;
            if (addedRecs > 0) addUnseenTabItems("recs", addedRecs);
            if (mergedRecs.length !== prevLength) {
              changesMade = true;
              pulledRecs += remoteOutbox.recommendations.length;
            }
          }

          // Merge wishlist game suggestions
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

          // Merge 1:1 DM threads (only threads involving us are adopted).
          if (remoteOutbox.dms && remoteOutbox.dms.length > 0) {
            const knownMessages = new Map<string, Set<string>>();
            mergedDms.forEach((t) => knownMessages.set(t.id, new Set((t.messages || []).map((m) => m.id))));
            const prevDmCount = mergedDms.length;
            mergedDms = mergeDms(mergedDms, remoteOutbox.dms, currProfile.name);
            // Count messages that are genuinely new AND not authored by us → badge.
            let newIncoming = 0;
            remoteOutbox.dms.forEach((rt) => {
              const known = knownMessages.get(rt.id);
              if (!known) {
                newIncoming += (rt.messages || []).filter((m) => m.author !== currProfile.name).length;
              } else {
                newIncoming += (rt.messages || []).filter((m) => !known.has(m.id) && m.author !== currProfile.name).length;
              }
            });
            if (newIncoming > 0) addUnseenTabItems("dms", newIncoming);
            if (mergedDms.length !== prevDmCount || newIncoming > 0) changesMade = true;
          }

          // Sync friend profile information and live statistics (playtime, achievements, status)
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
              continue;
            }
          }

          // Only bump `lastSeen` (and thus mark the friend as updated) when
          // the value meaningfully changes — otherwise every 15s poll would
          // flag every friend as "updated", rewriting storage + re-rendering.
          const lastSeenStale = !friend.lastSeen || nowSecs - friend.lastSeen > 300;
          if (lastSeenStale) {
            friendsUpdated = true;
            updatedFriends.push({ ...friend, lastSeen: nowSecs });
            continue;
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        pullErrors.push(`${friendName}: ${reason}`);
        console.error(`Sync error for friend ${friendName}:`, reason);
      }
      updatedFriends.push(friend);
    }

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

    // Always push our own updated outbox so friends can see us
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

    // Surface genuinely-new social items as a number badge on the
    // Community tab (sessions / recommendations / suggestions pulled
    // from friends this sync). Only bumps when items are truly new.
    addUnseenCommunityItems(newCommunityItems);
    } finally {
      // Guaranteed reset: a throw anywhere mid-cycle must never leave
      // the sync flag stuck (the hub's sync indicator would spin
      // forever). The `!folder` early return above also lands here.
      isSyncingRef.current = false;
      setIsSyncing(false);
    }

    // Honor a manual sync that was requested while this one was running.
    if (pendingManualSync.current) {
      pendingManualSync.current = false;
      performSync(true);
    }
  };

  // Run initial sync on mount
  useEffect(() => {
    performSync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.syncId]);

  // Background polling timer (mirrors FriendsPage's 15s cadence) so remote
  // updates keep landing while the bigscreen hub is open.
  useEffect(() => {
    const interval = setInterval(() => {
      void performSync(false);
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, profile.syncId]);

  // Latest sync engine so event listeners never call a stale closure.
  const performSyncRef = useRef(performSync);
  useEffect(() => {
    performSyncRef.current = performSync;
  }, [performSync]);

  // Merge a remote database received via P2P / Nostr into local storage and
  // state, then run a sync cycle so the companion hook reloads from storage.
  const handleReceiveRemoteData = useCallback((remoteDb: FriendsDatabase) => {
    try {
      const localProfile = loadUserProfile();
      const localFriends = loadFriends();
      const remoteProfile = remoteDb.profile;
      if (remoteProfile && remoteProfile.syncId) {
        const isFriend = localFriends.some((f) => f.syncId === remoteProfile.syncId);
        const isSelf = remoteProfile.syncId === localProfile.syncId;
        // Only accept payloads from known friends (or ourselves). Unknown
        // peers — including denied ones — are ignored; invitation discovery
        // for them is owned by the social hook's folder check.
        if (!isFriend && !isSelf) return;
      }

      const merged = mergeDatabases(
        {
          profile: localProfile,
          friends: localFriends,
          sessions: loadSessions(),
          recommendations: loadRecommendations(),
          suggestions: loadSuggestions(),
          dms: loadDms(),
        },
        remoteDb,
      );

      // Count freshly-arrived DM messages that aren't ours for the badge.
      let newDmMessages = 0;
      const localDms = loadDms();
      (remoteDb.dms || []).forEach((remoteThread) => {
        const localThread = localDms.find((t) => t.id === remoteThread.id);
        const known = new Set((localThread?.messages || []).map((m) => m.id));
        (remoteThread.messages || []).forEach((m) => {
          if (!known.has(m.id) && m.author !== localProfile.name) newDmMessages++;
        });
      });

      saveFriends(merged.friends);
      saveSessions(merged.sessions);
      saveRecommendations(merged.recommendations);
      saveSuggestions(merged.suggestions);
      saveDmsAndPersist(merged.dms);
      setFriends(merged.friends);
      setSessions(merged.sessions);
      setRecommendations(merged.recommendations);
      setSuggestions(merged.suggestions);

      if (newDmMessages > 0) addUnseenTabItems("dms", newDmMessages);

      // A completed sync cycle makes the companion hook re-read storage.
      void performSyncRef.current(false);
    } catch (err) {
      console.error("Failed to parse/merge remote sync data:", err);
    }
  }, []);

  // Incoming P2P sync payloads emitted by the backend sync loop.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen<string>("internet-sync-received", (event) => {
        try {
          const remoteDb = JSON.parse(event.payload) as FriendsDatabase;
          handleReceiveRemoteData(remoteDb);
        } catch (err) {
          console.error("Failed to parse/merge remote sync data:", err);
        }
      });
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleReceiveRemoteData]);

  // Subscribe to friends' pubkeys via Nostr so relay updates land live
  // (mirrors FriendsPage; resubscribes when the friend list changes).
  useEffect(() => {
    if (friends.length === 0) return;

    const pubkeys = friends.map((f) => f.syncId).filter((id) => /^[0-9a-fA-F]{64}$/.test(id));
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
          if (!verifyEvent(event)) {
            console.error("Nostr: invalid signature for event:", event.id);
            return;
          }
          try {
            // Public relay — never adopt DM threads from this channel.
            const remoteDb = stripDms(JSON.parse(event.content) as FriendsDatabase);
            handleReceiveRemoteData(remoteDb);
          } catch (err) {
            console.error("Nostr: failed to parse remote data:", err);
          }
        },
      },
    );

    return () => {
      sub.close();
    };
  }, [friends, nostrPool, handleReceiveRemoteData]);

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSaveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
    saveUserProfile(profile);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions);
    showToast(t("friendsPage.profileUpdated"), "success");
  };

  // Add a friend
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

    // Trigger instant synchronization
    setTimeout(() => {
      performSync(false);
    }, 100);
  };

  // Delete a friend
  const handleDeleteFriend = (friendId: string, friendName: string) => {
    const updated = friends.filter((f) => f.id !== friendId);
    setFriends(updated);
    saveFriends(updated);
    showToast(t("friendsPage.removedFromFriends", { name: friendName }), "info");
  };

  // Toggle pin (favorite) for a friend
  const handleTogglePin = (friendId: string) => {
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, pinned: !f.pinned } : f
    );
    setFriends(updated);
    saveFriends(updated);
  };

  // Block / unblock a peer (skips their outbox during sync)
  const handleToggleBlock = (friendId: string, friendName: string) => {
    const friend = friends.find((f) => f.id === friendId);
    if (!friend) return;
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, blocked: !f.blocked } : f
    );
    setFriends(updated);
    saveFriends(updated);
    showToast(
      friend.blocked ? t("friendsPage.unblockedFriend", { name: friendName }) : t("friendsPage.blockedFriend", { name: friendName }),
      "info"
    );
  };

  // Set an RSVP status (going / maybe / declined) for the current user.
  const handleSetRsvp = async (sessionId: string, status: RsvpStatus) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const rsvps = { ...(s.rsvps || {}) };
      // Toggling the same status clears it back to no response.
      if (rsvps[profile.name] === status) {
        delete rsvps[profile.name];
      } else {
        rsvps[profile.name] = status;
      }
      const isGoing = rsvps[profile.name] === "going";
      const attendees = isGoing
        ? Array.from(new Set([...s.attendees, profile.name]))
        : s.attendees.filter((n) => n !== profile.name);
      // Keep the participant record in sync with the RSVP.
      const participants = (s.participants || []).filter((p) => p.name !== profile.name);
      if (isGoing) {
        participants.unshift({ name: profile.name, role: "player", timezone: detectTimezone() });
      }
      const label = rsvps[profile.name] ? t(`friendsPage.rsvp_${rsvps[profile.name]}`) : t("friendsPage.noResponse");
      showToast(t("friendsPage.rsvpSet", { status: label }), "info");
      return { ...s, rsvps, attendees, participants, updatedAt: Date.now() };
    });

    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Remove a session entirely (hard delete from local list)
  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
    showToast(t("friendsPage.sessionRemoved"), "info");
  };

  // Append a chat message to a session's shared thread.
  const handleSendMessage = async (sessionId: string, text: string) => {
    const msg: SessionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      author: profile.name,
      text,
      timestamp: Date.now(),
    };
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: [...(s.messages || []), msg], updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  return {
    profile,
    setProfile,
    friends,
    sessions,
    selfStats,
    generatedFriendCode,
    friendCodeInput,
    setFriendCodeInput,
    decodedFriend,
    dbLoadVersion,
    isSyncing,
    performSync,
    handleSetRsvp,
    handleDeleteSession,
    handleSendMessage,
    handleSaveProfile,
    handleAddFriend,
    handleTogglePin,
    handleToggleBlock,
    handleDeleteFriend,
  };
}

/** Detect the viewer's IANA timezone. */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
