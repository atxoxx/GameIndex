// useFriendsData — local data layer + handlers for the Big Screen Friends
// hub.
//
// Local reads and writes all go through `friendsStorage`; everything that
// leaves the machine is owned by the always-on friends sync engine exposed
// by `useFriendsSync()`. This hook never opens a relay, never touches the
// legacy sync folder and never listens for P2P payloads: it writes a local
// mutation (which notifies the engine through `persistLocalStorageToDisk`)
// and re-reads storage whenever the engine merges something in, via
// `subscribeFriendsDbChange`.
//
// The public result keeps the shape the Big Screen components compile
// against; the sync fields now mirror the engine's own status instead of a
// page-owned poll loop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { parsePlayTime } from "../types/game";
import { useFriendsSync } from "../sync/friends/FriendsSyncProvider";
import type {
  FriendsSyncPhase,
  FriendsSyncStatus,
  PeerSyncState,
} from "../sync/friends/engine";
import {
  type UserProfile,
  type Friend,
  type GameSession,
  type RsvpStatus,
  type SessionMessage,
  loadUserProfile,
  saveUserProfile,
  loadFriends,
  saveFriends,
  loadSessions,
  saveSessions,
  loadFriendsDbToLocalStorage,
  encodeFriendCode,
  decodeFriendCode,
  subscribeFriendsDbChange,
} from "../pages/friendsStorage";
import { asPeerPubkey } from "../pages/friends/friendsSyncHelpers";

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

  /** True while the engine is connecting or has events queued for delivery. */
  isSyncing: boolean;
  /** The engine's live status (phase, relays, pending publishes, peers). */
  syncStatus: FriendsSyncStatus;
  syncPhase: FriendsSyncPhase;
  /** Relay URL -> last observed health. */
  relayStatus: FriendsSyncStatus["relayStatus"];
  /** Per-peer sync state keyed by peer pubkey (presence, last seen, revs). */
  peerStates: Record<string, PeerSyncState>;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  pendingPublish: number;

  /** Ask the engine for a full pass; the engine also syncs on its own. */
  performSync: (manual?: boolean) => Promise<void>;
  /** Send (or re-send) a friend request for a pasted pubkey. */
  sendFriendRequest: (pubkey: string) => void;

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
  const { summaries } = useAchievements();
  const { showToast } = useToast();
  const {
    status,
    syncNow,
    sendFriendRequest,
    blockPeer,
    removePeer,
  } = useFriendsSync();

  // Load state (single active profile, matching FriendsPage's hardcoded "A")
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);
  // Bumped whenever the disk DB is loaded into localStorage, so the
  // companion social hook can re-read storage even without a sync cycle.
  const [dbLoadVersion, setDbLoadVersion] = useState(0);

  const friendsRef = useRef(friends);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

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
    for (const s of Object.values(summaries)) {
      achievementsCount += s.unlocked;
    }

    return { gamesCount, playtimeMinutes, achievementsCount };
  }, [games, summaries]);

  // Generate User's Friend Code (the pubkey, once the identity is loaded).
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
  // presence carries it. The save notifies the engine, which republishes.
  useEffect(() => {
    setProfile((prev) => {
      if (prev.currentlyPlaying === currentlyPlaying) return prev;
      const updated = { ...prev, currentlyPlaying };
      saveUserProfile(updated);
      return updated;
    });
  }, [currentlyPlaying]);

  // Handle friend code paste parsing.
  useEffect(() => {
    if (!friendCodeInput.trim()) {
      setDecodedFriend(null);
      return;
    }
    setDecodedFriend(decodeFriendCode(friendCodeInput));
  }, [friendCodeInput]);

  // Re-read the friend graph + sessions whenever the engine merges remote
  // data (or any other part of the app writes through friendsStorage).
  useEffect(
    () =>
      subscribeFriendsDbChange(() => {
        setFriends(loadFriends());
        setSessions(loadSessions());
      }),
    []
  );

  // Load the local JSON database from disk once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadFriendsDbToLocalStorage();
        if (cancelled || !loaded) return;
        setProfile(loadUserProfile());
        setFriends(loadFriends());
        setSessions(loadSessions());
        setDbLoadVersion((v) => v + 1);
      } catch (err) {
        console.error("Failed to load the friends database:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // `loadUserProfile` resolves the syncId from the keychain-backed identity,
  // which the provider loads asynchronously. Adopt it as soon as the engine
  // leaves idle — never replace the rest of the profile, the editor keeps an
  // unsaved draft in this same state.
  const phase = status.phase;
  useEffect(() => {
    if (phase === "idle") return;
    const stored = loadUserProfile();
    setProfile((prev) =>
      prev.syncId === stored.syncId ? prev : { ...prev, syncId: stored.syncId }
    );
  }, [phase]);

  // ── Sync ─────────────────────────────────────────────────────────

  // The engine polls, publishes and retries on its own; a manual press just
  // asks for one more pass. `manual` is kept for the existing call sites.
  const performSync = useCallback(
    async (_manual = false) => {
      syncNow();
    },
    [syncNow]
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSaveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // The write notifies the engine, which republishes on its own debounce.
    saveUserProfile(profile);
    showToast(t("friendsPage.profileUpdated"), "success");
  };

  // Add a friend: persist an outgoing request and let the engine deliver it.
  const handleAddFriend = () => {
    if (!decodedFriend) return;
    const pubkey = asPeerPubkey(decodedFriend.syncId);
    if (!pubkey) {
      showToast(t("bigscreen.friends.invalidKey"), "error");
      return;
    }
    if (pubkey === asPeerPubkey(profile.syncId)) {
      showToast(t("friendsPage.cannotAddYourself"), "error");
      return;
    }

    const exists = friendsRef.current.some((f) => asPeerPubkey(f.syncId) === pubkey);
    if (exists) {
      showToast(t("friendsPage.alreadyInFriends", { name: decodedFriend.name }), "error");
      return;
    }

    // Written as pending before the engine is asked, so `sendFriendRequest`
    // cannot mistake the new record for an already-accepted friendship.
    const updatedFriends = [
      ...friendsRef.current,
      { ...decodedFriend, consent: "pending" as const, requestedAt: Date.now() },
    ];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    sendFriendRequest(pubkey);
    showToast(t("friendsPage.friendAdded", { name: decodedFriend.name }), "success");
    setFriendCodeInput("");
  };

  // Delete a friend (the engine drops every cached rev for the peer).
  const handleDeleteFriend = (friendId: string, friendName: string) => {
    const friend = friendsRef.current.find((f) => f.id === friendId);
    if (!friend) return;
    const pubkey = asPeerPubkey(friend.syncId);
    if (pubkey) {
      removePeer(pubkey);
    } else {
      const updated = friendsRef.current.filter((f) => f.id !== friendId);
      setFriends(updated);
      saveFriends(updated);
    }
    showToast(t("friendsPage.removedFromFriends", { name: friendName }), "info");
  };

  // Toggle pin (favorite) for a friend — local only, never synced.
  const handleTogglePin = (friendId: string) => {
    const updated = friendsRef.current.map((f) =>
      f.id === friendId ? { ...f, pinned: !f.pinned } : f
    );
    setFriends(updated);
    saveFriends(updated);
  };

  // Block / unblock a peer. Blocking goes through the engine so its caches
  // and in-flight jobs for that peer are dropped immediately.
  const handleToggleBlock = (friendId: string, friendName: string) => {
    const friend = friendsRef.current.find((f) => f.id === friendId);
    if (!friend) return;
    const blocking = !friend.blocked;
    const updated = friendsRef.current.map((f) =>
      f.id === friendId ? { ...f, blocked: blocking } : f
    );
    setFriends(updated);
    saveFriends(updated);
    const pubkey = asPeerPubkey(friend.syncId);
    if (blocking && pubkey) blockPeer(pubkey);
    showToast(
      blocking
        ? t("friendsPage.blockedFriend", { name: friendName })
        : t("friendsPage.unblockedFriend", { name: friendName }),
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
        ? Array.from(new Set([...(s.attendees || []), profile.name]))
        : (s.attendees || []).filter((n) => n !== profile.name);
      // Keep the participant record in sync with the RSVP without demoting us:
      // an RSVP toggle must preserve the role/note already recorded.
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
      const label = rsvps[profile.name] ? t(`friendsPage.rsvp_${rsvps[profile.name]}`) : t("friendsPage.noResponse");
      showToast(t("friendsPage.rsvpSet", { status: label }), "info");
      return { ...s, rsvps, attendees, participants, updatedAt: Date.now() };
    });

    setSessions(updated);
    saveSessions(updated);
  };

  // Remove a session entirely (hard delete from local list)
  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
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
    isSyncing: phase === "connecting" || status.pendingPublish > 0,
    syncStatus: status,
    syncPhase: phase,
    relayStatus: status.relayStatus,
    peerStates: status.peers,
    lastSyncedAt: status.lastSyncedAt,
    lastSyncError: status.lastError,
    pendingPublish: status.pendingPublish,
    performSync,
    sendFriendRequest: (pubkey: string) => {
      const peer = asPeerPubkey(pubkey);
      if (peer) sendFriendRequest(peer);
    },
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
