import { invoke } from "@tauri-apps/api/core";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode as nip19Decode } from "nostr-tools/nip19";

/**
 * Public Nostr relays the friends sync engine connects to.
 * Centralised here so the engine and the sync UI can never drift apart.
 */
export const NOSTR_RELAYS: readonly string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.primal.net",
];

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export interface NostrKeys {
  privateKey: Uint8Array;
  privateKeyHex: string;
  publicKey: string;
}

let cachedNostrKeys: NostrKeys | null = null;
/** Session-only key used while no persisted key is reachable. Never written
 *  to localStorage or the backend, so the real identity is never rotated by
 *  a transient backend failure. */
let sessionFallbackKeys: NostrKeys | null = null;

const LS_NOSTR_PRIVKEY = "gamelib.friends.nostr_privkey";

/** True inside the Tauri webview (as opposed to a plain browser via
 *  `npm run dev`). Same pattern the rest of the codebase uses
 *  (e.g. utils/news/feed.ts). */
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Loads (or creates) the Nostr signing key used for the friends outbox.
 *
 * The key lives in the backend `kv_store` (SQLite). `initNostrKeys` must run
 * before the friends page renders (see main.tsx) so `getNostrKeys` can
 * resolve synchronously from the in-memory cache. The legacy localStorage
 * copy is migrated on first run and never written again outside of
 * frontend-only dev mode, where the backend is unavailable.
 *
 * Identity safety: a new key is minted ONLY when the backend is healthy and
 * confirms it has no key. If the backend read/write fails (transient error),
 * nothing is generated or persisted — the stored identity must win on the
 * next successful boot rather than being silently rotated.
 */
let initNostrKeysPromise: Promise<void> | null = null;

export async function initNostrKeys(): Promise<void> {
  if (cachedNostrKeys) return;
  // In-flight guard: two concurrent callers (e.g. the boot-time hydration
  // and a sync cycle) must await the SAME operation. Without this, each
  // call could observe an empty backend and mint a different identity,
  // racing the `set_friends_nostr_privkey` writes.
  if (initNostrKeysPromise) return initNostrKeysPromise;
  initNostrKeysPromise = loadOrMintNostrKeys().finally(() => {
    initNostrKeysPromise = null;
  });
  return initNostrKeysPromise;
}

async function loadOrMintNostrKeys(): Promise<void> {
  if (cachedNostrKeys) return;

  if (isTauriRuntime()) {
    // Real Tauri shell — the backend kv store is the only authoritative
    // location for the key.
    let stored: string | null = null;
    try {
      stored = await invoke<string | null>("get_friends_nostr_privkey");
    } catch {
      // Genuine backend failure (transient or persistent). Do NOT mint a
      // replacement key here: the stored key (if any) is still on the
      // backend and must win on the next successful read. Generating a new
      // one would silently rotate the user's identity and orphan every
      // friend who already added them.
      return;
    }
    if (stored && /^[0-9a-fA-F]{64}$/.test(stored)) {
      const sk = hexToBytes(stored);
      cachedNostrKeys = { privateKey: sk, privateKeyHex: stored, publicKey: getPublicKey(sk) };
      // Drop any legacy plaintext copy from localStorage now that the
      // backend key is loaded.
      try {
        localStorage.removeItem(LS_NOSTR_PRIVKEY);
      } catch {
        /* ignore */
      }
      return;
    }
    // Backend healthy but has no key yet — the one case where a key is
    // minted in production. Persist it straight to the backend (never to
    // localStorage) so the identity survives restarts.
    const sk = generateSecretKey();
    const skHex = bytesToHex(sk);
    cachedNostrKeys = { privateKey: sk, privateKeyHex: skHex, publicKey: getPublicKey(sk) };
    try {
      await invoke("set_friends_nostr_privkey", { hex: skHex });
    } catch {
      // Write failed (e.g. transient kv error) — keep the in-memory copy for
      // this session but don't drop a plaintext copy into localStorage.
    }
    return;
  }

  // Frontend-only dev (`npm run dev`, no Tauri shell): the backend doesn't
  // exist, so the legacy localStorage copy is the dev identity store.
  let skHex: string | null = null;
  try {
    skHex = localStorage.getItem(LS_NOSTR_PRIVKEY);
  } catch {
    /* ignore */
  }

  let sk: Uint8Array;
  if (skHex && /^[0-9a-fA-F]{64}$/.test(skHex)) {
    sk = hexToBytes(skHex);
  } else {
    sk = generateSecretKey();
    skHex = bytesToHex(sk);
    try {
      localStorage.setItem(LS_NOSTR_PRIVKEY, skHex);
    } catch {
      /* ignore */
    }
  }

  cachedNostrKeys = { privateKey: sk, privateKeyHex: skHex, publicKey: getPublicKey(sk) };
}

export function getNostrKeys(): NostrKeys {
  if (cachedNostrKeys) return cachedNostrKeys;

  // Defensive fallback when `initNostrKeys` hasn't run or failed to reach
  // the backend. Reads the legacy localStorage copy if one exists (dev
  // mode), but NEVER mints a persisted key from here — a fresh identity
  // created in a degraded session would silently rotate the user's real one.
  let skHex: string | null = null;
  try {
    skHex = localStorage.getItem(LS_NOSTR_PRIVKEY);
  } catch {
    /* ignore */
  }
  if (skHex && /^[0-9a-fA-F]{64}$/.test(skHex)) {
    const sk = hexToBytes(skHex);
    cachedNostrKeys = { privateKey: sk, privateKeyHex: skHex, publicKey: getPublicKey(sk) };
    return cachedNostrKeys;
  }

  // No persisted key reachable (backend failure at boot). Return a
  // session-stable placeholder identity so the UI keeps working, but never
  // persist it — the real key is still on the backend and will win on the
  // next successful boot.
  if (!sessionFallbackKeys) {
    const sk = generateSecretKey();
    const freshHex = bytesToHex(sk);
    sessionFallbackKeys = { privateKey: sk, privateKeyHex: freshHex, publicKey: getPublicKey(sk) };
  }
  return sessionFallbackKeys;
}

/**
 * True once the persisted/authoritative signing key is loaded. The session
 * fallback in `getNostrKeys` is deliberately NOT considered ready: it is an
 * ephemeral placeholder and nothing derived from it should ever be persisted
 * or published.
 */
export function isNostrIdentityReady(): boolean {
  return cachedNostrKeys !== null;
}

export interface UserProfile {
  name: string;
  avatar: string; // "procedural" or base64 data url
  status: string;
  favoriteGameId?: string;
  favoriteGameName?: string;
  syncId: string; // Our Nostr pubkey — the identity friends sync with
  /** Name of the game the user is currently playing, or undefined when idle. */
  currentlyPlaying?: string;
  /** Free-text bio shown on the profile card. */
  bio?: string;
  /** Player region / country label. */
  region?: string;
  /** Unix seconds of the last time we published our outbox. */
  lastPublished?: number;
  /** Unix seconds of the last moment the user was active (presence heartbeat). */
  lastActive?: number;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
}

/** Quick-pick status presets for the profile editor. */
export const STATUS_PRESETS: { label: string; value: string; emoji: string }[] = [
  { label: "Ready to Play", value: "Ready to Play!", emoji: "🎮" },
  { label: "In Game", value: "In a game", emoji: "🕹️" },
  { label: "Looking for Group", value: "Looking for Group (LFG)", emoji: "🔍" },
  { label: "Away", value: "Away", emoji: "💤" },
  { label: "Busy", value: "Busy — do not disturb", emoji: "⛔" },
  { label: "Offline", value: "Offline", emoji: "⚪" },
];

/** Mutual-consent state of a friend record (see `Friend.consent`). */
export type FriendConsent = "pending" | "accepted";

export interface Friend {
  id: string;
  name: string;
  avatar: string;
  status: string;
  favoriteGame?: string;
  currentlyPlaying?: string;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  addedAt: number;
  syncId: string; // Stored from their friend code
  /** Local-only display override for the friend's name. */
  nickname?: string;
  /** Whether the friend is pinned to the top of the list. */
  pinned?: boolean;
  /** Epoch seconds of the last successful sync with this friend. */
  lastSeen?: number;
  /** Unix seconds of the friend's last activity (presence heartbeat, from their outbox). */
  lastActive?: number;
  /** Locally ignored peers — their outbox is skipped during sync. */
  blocked?: boolean;
  /**
   * Mutual-consent state for v3 sync. A record created from a friend code is
   * `"pending"` until the peer accepts; `undefined` means the record predates
   * consent and is treated as already accepted.
   */
  consent?: FriendConsent;
  /** Epoch ms of the last friend request we sent this peer. */
  requestedAt?: number;
  /** Epoch ms the peer asked to be added (inbound invite). */
  incomingRequestAt?: number;
  /** Epoch ms mutual consent was established. */
  acceptedAt?: number;
  /** Friend's free-text bio (synced from their outbox). */
  bio?: string;
  /** Friend's region label (synced from their outbox). */
  region?: string;
  /** Per-game stats shared by the friend for truthful library comparison. */
  games?: SharedGameStat[];
  /** Local-only circle ids this friend belongs to (never synced). */
  groups?: string[];
}

/** Returns the display name, preferring a local nickname override. */
export function displayName(friend: Friend): string {
  return friend.nickname?.trim() || friend.name;
}

/**
 * App blacklist for friend surfaces. Wallpaper Engine is an always-running
 * desktop app that peers' presence and shared libraries frequently include;
 * it is never a real game and just clutters the friends tab, so it is hidden
 * everywhere a friend's "now playing" or game list is rendered.
 */
export function isAppBlacklisted(name?: string, id?: string | number): boolean {
  if (id != null && String(id) === "431960") return true;
  const lower = (name || "").toLowerCase();
  return lower.includes("wallpaper engine");
}

/** Returns `undefined` for a blacklisted "now playing" value, otherwise the value. */
export function safeCurrentlyPlaying(value?: string): string | undefined {
  return value && !isAppBlacklisted(value) ? value : undefined;
}

export type RsvpStatus = "going" | "maybe" | "declined";

/** How often a session repeats. */
export type SessionRecurrenceFrequency = "daily" | "weekly" | "monthly";

/** Recurrence rule on a session template. `until` is an optional YYYY-MM-DD end date (inclusive). */
export interface SessionRecurrence {
  frequency: SessionRecurrenceFrequency;
  until?: string;
}

/** One proposed time slot in a scheduling poll. `label` is a datetime-local string. */
export interface SessionPollOption {
  id: string;
  label: string;
}

/**
 * A scheduling poll on a session that has no fixed time yet: the host
 * proposes slots and attendees vote. `votes` maps option id -> voter names.
 */
export interface SessionPoll {
  options: SessionPollOption[];
  votes: Record<string, string[]>;
}

/** Roles a participant can hold in a session. */
export type SessionRole = "host" | "cohost" | "player";

/** A participant can be a friend (named) or a +1 guest (no friend record). */
export interface SessionParticipant {
  /** Display name. For friends this matches their profile name. */
  name: string;
  /** Role in the session. */
  role: SessionRole;
  /** Free-text "what I'm bringing" note attached to the RSVP. */
  note?: string;
  /** IANA timezone used to display this attendee's local time, if known. */
  timezone?: string;
  /** True for non-friend +1 guests. */
  guest?: boolean;
}

/** An image (or future file type) attached to a DM message, stored as a compressed data URL so it travels inside the encrypted chat envelope. */
export interface DmAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface SessionMessage {
  id: string;
  author: string;
  text: string;
  timestamp: number;
  /** Pinned messages show at the top of the chat thread. */
  pinned?: boolean;
  /** Per-author emoji reactions (author name -> emoji). */
  reactions?: Record<string, string>;
  /** Images attached to this message. */
  attachments?: DmAttachment[];
  /**
   * Tombstone for a locally deleted message. Kept instead of removing the
   * message so a merge with the peer's copy cannot resurrect it.
   */
  deleted?: boolean;
  /**
   * Epoch ms this message was accepted by a relay (outbound only). Unset
   * means it still sits in the sync engine's outbox.
   */
  deliveredAt?: number;
}

/** Messages that should be rendered / counted (tombstones excluded). */
export function visibleMessages(messages?: SessionMessage[]): SessionMessage[] {
  return (messages || []).filter((m) => !m.deleted);
}

export interface GameSession {
  id: string;
  gameId: string;
  gameName: string;
  scheduledAt: string; // YYYY-MM-DDTHH:mm format (creator's local time)
  maxPlayers: number;
  description: string;
  creatorName: string;
  attendees: string[]; // names of people attending ("going")
  /** Per-name RSVP status map (extends beyond `attendees`). */
  rsvps?: Record<string, RsvpStatus>;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion

  /** IANA timezone of the creator when the session was scheduled. */
  creatorTimezone?: string;
  /** Explicit invitee list (names). Empty = broadcast to all friends. */
  invited?: string[];
  /** Rich participant metadata (roles, notes, guest flag, tz). */
  participants?: SessionParticipant[];
  /** Shared session chat / pinned messages. */
  messages?: SessionMessage[];
  /** Duration in minutes, for countdown + agenda display. */
  durationMin?: number;
  /** Recurrence rule — the stored `scheduledAt` is the first occurrence. */
  recurrence?: SessionRecurrence;
  /** Open scheduling poll (no fixed time until the host finalizes one). */
  poll?: SessionPoll;
}

export interface RecommendationComment {
  id: string;
  authorName: string;
  text: string;
  timestamp: number;
}

export type ReactionKind = "like" | "love" | "play";

export interface GameRecommendation {
  id: string;
  gameId: string;
  gameName: string;
  /** Optional cover art url captured at creation, for richer cards. */
  coverUrl?: string;
  /** Optional store slug (IGDB) captured at creation, for store-page navigation. */
  slug?: string;
  recommendedBy: string; // Name of recommender
  recommendedTo: string; // Name of friend, or "All Friends"
  reason: string;
  rating: number; // 1 to 5 stars
  comments: RecommendationComment[];
  /** Per-author reaction map (authorName -> reaction kind). */
  reactions?: Record<string, ReactionKind>;
  /** True when the current user wants to try this game (personal backlog). */
  wantToPlay?: boolean;
  createdAt: number;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion
}

/** Lightweight per-game stat shared with friends so they can compare libraries truthfully. */
export interface SharedGameStat {
  id: string;
  name: string;
  playTimeMin: number;
  achievementPercent: number;
  genres: string[];
}

/**
 * A "Game Suggestion" — a game the user shares from their personal Wishlist
 * tab with friends, optionally with a note about why it's worth playing.
 * Friends can react (emoji-style) and leave threaded comments, mirroring the
 * Recommendation feed but rooted in the user's own wishlist.
 */
export interface SuggestionComment {
  id: string;
  authorName: string;
  text: string;
  timestamp: number;
}

export type SuggestionReactionKind = "like" | "love" | "interest" | "played";

export interface GameSuggestion {
  id: string;
  /** Wishlist entry slug/IGDB id used as the source of truth. */
  gameId: string;
  gameName: string;
  /** Optional cover art url pulled from the wishlist entry, for richer cards. */
  coverUrl?: string;
  /** Optional store slug (IGDB) pulled from the wishlist entry, for store-page navigation. */
  slug?: string;
  /** Free-text note explaining why the game was shared. */
  note: string;
  /** Person who shared it from their wishlist. */
  suggestedBy: string;
  /** Target friend name, or "All Friends" for a broadcast. */
  suggestedTo: string;
  comments: SuggestionComment[];
  /** Per-author reaction map (authorName -> reaction kind). */
  reactions?: Record<string, SuggestionReactionKind>;
  /** True when the current viewer has added this game to their own wishlist. */
  addedToWishlist?: boolean;
  createdAt: number;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion
}

// Keys namespaced per active profile name (A, B, C)
const LS_PROFILE_PREFIX = "gamelib.friends.profile.";
const LS_FRIENDS_PREFIX = "gamelib.friends.list.";
const LS_SESSIONS_PREFIX = "gamelib.friends.sessions.";
const LS_RECOMMENDATIONS_PREFIX = "gamelib.friends.recommendations.";
const LS_SUGGESTIONS_PREFIX = "gamelib.friends.suggestions.";
const LS_CIRCLES_PREFIX = "gamelib.friends.circles.";
const LS_DMS_PREFIX = "gamelib.friends.dms.";

// ── Friend circles (local-only organization) ─────────────────────────

/**
 * A named circle/group used to organize friends locally (e.g. "Co-op
 * squad", "Competitive"). Circles are purely organizational — they are
 * stored per-profile and never shared with friends.
 */
export interface FriendCircle {
  id: string;
  name: string;
  /** Optional accent color used for the chip/badge dot. */
  color?: string;
}

export function loadCircles(): FriendCircle[] {
  const profileName = getActiveProfileName();
  return readJson<FriendCircle[]>(`${LS_CIRCLES_PREFIX}${profileName}`, []);
}

export function saveCircles(circles: FriendCircle[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_CIRCLES_PREFIX}${profileName}`, circles);
}

// ── 1:1 DM threads (synced as encrypted chat envelopes) ──

/**
 * A private direct-message thread between exactly two profiles. Threads live
 * in local storage and travel to the peer as end-to-end encrypted chat
 * envelopes — never inside a library snapshot.
 */
export interface DmThread {
  id: string;
  /** Exactly two profile names (stable display names, oldest first). */
  participants: string[];
  messages: SessionMessage[];
  updatedAt: number;
  deleted?: boolean;
  /** Per-participant timestamp of the last message they read — doubles as the read-receipt signal. */
  lastReadAt?: Record<string, number>;
  /** Highest read position we have successfully pushed to the peer. */
  readSentUpTo?: number;
}

/** Deterministic thread id for a pair of names (order-independent). */
export function dmThreadId(a: string, b: string): string {
  return `dm_${[a.trim(), b.trim()].sort().join("_")}`;
}

/**
 * Thread id for a brand-new conversation. Differs from `dmThreadId` on purpose:
 * a deleted thread leaves a tombstone under the deterministic id, and reusing
 * it would keep the new conversation invisible for us.
 */
export function newDmThreadId(a: string, b: string): string {
  return `${dmThreadId(a, b)}_${Date.now().toString(36)}`;
}

/**
 * Id to open a conversation with when none is live: the deterministic id both
 * sides converge on, unless that id is a deleted tombstone — then a fresh id so
 * the new thread is visible without resurrecting the old one.
 */
export function startDmThreadId(a: string, b: string, threads: DmThread[] = []): string {
  const base = dmThreadId(a, b);
  return threads.some((t) => t.id === base && t.deleted) ? newDmThreadId(a, b) : base;
}

export function loadDms(): DmThread[] {
  const profileName = getActiveProfileName();
  return readJson<DmThread[]>(`${LS_DMS_PREFIX}${profileName}`, []);
}

export function saveDms(threads: DmThread[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_DMS_PREFIX}${profileName}`, threads);
}

/**
 * Merge DM threads from a remote database with local ones. A thread is
 * only adopted when the local profile name is one of its two
 * participants; messages merge id-by-id with the newer timestamp winning.
 */
export function mergeDms(local: DmThread[], remote: DmThread[], myName: string): DmThread[] {
  const mergedMap = new Map<string, DmThread>();
  local.forEach((t) => mergedMap.set(t.id, t));

  for (const remoteThread of remote || []) {
    // Tombstones only apply to threads we actually take part in — an outbox
    // received from a third party must never delete our private thread.
    if (!remoteThread.participants || !remoteThread.participants.includes(myName)) continue;

    if (remoteThread.deleted) {
      const existing = mergedMap.get(remoteThread.id);
      if (existing) {
        mergedMap.set(remoteThread.id, { ...existing, deleted: true, updatedAt: Math.max(existing.updatedAt, remoteThread.updatedAt) });
      }
      continue;
    }

    const localThread = mergedMap.get(remoteThread.id);
    if (!localThread) {
      mergedMap.set(remoteThread.id, remoteThread);
      continue;
    }

    // Messages merge id-by-id with the newer timestamp winning, but reactions
    // union per-author so a react on an older copy of a message isn't lost.
    // Deletion is a tombstone that unions too, otherwise the peer's undeleted
    // copy would resurrect a message we removed.
    const msgMap = new Map<string, SessionMessage>();
    [...(localThread.messages || []), ...(remoteThread.messages || [])].forEach((m) => {
      const existing = msgMap.get(m.id);
      if (!existing) {
        msgMap.set(m.id, m);
      } else {
        const newer = m.timestamp >= existing.timestamp ? m : existing;
        msgMap.set(m.id, {
          ...newer,
          deleted: !!(existing.deleted || m.deleted),
          reactions: { ...(existing.reactions || {}), ...(m.reactions || {}) },
        });
      }
    });

    // Read state merges per-name with the freshest timestamp winning.
    const lastReadAt: Record<string, number> = { ...(localThread.lastReadAt || {}) };
    if (remoteThread.lastReadAt) {
      for (const [name, ts] of Object.entries(remoteThread.lastReadAt)) {
        if (!lastReadAt[name] || ts > lastReadAt[name]) lastReadAt[name] = ts;
      }
    }

    mergedMap.set(remoteThread.id, {
      ...localThread,
      participants: localThread.participants,
      messages: Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp),
      lastReadAt: Object.keys(lastReadAt).length > 0 ? lastReadAt : undefined,
      updatedAt: Math.max(localThread.updatedAt, remoteThread.updatedAt),
    });
  }

  return Array.from(mergedMap.values());
}

// ── Per-tab unseen counters (notification badges) ────────────────────

const LS_UNSEEN_TABS = "gamelib.friends.unseen_tabs";

export type UnseenTabKey = "sessions" | "recs" | "suggestions" | "activity" | "dms";

function readUnseenTabs(): Record<UnseenTabKey, number> {
  try {
    const raw = localStorage.getItem(LS_UNSEEN_TABS);
    if (!raw) return { sessions: 0, recs: 0, suggestions: 0, activity: 0, dms: 0 };
    const parsed = JSON.parse(raw) as Partial<Record<UnseenTabKey, number>>;
    return {
      sessions: Math.max(0, Math.floor(parsed.sessions || 0)),
      recs: Math.max(0, Math.floor(parsed.recs || 0)),
      suggestions: Math.max(0, Math.floor(parsed.suggestions || 0)),
      activity: Math.max(0, Math.floor(parsed.activity || 0)),
      dms: Math.max(0, Math.floor(parsed.dms || 0)),
    };
  } catch {
    return { sessions: 0, recs: 0, suggestions: 0, activity: 0, dms: 0 };
  }
}

function writeUnseenTabs(counts: Record<UnseenTabKey, number>): void {
  try {
    localStorage.setItem(LS_UNSEEN_TABS, JSON.stringify(counts));
  } catch {
    /* ignore */
  }
}

/** Read the unseen badge count for one tab. */
export function getUnseenTabItems(key: UnseenTabKey): number {
  return readUnseenTabs()[key] || 0;
}

/** Add `delta` new unseen items to a tab's badge. */
export function addUnseenTabItems(key: UnseenTabKey, delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  const counts = readUnseenTabs();
  counts[key] = counts[key] + Math.floor(delta);
  writeUnseenTabs(counts);
}

/** Reset a tab's unseen badge to zero (called when the tab is opened). */
export function clearUnseenTabItems(key: UnseenTabKey): void {
  const counts = readUnseenTabs();
  if (counts[key] === 0) return;
  counts[key] = 0;
  writeUnseenTabs(counts);
}

/** Reset every tab badge at once. */
export function clearAllUnseenTabItems(): void {
  writeUnseenTabs({ sessions: 0, recs: 0, suggestions: 0, activity: 0, dms: 0 });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage errors */
  }
}

// Window-isolated profile helper using sessionStorage
export function getActiveProfileName(): string {
  try {
    return sessionStorage.getItem("gamelib.friends.activeProfile") || "A";
  } catch {
    return "A";
  }
}

export function setActiveProfileName(name: string): void {
  try {
    sessionStorage.setItem("gamelib.friends.activeProfile", name);
  } catch {
    /* ignore */
  }
}

export function loadUserProfile(): UserProfile {
  const profileName = getActiveProfileName();
  const profile = readJson<Partial<UserProfile>>(`${LS_PROFILE_PREFIX}${profileName}`, {});
  
  // Fill in default values
  const name = profile.name || `Gamer ${profileName}`;
  const avatar = profile.avatar || "procedural";
  const status = profile.status || "Ready to Play!";
  const favoriteGameId = profile.favoriteGameId || "";
  const favoriteGameName = profile.favoriteGameName || "";
  const currentlyPlaying = profile.currentlyPlaying || undefined;
  const bio = profile.bio || "";
  const region = profile.region || "";

  // Nostr public key is our syncId — but only once the authoritative key is
  // loaded. While the identity is unresolved we return the STORED syncId
  // (possibly empty) rather than the ephemeral session placeholder, so no
  // caller can put a placeholder pubkey into React state / a friend code and
  // later persist it. `getNostrKeys` is deliberately not called while
  // unresolved: that would mint the session fallback as a side effect.
  const storedSyncId = profile.syncId || "";
  const syncId = isNostrIdentityReady() ? getNostrKeys().publicKey : storedSyncId;

  const updated: UserProfile = {
    name,
    avatar,
    status,
    favoriteGameId,
    favoriteGameName,
    syncId,
    currentlyPlaying,
    bio,
    region,
  };
  // Presence + shared stats must survive this normalizer: every
  // `persistLocalStorageToDisk` round-trip rewrites the profile through it, so
  // dropping these fields silently reset the presence heartbeat on restart.
  if (profile.lastActive !== undefined) updated.lastActive = profile.lastActive;
  if (profile.lastPublished !== undefined) updated.lastPublished = profile.lastPublished;
  if (profile.libStats) updated.libStats = profile.libStats;
  // Persist the resolved identity as soon as the backend key is loaded —
  // that is when the real pubkey replaces the stored/empty placeholder.
  if (isNostrIdentityReady() && (!profile.syncId || profile.syncId !== syncId)) {
    writeJson(`${LS_PROFILE_PREFIX}${profileName}`, updated);
  }
  return updated;
}

/**
 * Reads the cached legacy device id. Identity is the Nostr keypair now; this
 * only remains so old payloads carrying a device id can be recognised.
 */
let cachedDeviceId: string | null = null;
export function getDeviceId(): string | null {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const v = localStorage.getItem("gamelib.friends.deviceId");
    if (v) {
      cachedDeviceId = v;
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setDeviceId(id: string): void {
  cachedDeviceId = id;
  try {
    localStorage.setItem("gamelib.friends.deviceId", id);
  } catch {
    /* ignore */
  }
}

// ── Disk mirror of the local collections ─────────────────────────────

export interface FriendsDatabase {
  profile: UserProfile | null;
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  dms: DmThread[];
}

export async function loadFriendsDb(): Promise<FriendsDatabase> {
  try {
    const raw = await invoke<string>("load_friends_db");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load friends database:", err);
    return { profile: null, friends: [], sessions: [], recommendations: [], suggestions: [], dms: [] };
  }
}

export async function saveFriendsDb(db: FriendsDatabase): Promise<void> {
  try {
    await invoke("save_friends_db", { content: JSON.stringify(db) });
  } catch (err) {
    console.error("Failed to save friends database:", err);
  }
}

// ── Local-change notifications ───────────────────────────────────────
//
// Every mutation that reaches disk funnels through
// `persistLocalStorageToDisk`, so that is the single place that tells the
// always-on friends sync engine "something changed, republish". Kept here
// (not in the engine) so the storage layer stays free of sync imports.

const friendsDbChangeSubscribers = new Set<() => void>();

/** Subscribe to local friends-database mutations. Returns an unsubscribe. */
export function subscribeFriendsDbChange(cb: () => void): () => void {
  friendsDbChangeSubscribers.add(cb);
  return () => {
    friendsDbChangeSubscribers.delete(cb);
  };
}

/** Fan out a local-change notification. A broken subscriber is ignored. */
export function notifyFriendsDbChange(): void {
  friendsDbChangeSubscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      /* a broken subscriber must not break the write path */
    }
  });
}

export async function persistLocalStorageToDisk(): Promise<void> {
  // Announced before the write so a listener that reacts by reading storage
  // already sees the new values (the save* helpers write first).
  notifyFriendsDbChange();
  const profile = loadUserProfile();
  const friends = loadFriends();
  const sessions = loadSessions();
  const recommendations = loadRecommendations();
  const suggestions = loadSuggestions();
  const dms = loadDms();
  await saveFriendsDb({ profile, friends, sessions, recommendations, suggestions, dms });
}

/**
 * Writes every profile-namespaced collection in one pass WITHOUT persisting.
 * Callers that merge a whole remote database use this plus a single
 * `persistLocalStorageToDisk()` instead of one disk write per collection.
 */
export function writeFriendsCollections(db: Partial<FriendsDatabase>): void {
  const profileName = getActiveProfileName();
  if (db.profile) writeJson(`${LS_PROFILE_PREFIX}${profileName}`, db.profile);
  if (db.friends) writeJson(`${LS_FRIENDS_PREFIX}${profileName}`, db.friends);
  if (db.sessions) writeJson(`${LS_SESSIONS_PREFIX}${profileName}`, db.sessions);
  if (db.recommendations) {
    writeJson(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, db.recommendations);
  }
  if (db.suggestions) {
    writeJson(`${LS_SUGGESTIONS_PREFIX}${profileName}`, db.suggestions);
  }
  if (db.dms) writeJson(`${LS_DMS_PREFIX}${profileName}`, db.dms);
}

export async function loadFriendsDbToLocalStorage(): Promise<boolean> {
  try {
    const db = await loadFriendsDb();
    const profileName = getActiveProfileName();
    if (db.profile) {
      writeJson(`${LS_PROFILE_PREFIX}${profileName}`, db.profile);
    }
    if (db.friends) {
      writeJson(`${LS_FRIENDS_PREFIX}${profileName}`, db.friends);
    }
    if (db.sessions) {
      writeJson(`${LS_SESSIONS_PREFIX}${profileName}`, db.sessions);
    }
    if (db.recommendations) {
      writeJson(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, db.recommendations);
    }
    if (db.suggestions) {
      writeJson(`${LS_SUGGESTIONS_PREFIX}${profileName}`, db.suggestions);
    }
    if (db.dms) {
      writeJson(`${LS_DMS_PREFIX}${profileName}`, db.dms);
    }
    return true;
  } catch (err) {
    console.error("Failed to load friends DB to localStorage:", err);
    return false;
  }
}

export function saveUserProfile(profile: UserProfile): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_PROFILE_PREFIX}${profileName}`, profile);
  persistLocalStorageToDisk();
}

export function loadFriends(): Friend[] {
  const profileName = getActiveProfileName();
  return readJson<Friend[]>(`${LS_FRIENDS_PREFIX}${profileName}`, []);
}

export function saveFriends(friends: Friend[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_FRIENDS_PREFIX}${profileName}`, friends);
  persistLocalStorageToDisk();
}

export function loadSessions(): GameSession[] {
  const profileName = getActiveProfileName();
  return readJson<GameSession[]>(`${LS_SESSIONS_PREFIX}${profileName}`, []);
}

export function saveSessions(sessions: GameSession[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_SESSIONS_PREFIX}${profileName}`, sessions);
  persistLocalStorageToDisk();
}

export function loadRecommendations(): GameRecommendation[] {
  const profileName = getActiveProfileName();
  return readJson<GameRecommendation[]>(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, []).map((rec) => ({
    ...rec,
    comments: rec.comments ?? [],
    reactions: rec.reactions ?? {},
  }));
}

export function saveRecommendations(recs: GameRecommendation[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, recs);
  persistLocalStorageToDisk();
}

export function loadSuggestions(): GameSuggestion[] {
  const profileName = getActiveProfileName();
  return readJson<GameSuggestion[]>(`${LS_SUGGESTIONS_PREFIX}${profileName}`, []).map((sug) => ({
    ...sug,
    comments: sug.comments ?? [],
    reactions: sug.reactions ?? {},
  }));
}

export function saveSuggestions(suggestions: GameSuggestion[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_SUGGESTIONS_PREFIX}${profileName}`, suggestions);
  persistLocalStorageToDisk();
}

export function saveDmsAndPersist(threads: DmThread[]): void {
  saveDms(threads);
  persistLocalStorageToDisk();
}

/** localStorage key the Settings page writes for the read-receipt toggle. */
const LS_DM_READ_RECEIPTS = "gamelib.friends.read_receipts_enabled";

/**
 * Whether read receipts may leave the device.
 *
 * The toggle lives in `SettingsContext` (localStorage-backed); the sync layer
 * reads it from here so the engine's replay path cannot send a receipt the
 * user switched off.
 */
export function areDmReadReceiptsEnabled(): boolean {
  try {
    return localStorage.getItem(LS_DM_READ_RECEIPTS) === "true";
  } catch {
    return false;
  }
}

/**
 * Procedural avatar gradient generator based on string hashing.
 */
export function getProceduralAvatarStyle(name: string): { background: string; color: string } {
  const cleanName = name.trim() || "User";
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 130) % 360;
  
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 70%, 42%), hsl(${hue2}, 75%, 32%))`,
    color: "#ffffff",
  };
}

/**
 * Returns initials (1 or 2 characters) for any username.
 */
export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "GG";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Encodes a user's profile and dynamic statistics into a shareable Base64 friend code.
 */
export function encodeFriendCode(
  profile: UserProfile,
  _stats?: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
  _favoriteGameName?: string
): string {
  return profile.syncId;
}

/**
 * Decodes a shareable friend code back into a preview record.
 *
 * Only the pubkey is real: a code carries no profile, so the preview shows
 * the shortened key and leaves the profile fields empty until the peer
 * answers the friend request (the sync engine fills them in then).
 */
export function decodeFriendCode(code: string): Friend | null {
  const pubkey = decodeFriendCodePubkey(code);
  if (!pubkey) return null;
  return {
    id: `friend_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: shortFriendCodeLabel(pubkey),
    avatar: "procedural",
    status: "",
    addedAt: Date.now(),
    syncId: pubkey,
  };
}

/** Short, human-readable stand-in for a pubkey we have no profile for. */
export function shortFriendCodeLabel(pubkey: string): string {
  const value = pubkey.trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/**
 * Hex pubkey behind a friend code: bare hex, an `npub`, or a legacy
 * `GMLF-` payload that wraps either. Legacy folder-sync codes carrying a
 * device id resolve to null — a device id has nothing to reach on a relay.
 */
export function decodeFriendCodePubkey(code: string): string | null {
  try {
    const trimmed = typeof code === "string" ? code.trim() : "";
    if (!trimmed) return null;

    let candidate = trimmed;
    if (candidate.startsWith("GMLF-")) {
      const payload = candidate.slice("GMLF-".length).trim();
      if (payload.startsWith("device_")) return null;
      const decoded = decodeLegacyGmlfPayload(payload);
      if (!decoded) return null;
      candidate = decoded;
    }

    if (candidate.startsWith("device_")) return null;

    const lowered = candidate.toLowerCase();
    if (/^[0-9a-f]{64}$/.test(lowered)) return lowered;

    if (lowered.startsWith("npub1")) {
      try {
        const decoded = nip19Decode(lowered);
        if (decoded.type === "npub") {
          const pubkey = String(decoded.data).toLowerCase();
          if (/^[0-9a-f]{64}$/.test(pubkey)) return pubkey;
        }
      } catch {
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Pulls the legacy `sy` sync id out of a `GMLF-` base64 payload. */
function decodeLegacyGmlfPayload(payload: string): string | null {
  try {
    const binary = atob(payload);
    let jsonText: string;
    try {
      jsonText = decodeURIComponent(
        Array.prototype.map
          .call(binary, (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
    } catch {
      jsonText = binary;
    }
    const parsed = JSON.parse(jsonText) as { sy?: unknown };
    if (parsed && typeof parsed.sy === "string" && parsed.sy.trim()) {
      return parsed.sy.trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ── P2P CRDT Merge Logic ──────────────────────────────────────────

/**
 * Merge local sessions with remote friend sessions.
 * Keep the latest version of sessions, combine attendees, and respect deletion tombstones.
 */
export function mergeSessions(local: GameSession[], remote: GameSession[]): GameSession[] {
  const mergedMap = new Map<string, GameSession>();
  
  local.forEach((s) => mergedMap.set(s.id, s));
  
  remote.forEach((remoteSession) => {
    const localSession = mergedMap.get(remoteSession.id);
    if (!localSession) {
      mergedMap.set(remoteSession.id, remoteSession);
    } else {
      const keepRemote = remoteSession.updatedAt > localSession.updatedAt;
      
      const creatorName = keepRemote ? remoteSession.creatorName : localSession.creatorName;
      const gameId = keepRemote ? remoteSession.gameId : localSession.gameId;
      const gameName = keepRemote ? remoteSession.gameName : localSession.gameName;
      const scheduledAt = keepRemote ? remoteSession.scheduledAt : localSession.scheduledAt;
      const maxPlayers = keepRemote ? remoteSession.maxPlayers : localSession.maxPlayers;
      const description = keepRemote ? remoteSession.description : localSession.description;
      const deleted = localSession.deleted || remoteSession.deleted || false;
      const updatedAt = Math.max(localSession.updatedAt, remoteSession.updatedAt);

      // Merge RSVP maps key-by-key; remote wins per key when its session is newer.
      const rsvpMap: Record<string, RsvpStatus> = { ...(localSession.rsvps || {}) };
      if (remoteSession.rsvps) {
        for (const [name, status] of Object.entries(remoteSession.rsvps)) {
          if (keepRemote || rsvpMap[name] === undefined) {
            rsvpMap[name] = status;
          }
        }
      }
      // Attendees list should reflect "going" RSVPs for backward compatibility.
      const attendees =
        keepRemote
          ? Array.from(new Set([...(remoteSession.attendees ?? []), ...Object.keys(rsvpMap).filter((n) => rsvpMap[n] === "going")]))
          : Array.from(new Set([...(localSession.attendees ?? []), ...Object.keys(rsvpMap).filter((n) => rsvpMap[n] === "going")]));

      // Merge the rich participant metadata (roles, notes, guest flag, tz).
      const participantsMap = new Map<string, SessionParticipant>();
      (keepRemote ? remoteSession.participants || [] : localSession.participants || []).forEach((p) =>
        participantsMap.set(p.name, { ...p })
      );
      (keepRemote ? localSession.participants || [] : remoteSession.participants || []).forEach((p) => {
        if (!participantsMap.has(p.name)) participantsMap.set(p.name, { ...p });
      });

      // Merge the chat thread; remote message wins on timestamp tie-break, but
      // deletion tombstones and reactions union so neither side resurrects a
      // removed message or drops a reaction.
      const messagesMap = new Map<string, SessionMessage>();
      [...(localSession.messages || []), ...(remoteSession.messages || [])].forEach((m) => {
        const existing = messagesMap.get(m.id);
        if (!existing) {
          messagesMap.set(m.id, m);
          return;
        }
        const newer = m.timestamp >= existing.timestamp ? m : existing;
        messagesMap.set(m.id, {
          ...newer,
          deleted: !!(existing.deleted || m.deleted),
          reactions: { ...(existing.reactions || {}), ...(m.reactions || {}) },
        });
      });
      const messages = Array.from(messagesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      const invited = keepRemote
        ? remoteSession.invited || localSession.invited || []
        : Array.from(new Set([...(localSession.invited || []), ...(remoteSession.invited || [])]));

      // Poll votes union per option; the fresher side owns the option list.
      let poll = remoteSession.poll || localSession.poll;
      if (remoteSession.poll && localSession.poll) {
        const base = keepRemote ? remoteSession.poll : localSession.poll;
        const other = keepRemote ? localSession.poll : remoteSession.poll;
        const votes: Record<string, string[]> = {};
        const baseVotes = base.votes ?? {};
        const otherVotes = other.votes ?? {};
        (base.options ?? []).forEach((o) => (votes[o.id] = [...(baseVotes[o.id] || [])]));
        (other.options ?? []).forEach((o) => {
          const voters = new Set(votes[o.id] || []);
          (otherVotes[o.id] || []).forEach((v) => voters.add(v));
          votes[o.id] = Array.from(voters);
        });
        poll = { options: base.options ?? other.options ?? [], votes };
      }

      mergedMap.set(remoteSession.id, {
        id: localSession.id,
        gameId,
        gameName,
        scheduledAt,
        maxPlayers,
        description,
        creatorName,
        attendees,
        rsvps: rsvpMap,
        updatedAt,
        deleted,
        creatorTimezone: remoteSession.creatorTimezone || localSession.creatorTimezone,
        invited,
        participants: Array.from(participantsMap.values()),
        messages,
        durationMin: remoteSession.durationMin ?? localSession.durationMin,
        poll: poll && poll.options && poll.options.length > 0 ? poll : undefined,
        recurrence: keepRemote ? remoteSession.recurrence ?? localSession.recurrence : localSession.recurrence ?? remoteSession.recurrence,
      });
    }
  });

  return Array.from(mergedMap.values());
}

export function mergeRecommendations(local: GameRecommendation[], remote: GameRecommendation[]): GameRecommendation[] {
  const mergedMap = new Map<string, GameRecommendation>();
  
  local.forEach((r) => mergedMap.set(r.id, { ...r, comments: r.comments ?? [], reactions: r.reactions ?? {} }));
  
  remote.forEach((remoteRec) => {
    const localRec = mergedMap.get(remoteRec.id);
    if (!localRec) {
      mergedMap.set(remoteRec.id, { ...remoteRec, comments: remoteRec.comments ?? [], reactions: remoteRec.reactions ?? {} });
    } else {
      const keepRemote = remoteRec.updatedAt > localRec.updatedAt;
      
      const gameId = keepRemote ? remoteRec.gameId : localRec.gameId;
      const gameName = keepRemote ? remoteRec.gameName : localRec.gameName;
      const coverUrl = keepRemote ? remoteRec.coverUrl ?? localRec.coverUrl : localRec.coverUrl ?? remoteRec.coverUrl;
      const slug = keepRemote ? remoteRec.slug ?? localRec.slug : localRec.slug ?? remoteRec.slug;
      const recommendedBy = keepRemote ? remoteRec.recommendedBy : localRec.recommendedBy;
      const recommendedTo = keepRemote ? remoteRec.recommendedTo : localRec.recommendedTo;
      const reason = keepRemote ? remoteRec.reason : localRec.reason;
      const rating = keepRemote ? remoteRec.rating : localRec.rating;
      const deleted = localRec.deleted || remoteRec.deleted || false;
      const createdAt = Math.min(localRec.createdAt, remoteRec.createdAt);
      const updatedAt = Math.max(localRec.updatedAt, remoteRec.updatedAt);
 
      // Merge reactions key-by-key: union of author keys, remote wins per key
      // when its rec is newer (and thus more likely authoritative).
      const reactionMap: Record<string, ReactionKind> = { ...(localRec.reactions || {}) };
      if (remoteRec.reactions) {
        for (const [author, kind] of Object.entries(remoteRec.reactions)) {
          if (keepRemote || reactionMap[author] === undefined) {
            reactionMap[author] = kind;
          }
        }
      }
 
      const commentMap = new Map<string, any>();
      (localRec.comments ?? []).forEach((c) => commentMap.set(c.id, c));
      (remoteRec.comments ?? []).forEach((c) => commentMap.set(c.id, c));
 
      const comments = Array.from(commentMap.values()).sort((a, b) => a.timestamp - b.timestamp);
 
      mergedMap.set(remoteRec.id, {
        id: localRec.id,
        gameId,
        gameName,
        coverUrl,
        slug,
        recommendedBy,
        recommendedTo,
        reason,
        rating,
        reactions: reactionMap,
        wantToPlay: keepRemote ? remoteRec.wantToPlay ?? localRec.wantToPlay : localRec.wantToPlay ?? remoteRec.wantToPlay,
        comments,
        createdAt,
        updatedAt,
        deleted,
      });
    }
  });
 
  return Array.from(mergedMap.values());
}

/**
 * Merge local wishlist-derived game suggestions with a friend's. Follows the
 * same "freshest update wins" + tombstone + union-of-reactions/comments rules
 * as `mergeRecommendations`.
 */
export function mergeSuggestions(local: GameSuggestion[], remote: GameSuggestion[]): GameSuggestion[] {
  const mergedMap = new Map<string, GameSuggestion>();

  local.forEach((s) => mergedMap.set(s.id, { ...s, comments: s.comments ?? [], reactions: s.reactions ?? {} }));

  remote.forEach((remoteSug) => {
    const localSug = mergedMap.get(remoteSug.id);
    if (!localSug) {
      mergedMap.set(remoteSug.id, { ...remoteSug, comments: remoteSug.comments ?? [], reactions: remoteSug.reactions ?? {} });
      return;
    }

    const keepRemote = remoteSug.updatedAt > localSug.updatedAt;

    const gameId = keepRemote ? remoteSug.gameId : localSug.gameId;
    const gameName = keepRemote ? remoteSug.gameName : localSug.gameName;
    const coverUrl = keepRemote ? remoteSug.coverUrl ?? localSug.coverUrl : localSug.coverUrl ?? remoteSug.coverUrl;
    const slug = keepRemote ? remoteSug.slug ?? localSug.slug : localSug.slug ?? remoteSug.slug;
    const note = keepRemote ? remoteSug.note : localSug.note;
    const suggestedBy = keepRemote ? remoteSug.suggestedBy : localSug.suggestedBy;
    const suggestedTo = keepRemote ? remoteSug.suggestedTo : localSug.suggestedTo;
    const deleted = localSug.deleted || remoteSug.deleted || false;
    const createdAt = Math.min(localSug.createdAt, remoteSug.createdAt);
    const updatedAt = Math.max(localSug.updatedAt, remoteSug.updatedAt);

    const reactionMap: Record<string, SuggestionReactionKind> = { ...(localSug.reactions || {}) };
    if (remoteSug.reactions) {
      for (const [author, kind] of Object.entries(remoteSug.reactions)) {
        if (keepRemote || reactionMap[author] === undefined) {
          reactionMap[author] = kind;
        }
      }
    }

    const commentMap = new Map<string, SuggestionComment>();
    (localSug.comments ?? []).forEach((c) => commentMap.set(c.id, c));
    (remoteSug.comments ?? []).forEach((c) => commentMap.set(c.id, c));

    const comments = Array.from(commentMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    mergedMap.set(remoteSug.id, {
      id: localSug.id,
      gameId,
      gameName,
      coverUrl,
      slug,
      note,
      suggestedBy,
      suggestedTo,
      reactions: reactionMap,
      addedToWishlist: keepRemote ? remoteSug.addedToWishlist ?? localSug.addedToWishlist : localSug.addedToWishlist ?? remoteSug.addedToWishlist,
      comments,
      createdAt,
      updatedAt,
      deleted,
    });
  });

  return Array.from(mergedMap.values());
}

/** Maximum number of per-game stats shared in a snapshot. */
const MAX_SHARED_GAMES = 1000;

/**
 * Keeps a shared library bounded: most-played games first, capped so a large
 * library doesn't bloat every snapshot.
 */
export function capSharedGames(games: SharedGameStat[] | undefined): SharedGameStat[] {
  if (!games || games.length === 0) return [];
  return games
    .slice()
    .sort((a, b) => b.playTimeMin - a.playTimeMin)
    .slice(0, MAX_SHARED_GAMES);
}

export interface NostrOutboxPayload {
  syncId: string;
  /** Payload schema version. Absent on legacy (pre-scope) events. */
  v?: number;
  /** Sharing scope this payload was reduced to. Absent on legacy events. */
  scope?: "core" | "full";
  profile: {
    name: string;
    avatar: string;
    status: string;
    favoriteGame?: string;
    currentlyPlaying: string;
    bio: string;
    region: string;
    lastActive: number;
    libStats?: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
  };
  friends: string[];
  games?: SharedGameStat[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  updatedAt: number;
}

// ── Nostr sharing scope ──────────────────────────────────────────────
//
// Sync itself is always on: there is no opt-in toggle and no shared folder
// to configure. What the user picks is how much detail a snapshot carries.
// `"core"` (default, labelled "Standard" in the UI) shares the publisher's
// own profile, playtime and posts; `"full"` additionally carries the social
// detail other people contributed. `"off"` is a retired value kept only so a
// stored preference still parses — it behaves like `"core"`.

export type NostrShareScope = "off" | "core" | "full";

const LS_NOSTR_SHARE_SCOPE = "gamelib.friends.nostr_share_scope";
/** Legacy binary opt-in, read once for migration and never written again. */
const LS_NOSTR_PUBLISH_LEGACY = "gamelib.friends.nostr_public_publish";

/**
 * Reads the snapshot sharing scope. Migration: a user who had the legacy
 * opt-in flag set is promoted to `"full"` (their previous behaviour);
 * everyone else — including users who had the legacy flag off — gets
 * `"core"`, so remote friends receive the reduced payload instead of
 * nothing.
 */
export function getNostrShareScope(): NostrShareScope {
  try {
    const stored = localStorage.getItem(LS_NOSTR_SHARE_SCOPE);
    if (stored === "off" || stored === "core" || stored === "full") return stored;
    if (localStorage.getItem(LS_NOSTR_PUBLISH_LEGACY) === "true") return "full";
  } catch {
    /* ignore storage errors */
  }
  return "core";
}

/**
 * Persists the sharing scope and broadcasts a window event so every mounted
 * sync engine can force an immediate republish (the payload just changed).
 */
export function setNostrShareScope(scope: NostrShareScope): void {
  try {
    localStorage.setItem(LS_NOSTR_SHARE_SCOPE, scope);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent("gamelib:nostr-share-scope-changed"));
  } catch {
    /* window unavailable — ignore */
  }
}

/**
 * Applies the sharing-scope privacy boundary to a snapshot payload.
 *
 * `"full"` carries everything, sanitized only for the permanent-PII fields
 * (avatar, DMs). `"core"` — and the retired `"off"`, which must never grant
 * more than the default — still carries the publisher's own library: the
 * capped per-game stats and `libStats` are what the Compare tab and the
 * achievement race are built on. What it strips is content OTHER people
 * authored: session participants / messages / RSVPs / attendees / invited and
 * poll votes, plus recommendation & suggestion comments and reactions.
 *
 * `scope` and `blockedIds` are passed explicitly so this stays a pure
 * function (no ambient localStorage reads). The callers own resolving them.
 *
 * Defense-in-depth for BOTH scopes: DM threads are removed and the avatar is
 * forced to `"procedural"` — a photo (base64 data URL) on an immutable relay
 * event is permanent PII. DMs travel as encrypted chat envelopes, but this
 * also covers unexpected/unknown keys smuggled in by a caller.
 */
export function scopeNostrPayload(
  payload: NostrOutboxPayload,
  scope: NostrShareScope,
  blockedIds?: ReadonlySet<string>
): NostrOutboxPayload {
  const { games, profile, friends, sessions, recommendations, suggestions, ...meta } = payload;
  const blocked = blockedIds ?? new Set<string>();

  const safeMeta: Record<string, unknown> = { ...meta };
  delete safeMeta.dms;
  const safeProfile = { ...profile, avatar: "procedural" };
  const safeFriends = friends.filter((id) => !blocked.has(id));

  // `"off"` is a retired value: it degrades to the reduced payload rather
  // than accidentally granting the full one.
  if (scope === "full") {
    return {
      ...safeMeta,
      profile: safeProfile,
      friends: safeFriends,
      games,
      sessions,
      recommendations,
      suggestions,
    } as NostrOutboxPayload;
  }

  return {
    ...safeMeta,
    profile: {
      name: profile.name,
      status: profile.status,
      favoriteGame: profile.favoriteGame,
      currentlyPlaying: profile.currentlyPlaying,
      bio: profile.bio,
      region: profile.region,
      lastActive: profile.lastActive,
      libStats: profile.libStats,
      avatar: "procedural",
    },
    friends: safeFriends,
    games,
    sessions: sessions.map((session) => {
      const { participants, messages, rsvps, attendees, invited, poll, ...rest } = session;
      return {
        ...rest,
        ...(poll ? { poll: { options: poll.options } } : {}),
      };
    }) as GameSession[],
    recommendations: recommendations.map((rec) => {
      const { comments, reactions, ...rest } = rec;
      return rest;
    }) as GameRecommendation[],
    suggestions: suggestions.map((sug) => {
      const { comments, reactions, ...rest } = sug;
      return rest;
    }) as GameSuggestion[],
  } as NostrOutboxPayload;
}

/**
 * Builds the snapshot payload the sync engine encrypts and sends to a peer.
 * Deliberately EXCLUDES DM threads — those travel as encrypted chat
 * envelopes, never inside a library snapshot. Also excludes a photo avatar
 * (base64 data URL): a picture on an immutable relay event is permanent PII,
 * so the shared payload always uses the procedural avatar. Blocked peers are
 * never included in the shared friend graph.
 */
export function buildNostrOutboxPayload(
  profile: UserProfile,
  stats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
  sessions: GameSession[],
  recs: GameRecommendation[],
  sharedGames?: SharedGameStat[],
  suggestions?: GameSuggestion[]
): NostrOutboxPayload {
  const localFriends = loadFriends();
  return {
    syncId: profile.syncId,
    profile: {
      name: profile.name || "",
      // Photo avatars are personal data and never leave the device —
      // friends see the procedural gradient instead.
      avatar:
        profile.avatar && profile.avatar.startsWith("data:")
          ? "procedural"
          : (profile.avatar || ""),
      status: profile.status || "",
      favoriteGame: profile.favoriteGameName || "",
      currentlyPlaying: profile.currentlyPlaying || "",
      bio: profile.bio || "",
      region: profile.region || "",
      lastActive: profile.lastActive || 0,
      libStats: stats,
    },
    friends: localFriends.filter((f) => !f.blocked).map((f) => f.syncId),
    games: capSharedGames(sharedGames),
    sessions,
    recommendations: recs,
    suggestions: suggestions || [],
    updatedAt: Date.now(),
  };
}

// ── Community tab notification badge ──────────────────────────────
// Counts "new" social items (sessions / recommendations / suggestions)
// pulled from friends during sync that the user hasn't seen yet. Surfaces
// as a number badge on the Community tab in the top navigation and is
// cleared when the user opens that tab.
//
// Implementation lives in ./unseenCommunity (no nostr-tools import) so the
// shell can render the badge without pulling the nostr stack into the
// startup bundle; friendsStorage re-exports it for the friends pages.
export {
  getUnseenCommunityItems,
  addUnseenCommunityItems,
  clearUnseenCommunityItems,
  subscribeUnseenCommunity,
} from "./unseenCommunity";

/**
 * Merges local database with a remote database received from P2P sync.
 */
export function mergeDatabases(local: FriendsDatabase, remote: FriendsDatabase): FriendsDatabase {
  const mergedFriendsMap = new Map<string, Friend>();
  local.friends.forEach((f) => mergedFriendsMap.set(f.syncId, f));
  
  if (remote.friends) {
    remote.friends.forEach((remoteFriend) => {
      // Do not process if it matches the local user's own profile syncId (to prevent own-profile addition)
      if (local.profile && remoteFriend.syncId === local.profile.syncId) {
        return;
      }

      const localFriend = mergedFriendsMap.get(remoteFriend.syncId);
      if (localFriend) {
        // Only update existing friends in our list
        mergedFriendsMap.set(remoteFriend.syncId, {
          ...localFriend,
          name: remoteFriend.name || localFriend.name,
          avatar: remoteFriend.avatar || localFriend.avatar,
          status: remoteFriend.status || localFriend.status,
          favoriteGame: remoteFriend.favoriteGame || localFriend.favoriteGame,
          currentlyPlaying: remoteFriend.currentlyPlaying ?? localFriend.currentlyPlaying,
          bio: remoteFriend.bio || localFriend.bio,
          region: remoteFriend.region || localFriend.region,
          libStats: remoteFriend.libStats || localFriend.libStats,
          games: remoteFriend.games || localFriend.games,
          lastActive: remoteFriend.lastActive || localFriend.lastActive,
        });
      }
    });
  }

  // NOTE: Friends are added manually or approved mutually via invitations.
  // We intentionally do NOT auto-add remote friends we haven't accepted.

  // Update the sender's own friend record from their profile payload (the
  // `friends` list on a snapshot only describes the sender's friends, never
  // the sender themselves). Respect the core/full scope so a privacy-reduced
  // payload can't wipe cached data the sender chose not to share.
  if (remote.profile && remote.profile.syncId) {
    const remoteIsCore =
      (remote as { scope?: string }).scope === "core" ||
      ((remote as { scope?: string }).scope == null && (remote as { v?: number }).v === 2);
    const rf = mergedFriendsMap.get(remote.profile.syncId);
    if (rf) {
      const rp = remote.profile as unknown as Record<string, unknown>;
      const remoteFavoriteGameRaw =
        (rp.favoriteGameName as string | undefined) ?? (rp.favoriteGame as string | undefined);
      const remoteFavoriteGame =
        remoteFavoriteGameRaw ?? (remoteIsCore ? rf.favoriteGame : undefined);
      const remoteBio = (rp.bio as string | undefined) ?? (remoteIsCore ? rf.bio : undefined);
      const remoteRegion = (rp.region as string | undefined) ?? (remoteIsCore ? rf.region : undefined);
      const remoteLibStats =
        (rp.libStats as Friend["libStats"] | undefined) ?? (remoteIsCore ? rf.libStats : undefined);
      const remoteGames = rf.games;
      const remoteCurrentlyPlaying =
        rp.currentlyPlaying === undefined
          ? rf.currentlyPlaying
          : (rp.currentlyPlaying as string | undefined) || undefined;
      const remoteLastActive = (rp.lastActive as number | undefined) || rf.lastActive;
      mergedFriendsMap.set(remote.profile.syncId, {
        ...rf,
        name: (rp.name as string | undefined) || rf.name,
        avatar: (rp.avatar as string | undefined) || rf.avatar,
        status: (rp.status as string | undefined) || rf.status,
        favoriteGame: remoteFavoriteGame || undefined,
        currentlyPlaying: remoteCurrentlyPlaying,
        bio: remoteBio || undefined,
        region: remoteRegion || undefined,
        libStats: remoteLibStats,
        games: remoteGames,
        lastActive: remoteLastActive,
      });
    }
  }

  const mergedFriends = Array.from(mergedFriendsMap.values());
  const mergedSessions = mergeSessions(local.sessions || [], remote.sessions || []);
  const mergedRecommendations = mergeRecommendations(local.recommendations || [], remote.recommendations || []);
  const mergedSuggestions = mergeSuggestions(local.suggestions || [], remote.suggestions || []);
  const mergedDms = mergeDms(local.dms || [], remote.dms || [], local.profile?.name || "");

  return {
    profile: local.profile,
    friends: mergedFriends,
    sessions: mergedSessions,
    recommendations: mergedRecommendations,
    suggestions: mergedSuggestions,
    dms: mergedDms,
  };
}
