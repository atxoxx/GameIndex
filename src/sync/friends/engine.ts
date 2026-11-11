/**
 * Always-on friends sync engine.
 *
 * Owns the network loop only: identity hand-off, the publish queue, the live
 * subscriptions, presence heartbeats and the retry/backoff policy. Every side
 * effect on local data goes through `FriendsSyncAdapter`, and every byte on
 * the wire goes through `RelayPort`, so the whole engine runs against fakes
 * with no network and no Tauri.
 *
 * No React in this file.
 */

import type { NostrEvent } from "nostr-tools/pure";

import {
  FRIENDS_SYNC_VERSION,
  buildChatEvent,
  buildPresenceEvent,
  buildStateEvent,
  isNewerSnapshot,
  isStateDTagForMe,
  nextRev,
  normalizePubkey,
  parseRelayEvent,
  presenceDTagFor,
  stateDTagFor,
} from "./protocol";
import type { RelayPort } from "./relay";
import type {
  ChatAcceptEnvelope,
  ChatEnvelope,
  ChatMessageEnvelope,
  ChatReadEnvelope,
  ChatRequestEnvelope,
  EnvelopeBase,
  PresenceEnvelope,
  SeenMap,
  SharedProfile,
  SnapshotEnvelope,
  SnapshotVersion,
} from "./types";

const STREAM_KIND = 30078;
const CHAT_WRAP_KIND = 1059;

/** Coalesce a burst of local mutations into one snapshot publish. */
const PUBLISH_DEBOUNCE_MS = 1500;
/** Never publish two snapshots closer together than this. */
const MIN_PUBLISH_GAP_MS = 5000;
/** Per-peer retry schedule after every relay refused the event. */
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const PRESENCE_HEARTBEAT_MS = 60_000;
const INBOX_POLL_MS = 5 * 60_000;
const RESUBSCRIBE_MIN_MS = 1000;
const RESUBSCRIBE_MAX_MS = 60_000;
/** Chat is replayed for this far back on start so offline messages land. */
const CHAT_BACKFILL_SECONDS = 24 * 60 * 60;
/**
 * How often an unanswered friend request is re-published. A request sent while
 * the peer was offline would otherwise be lost for good, so it is replayed on
 * start and then on this interval until the peer accepts (or is removed or
 * blocked).
 */
const REQUEST_REPLAY_MS = 10 * 60_000;
/** Upper bound on remembered event ids (duplicate suppression). */
const SEEN_EVENT_LIMIT = 1024;

type Timer = ReturnType<typeof setTimeout>;

export type FriendsSyncPhase =
  | "idle"
  | "connecting"
  | "online"
  | "degraded"
  | "offline";

export type RelayHealth = "accepted" | "failed";

export type PeerPresence = {
  status: string;
  currentlyPlaying: string | null;
  lastActive: number;
};

export type PeerSyncState = {
  /** Revision of the last snapshot we applied from this peer. */
  lastStateRev: number | null;
  /** When we last heard anything from them (ms). */
  lastSeenAt: number | null;
  /** The revision of OUR state that their presence envelope reports. */
  seenByPeer: number | null;
  /**
   * The revision of OUR last snapshot successfully published to them, so the
   * UI can tell "sent" (lastPublishedRev set) from "seen" (seenByPeer caught
   * up to it). Null until we have published anything they accepted.
   */
  lastPublishedRev: number | null;
  presence: PeerPresence | null;
};

export type FriendsSyncStatus = {
  phase: FriendsSyncPhase;
  relayStatus: Record<string, RelayHealth>;
  lastSyncedAt: number | null;
  lastError: string | null;
  pendingPublish: number;
  peers: Record<string, PeerSyncState>;
};

export type FriendsSyncIdentity = {
  pubkey: string;
  privateKey: Uint8Array;
};

export type PeerDirectory = {
  accepted: string[];
  pending: string[];
  blocked: string[];
};

/** A chat envelope without its transport header — the engine stamps that. */
type WithoutEnvelopeHeader<T> = Omit<
  T,
  Exclude<keyof EnvelopeBase, "type">
>;

export type ChatEnvelopeDraft =
  | WithoutEnvelopeHeader<ChatMessageEnvelope>
  | WithoutEnvelopeHeader<ChatReadEnvelope>
  | WithoutEnvelopeHeader<ChatRequestEnvelope>
  | WithoutEnvelopeHeader<ChatAcceptEnvelope>;

/**
 * The bridge between the engine and local data. Implemented over the
 * `friendsStorage` helpers in `adapter.ts`; every method must be synchronous
 * except the ones that persist a merge.
 */
export interface FriendsSyncAdapter {
  /** The authoritative identity, or null while it is still unknown. */
  identity(): FriendsSyncIdentity | null;
  /** Relay set to read from and publish to. */
  relays(): string[];
  /** Current friend graph, split by consent state. */
  peers(): PeerDirectory;
  /** Our own profile as it travels in request envelopes. */
  profile(): SharedProfile;

  buildSnapshot(peerPubkey: string): SnapshotEnvelope;
  applySnapshot(peerPubkey: string, payload: SnapshotEnvelope): void | Promise<void>;

  buildPresence(peerPubkey: string, seen: SeenMap): PresenceEnvelope;
  applyPresence(peerPubkey: string, payload: PresenceEnvelope): void;

  /** Chat envelopes we stored locally but never delivered. */
  pendingChat(peerPubkey: string): ChatEnvelope[];
  applyChat(peerPubkey: string, envelope: ChatEnvelope): void;
  markChatDelivered(peerPubkey: string, envelope: ChatEnvelope): void;

  /** Record an inbound invite (idempotent). */
  incomingRequest(senderPubkey: string, profile: SharedProfile): void;
  /** Record our own outgoing invite. */
  outgoingRequest(pubkey: string): void;
  /** Mutual consent established. */
  acceptPeer(pubkey: string): void;
  removePeer(pubkey: string): void;
  blockPeer(pubkey: string): void;

  isBlocked(pubkey: string): boolean;
  isAccepted(pubkey: string): boolean;
  isPending(pubkey: string): boolean;
  /** True when we asked them and they have not accepted yet. */
  hasOutgoingRequest(pubkey: string): boolean;

  subscribeLocalChanges(cb: () => void): () => void;
  notifyLocalChange(): void;

  /** Library-derived per-game stats; the page owns the library. */
  setSharedGames(provider: (() => SharedGameStatInput[]) | null): void;
}

/** Minimal shape the page pushes in for the shared `games` block. */
export type SharedGameStatInput = {
  id: string;
  name: string;
  playTimeMin: number;
};

export type FriendsSyncEngineOptions = {
  relay: RelayPort;
  adapter: FriendsSyncAdapter;
  /** Milliseconds, same unit as `Date.now()`. */
  now?: () => number;
  /** 0..1, used for retry jitter. Inject `() => 0` for exact timings. */
  random?: () => number;
};

export type Unsubscribe = () => void;

type PublishJob = {
  key: string;
  peer: string;
  kind: "snapshot" | "presence" | "chat";
  event: NostrEvent;
  /** Snapshot content without the volatile header, for change detection. */
  fingerprint: string;
  rev: number;
  attempts: number;
  timer: Timer | null;
  chat?: ChatEnvelope;
};

/** Bounded set that forgets the oldest id once it is full. */
class SeenEvents {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly limit: number) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.order.push(id);
    while (this.order.length > this.limit) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.ids.delete(evicted);
    }
  }

  clear(): void {
    this.ids.clear();
    this.order.length = 0;
  }
}

/**
 * Snapshot identity for change detection: everything except the fields the
 * engine stamps on publish. `seen` is excluded too — it rides on the presence
 * envelope and would otherwise force a republish every time a peer acks.
 */
function snapshotFingerprint(envelope: SnapshotEnvelope): string {
  const {
    seen: _seen,
    rev: _rev,
    updatedAt: _updatedAt,
    ...content
  } = envelope;
  return JSON.stringify(content);
}

function streamTagsForMe(
  event: { tags: string[][] },
  myPubkey: string
): boolean {
  const presenceTag = presenceDTagFor(myPubkey);
  return event.tags.some((tag) => {
    if (tag[0] !== "d" || typeof tag[1] !== "string") return false;
    return tag[1] === presenceTag || isStateDTagForMe(tag[1], myPubkey);
  });
}

function toDraft(envelope: ChatEnvelope): ChatEnvelopeDraft {
  const {
    v: _v,
    sender: _sender,
    recipient: _recipient,
    rev: _rev,
    updatedAt: _updatedAt,
    ...draft
  } = envelope;
  return draft as ChatEnvelopeDraft;
}

export class FriendsSyncEngine {
  private readonly relay: RelayPort;
  private readonly adapter: FriendsSyncAdapter;
  private readonly now: () => number;
  private readonly random: () => number;

  private started = false;
  private stopping = false;
  private identity: FriendsSyncIdentity | null = null;

  private phase: FriendsSyncPhase = "idle";
  private relayStatus: Record<string, RelayHealth> = {};
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;

  private accepted = new Set<string>();
  private pending = new Set<string>();
  private blocked = new Set<string>();

  private appliedRevs = new Map<string, SnapshotVersion>();
  private publishedRevs = new Map<string, number>();
  private lastPublishedPayload = new Map<string, string>();
  private seen: SeenMap = {};
  private seenByPeer = new Map<string, number>();
  private peerPresence = new Map<string, PeerPresence>();
  private peerLastSeenAt = new Map<string, number>();

  private readonly dedupe = new SeenEvents(SEEN_EVENT_LIMIT);
  private invited = new Set<string>();

  private publishJobs = new Map<string, PublishJob>();
  private publishDebounceTimer: Timer | null = null;
  private gapTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private inboxTimer: Timer | null = null;
  private resubscribeTimer: Timer | null = null;
  private requestReplayTimer: Timer | null = null;
  private resubscribeAttempts = 0;
  private nextSnapshotAt = 0;

  private subscriptions: Array<{ close(): void }> = [];
  private unsubscribeLocal: Unsubscribe | null = null;

  private lastChatSync = 0;
  /** Depth counter: local-change notifications while applying a remote
   *  snapshot must not bounce straight back out as a publish. */
  private applyingRemote = 0;

  private readonly statusSubscribers = new Set<(status: FriendsSyncStatus) => void>();

  constructor(options: FriendsSyncEngineOptions) {
    this.relay = options.relay;
    this.adapter = options.adapter;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    const identity = this.adapter.identity();
    if (!identity) {
      this.phase = "offline";
      this.lastError = "identity-unavailable";
      this.emit();
      return;
    }

    this.started = true;
    this.stopping = false;
    this.identity = identity;
    this.phase = "connecting";
    this.lastError = null;
    this.resubscribeAttempts = 0;
    this.lastChatSync =
      Math.floor(this.now() / 1000) - CHAT_BACKFILL_SECONDS;

    this.refreshPeers();
    this.unsubscribeLocal = this.adapter.subscribeLocalChanges(() => {
      this.onLocalChange();
    });
    this.emit();

    // A request sent while the peer was offline never reached them; replay it
    // now and keep replaying while they have not answered.
    this.replayOutgoingRequests();
    this.scheduleRequestReplay();

    void this.run(() => this.initialSync());
    this.scheduleHeartbeat();
    this.scheduleInboxPoll();
  }

  stop(): void {
    this.stopping = true;
    this.started = false;

    this.closeSubscriptions();
    this.clearTimer("publishDebounce");
    this.clearTimer("gap");
    this.clearTimer("heartbeat");
    this.clearTimer("inbox");
    this.clearTimer("resubscribe");
    this.clearTimer("requestReplay");

    this.publishJobs.forEach((job) => {
      if (job.timer) clearTimeout(job.timer);
    });
    this.publishJobs.clear();

    this.unsubscribeLocal?.();
    this.unsubscribeLocal = null;

    this.identity = null;
    this.accepted.clear();
    this.pending.clear();
    this.blocked.clear();
    this.appliedRevs.clear();
    this.publishedRevs.clear();
    this.lastPublishedPayload.clear();
    this.seen = {};
    this.seenByPeer.clear();
    this.peerPresence.clear();
    this.peerLastSeenAt.clear();
    this.dedupe.clear();
    this.invited.clear();
    this.resubscribeAttempts = 0;
    this.nextSnapshotAt = 0;
    this.applyingRemote = 0;
    this.phase = "idle";
    this.emit();
  }

  /** Re-read the friend graph and push a fresh status to subscribers. */
  refresh(): void {
    if (!this.started) {
      this.emit();
      return;
    }
    this.refreshPeers();
    this.emit();
  }

  async syncNow(): Promise<void> {
    if (!this.started) return;
    if (this.phase !== "online" && this.phase !== "degraded") {
      this.phase = "connecting";
      this.emit();
    }
    await this.run(async () => {
      this.refreshPeers();
      await this.fetchPeerStates();
      await this.fetchChat();
      await this.publishChangedPeers();
      this.flushPendingChat();
      this.publishPresence();
      this.lastSyncedAt = this.now();
      this.emit();
    });
  }

  // ── status ─────────────────────────────────────────────────────────

  getStatus(): FriendsSyncStatus {
    return this.buildStatus();
  }

  subscribeStatus(cb: (status: FriendsSyncStatus) => void): Unsubscribe {
    this.statusSubscribers.add(cb);
    return () => {
      this.statusSubscribers.delete(cb);
    };
  }

  private buildStatus(): FriendsSyncStatus {
    const peers: Record<string, PeerSyncState> = {};
    this.accepted.forEach((pubkey) => {
      const applied = this.appliedRevs.get(pubkey);
      peers[pubkey] = {
        lastStateRev: applied ? applied.rev : null,
        lastSeenAt: this.peerLastSeenAt.get(pubkey) ?? null,
        seenByPeer: this.seenByPeer.get(pubkey) ?? null,
        lastPublishedRev: this.publishedRevs.get(pubkey) ?? null,
        presence: this.peerPresence.get(pubkey) ?? null,
      };
    });
    return {
      phase: this.phase,
      relayStatus: { ...this.relayStatus },
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      pendingPublish: this.publishJobs.size,
      peers,
    };
  }

  private emit(): void {
    const status = this.buildStatus();
    this.statusSubscribers.forEach((cb) => {
      try {
        cb(status);
      } catch {
        /* a broken subscriber must not break the loop */
      }
    });
  }

  // ── public actions ─────────────────────────────────────────────────

  /** Debounced: republish to every accepted peer after a local mutation. */
  requestPublish(): void {
    if (!this.started || this.stopping) return;
    this.clearTimer("publishDebounce");
    this.publishDebounceTimer = setTimeout(() => {
      this.publishDebounceTimer = null;
      void this.run(() => this.publishChangedPeers());
    }, PUBLISH_DEBOUNCE_MS);
  }

  publishPresence(peer?: string): void {
    if (!this.started || this.stopping) return;
    const targets = peer ? [peer] : Array.from(this.accepted);
    targets.forEach((target) => this.enqueuePresence(target));
  }

  sendChat(peer: string, envelope: ChatEnvelopeDraft): void {
    if (!this.started || !this.identity) return;
    const normalized = normalizePubkey(peer);
    if (!normalized) return;
    if (this.blocked.has(normalized)) return;
    if (!this.accepted.has(normalized) && !this.adapter.isAccepted(normalized)) {
      return;
    }
    this.publishChat(normalized, envelope);
  }

  sendFriendRequest(pubkey: string): void {
    if (!this.started || !this.identity) return;
    const normalized = normalizePubkey(pubkey);
    if (!normalized || this.blocked.has(normalized)) return;
    if (this.accepted.has(normalized) || this.adapter.isAccepted(normalized)) {
      return;
    }
    this.adapter.outgoingRequest(normalized);
    this.pending.add(normalized);
    this.publishOutgoingRequest(normalized);
    this.scheduleRequestReplay();
    this.emit();
  }

  /**
   * Hands the adapter the library-derived per-game stats. The engine owns the
   * adapter instance, so the React layer registers through here instead of
   * reaching into the adapter it never sees.
   */
  setSharedGames(provider: (() => SharedGameStatInput[]) | null): void {
    this.adapter.setSharedGames(provider);
  }

  /**
   * Re-publish a still-unanswered outgoing request — the UI's explicit "send
   * again". The periodic replay covers the offline case on its own; this is
   * for a user who does not want to wait for the next interval.
   */
  resendRequest(pubkey: string): void {
    if (!this.started || !this.identity) return;
    const normalized = normalizePubkey(pubkey);
    if (!normalized || this.blocked.has(normalized)) return;
    if (this.accepted.has(normalized) || this.adapter.isAccepted(normalized)) {
      return;
    }
    if (!this.adapter.hasOutgoingRequest(normalized)) return;
    this.pending.add(normalized);
    this.publishOutgoingRequest(normalized);
    this.scheduleRequestReplay();
    this.emit();
  }

  acceptFriend(pubkey: string): void {
    if (!this.started || !this.identity) return;
    const normalized = normalizePubkey(pubkey);
    if (!normalized || this.blocked.has(normalized)) return;

    this.adapter.acceptPeer(normalized);
    this.accepted.add(normalized);
    this.pending.delete(normalized);
    this.emit();

    // The accept and the first snapshot go out right away: the peer is
    // waiting on exactly this event to flip their own state.
    this.publishChat(normalized, { type: "accept", at: this.now() });
    void this.run(async () => {
      await this.publishSnapshotTo(normalized, true);
      this.enqueuePresence(normalized);
    });
  }

  removePeer(pubkey: string): void {
    const normalized = normalizePubkey(pubkey);
    if (!normalized) return;
    this.adapter.removePeer(normalized);
    this.forgetPeer(normalized);
    this.emit();
  }

  blockPeer(pubkey: string): void {
    const normalized = normalizePubkey(pubkey);
    if (!normalized) return;
    this.adapter.blockPeer(normalized);
    this.blocked.add(normalized);
    this.forgetPeer(normalized);
    this.emit();
  }

  // ── internals: peers ───────────────────────────────────────────────

  private refreshPeers(): void {
    const directory = this.adapter.peers();
    this.accepted = new Set(directory.accepted);
    this.pending = new Set(directory.pending);
    this.blocked = new Set(directory.blocked);
    this.blocked.forEach((pubkey) => this.accepted.delete(pubkey));
  }

  private forgetPeer(pubkey: string): void {
    this.accepted.delete(pubkey);
    this.pending.delete(pubkey);
    this.appliedRevs.delete(pubkey);
    this.publishedRevs.delete(pubkey);
    this.lastPublishedPayload.delete(pubkey);
    this.seenByPeer.delete(pubkey);
    this.peerPresence.delete(pubkey);
    this.peerLastSeenAt.delete(pubkey);
    delete this.seen[pubkey];
    this.cancelJobsFor(pubkey);
  }

  private cancelJobsFor(pubkey: string): void {
    Array.from(this.publishJobs.values()).forEach((job) => {
      if (job.peer !== pubkey) return;
      if (job.timer) clearTimeout(job.timer);
      this.publishJobs.delete(job.key);
    });
  }

  private onLocalChange(): void {
    if (!this.started || this.stopping) return;
    if (this.applyingRemote > 0) return;
    this.refreshPeers();
    this.requestPublish();
  }

  private relays(): string[] {
    return this.adapter.relays();
  }

  private myPubkey(): string | null {
    return this.identity ? this.identity.pubkey : null;
  }

  // ── internals: initial sync ────────────────────────────────────────

  private async initialSync(): Promise<void> {
    await this.fetchPeerStates();
    await this.fetchChat();
    await this.publishChangedPeers();
    this.flushPendingChat();
    this.publishPresence();
    this.openSubscriptions();
    this.lastSyncedAt = this.now();
    this.emit();
  }

  private async fetchPeerStates(): Promise<void> {
    const myPubkey = this.myPubkey();
    if (!myPubkey) return;
    const dTag = stateDTagFor(myPubkey);
    const peers = Array.from(this.accepted);

    await Promise.allSettled(
      peers.map(async (peer) => {
        const events = await this.relay.query(this.relays(), {
          kinds: [STREAM_KIND],
          authors: [peer],
          "#d": [dTag],
        });
        events.forEach((event) => this.handleEvent(event));
      })
    );
  }

  private async fetchChat(): Promise<void> {
    const myPubkey = this.myPubkey();
    if (!myPubkey) return;
    const events = await this.relay.query(this.relays(), {
      kinds: [CHAT_WRAP_KIND],
      "#p": [myPubkey],
      since: this.lastChatSync,
    });
    events.forEach((event) => this.handleEvent(event));
    this.lastChatSync = Math.floor(this.now() / 1000);
  }

  private async pollInbox(): Promise<void> {
    const myPubkey = this.myPubkey();
    if (!myPubkey) return;
    const events = await this.relay.query(this.relays(), {
      kinds: [CHAT_WRAP_KIND],
      "#p": [myPubkey],
      since: this.lastChatSync,
    });
    events.forEach((event) => this.handleEvent(event));
    this.lastChatSync = Math.floor(this.now() / 1000);
  }

  // ── internals: subscriptions ───────────────────────────────────────

  private openSubscriptions(): void {
    if (!this.started || this.stopping) return;
    const myPubkey = this.myPubkey();
    if (!myPubkey) return;

    this.closeSubscriptions();

    const peers = Array.from(this.accepted);
    if (peers.length > 0) {
      this.subscriptions.push(
        this.relay.subscribe(
          this.relays(),
          [{ kinds: [STREAM_KIND], authors: peers }],
          {
            onEvent: (event) => {
              this.resubscribeAttempts = 0;
              if (!streamTagsForMe(event, myPubkey)) return;
              this.handleEvent(event);
            },
            onClose: (reasons) => this.onSubscriptionClosed(reasons),
          }
        )
      );
    }

    this.subscriptions.push(
      this.relay.subscribe(
        this.relays(),
        [
          {
            kinds: [CHAT_WRAP_KIND],
            "#p": [myPubkey],
            since: this.lastChatSync,
          },
        ],
        {
          onEvent: (event) => {
            this.resubscribeAttempts = 0;
            this.handleEvent(event);
          },
          onClose: (reasons) => this.onSubscriptionClosed(reasons),
        }
      )
    );
  }

  private closeSubscriptions(): void {
    const subs = this.subscriptions;
    this.subscriptions = [];
    subs.forEach((sub) => {
      try {
        sub.close();
      } catch {
        /* ignore */
      }
    });
  }

  private onSubscriptionClosed(reasons: string[]): void {
    if (!this.started || this.stopping) return;
    this.lastError = reasons.length > 0 ? reasons.join("; ") : "subscription closed";
    // Every relay dropping at once reports one close per subscription; the
    // backoff must step once per outage, not once per subscription.
    if (!this.resubscribeTimer) this.resubscribeAttempts += 1;
    const delay = Math.min(
      RESUBSCRIBE_MIN_MS * 2 ** (this.resubscribeAttempts - 1),
      RESUBSCRIBE_MAX_MS
    );
    this.clearTimer("resubscribe");
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = null;
      void this.run(() => {
        this.openSubscriptions();
      });
    }, delay);
    this.emit();
  }

  // ── internals: inbound events ──────────────────────────────────────

  private handleEvent(event: NostrEvent): void {
    try {
      if (!this.started || this.stopping || !this.identity) return;
      if (this.dedupe.has(event.id)) return;
      this.dedupe.add(event.id);

      const parsed = parseRelayEvent(event, this.identity.privateKey, {
        now: this.now(),
      });
      if ("error" in parsed) return;
      if (this.adapter.isBlocked(parsed.sender)) return;

      if (parsed.kind === "snapshot") {
        void this.run(() => this.handleSnapshot(parsed.sender, parsed.payload));
        return;
      }
      if (parsed.kind === "presence") {
        this.handlePresence(parsed.sender, parsed.payload);
        return;
      }
      void this.run(() => this.handleChat(parsed.sender, parsed.payload));
    } catch (err) {
      this.noteError(err);
    }
  }

  private async handleSnapshot(
    sender: string,
    payload: SnapshotEnvelope
  ): Promise<void> {
    const accepted =
      this.accepted.has(sender) || this.adapter.isAccepted(sender);

    if (!accepted) {
      // A state event only reaches us because the peer considers us a peer,
      // so this is their consent. Ours was given when we asked them, which is
      // why an *outgoing* request (never an inbound invite) auto-accepts.
      if (this.adapter.hasOutgoingRequest(sender)) {
        this.adapter.acceptPeer(sender);
        this.accepted.add(sender);
        this.pending.delete(sender);
        await this.applyRemoteSnapshot(sender, payload);
        this.publishChat(sender, { type: "accept", at: this.now() });
        await this.run(() => this.publishSnapshotTo(sender, true));
        this.enqueuePresence(sender);
        return;
      }
      this.surfaceInvite(sender, payload.profile);
      return;
    }

    const known = this.appliedRevs.get(sender) ?? null;
    if (!isNewerSnapshot(known, payload)) return;
    await this.applyRemoteSnapshot(sender, payload);
  }

  private async applyRemoteSnapshot(
    sender: string,
    payload: SnapshotEnvelope
  ): Promise<void> {
    this.applyingRemote += 1;
    try {
      await this.adapter.applySnapshot(sender, payload);
    } finally {
      this.applyingRemote -= 1;
    }
    this.appliedRevs.set(sender, { rev: payload.rev, updatedAt: payload.updatedAt });
    this.seen[sender] = payload.rev;
    this.peerLastSeenAt.set(sender, this.now());
    this.lastSyncedAt = this.now();
    this.emit();
  }

  private handlePresence(sender: string, payload: PresenceEnvelope): void {
    if (!this.accepted.has(sender) && !this.adapter.isAccepted(sender)) return;
    const myPubkey = this.myPubkey();
    if (myPubkey) {
      const acked = payload.seen[myPubkey];
      if (typeof acked === "number") this.seenByPeer.set(sender, acked);
    }
    this.peerPresence.set(sender, {
      status: payload.status,
      currentlyPlaying: payload.currentlyPlaying,
      lastActive: payload.lastActive,
    });
    this.peerLastSeenAt.set(sender, this.now());
    try {
      this.adapter.applyPresence(sender, payload);
    } catch (err) {
      this.noteError(err);
    }
    this.emit();
  }

  private async handleChat(sender: string, payload: ChatEnvelope): Promise<void> {
    if (payload.type === "request") {
      if (this.accepted.has(sender) || this.adapter.isAccepted(sender)) return;
      if (this.adapter.hasOutgoingRequest(sender)) {
        this.acceptFriend(sender);
        return;
      }
      this.surfaceInvite(sender, payload.profile);
      return;
    }

    if (payload.type === "accept") {
      if (this.blocked.has(sender)) return;
      this.adapter.acceptPeer(sender);
      this.accepted.add(sender);
      this.pending.delete(sender);
      this.lastSyncedAt = this.now();
      this.emit();
      await this.run(async () => {
        await this.publishSnapshotTo(sender, true);
        this.enqueuePresence(sender);
      });
      return;
    }

    if (!this.accepted.has(sender) && !this.adapter.isAccepted(sender)) return;
    this.adapter.applyChat(sender, payload);
    this.peerLastSeenAt.set(sender, this.now());
    this.lastSyncedAt = this.now();
    this.emit();
  }

  private surfaceInvite(sender: string, profile: SharedProfile): void {
    if (this.adapter.isBlocked(sender)) return;
    if (this.adapter.isAccepted(sender)) return;
    const alreadyInvited = this.invited.has(sender);
    this.invited.add(sender);
    this.pending.add(sender);
    if (!alreadyInvited) {
      try {
        this.adapter.incomingRequest(sender, profile);
      } catch (err) {
        this.noteError(err);
      }
    }
    this.emit();
  }

  // ── internals: publish queue ───────────────────────────────────────

  private async publishChangedPeers(): Promise<void> {
    if (!this.started || this.stopping) return;
    const myPubkey = this.myPubkey();
    if (!myPubkey) return;

    const wait = this.nextSnapshotAt - this.now();
    if (wait > 0) {
      this.clearTimer("gap");
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        void this.run(() => this.publishChangedPeers());
      }, wait);
      return;
    }

    const peers = Array.from(this.accepted);
    let published = false;
    for (const peer of peers) {
      published = (await this.publishSnapshotTo(peer, false)) || published;
    }
    if (published) this.nextSnapshotAt = this.now() + MIN_PUBLISH_GAP_MS;
  }

  /** Returns true when an event was actually queued for delivery. */
  private async publishSnapshotTo(
    peer: string,
    force: boolean
  ): Promise<boolean> {
    const myPubkey = this.myPubkey();
    if (!this.started || this.stopping || !myPubkey) return false;
    if (this.blocked.has(peer) || !this.accepted.has(peer)) return false;

    const jobKey = `snapshot:${peer}`;
    if (this.publishJobs.has(jobKey)) return false;

    let envelope: SnapshotEnvelope;
    try {
      envelope = this.adapter.buildSnapshot(peer);
    } catch (err) {
      this.noteError(err);
      return false;
    }

    const fingerprint = snapshotFingerprint(envelope);
    if (!force && this.lastPublishedPayload.get(peer) === fingerprint) {
      return false;
    }

    const rev = Math.max(
      nextRev(this.publishedRevs.get(peer)),
      Math.floor(this.now() / 1000)
    );
    const payload: SnapshotEnvelope = {
      ...envelope,
      v: FRIENDS_SYNC_VERSION,
      type: "snapshot",
      sender: myPubkey,
      recipient: peer,
      rev,
      updatedAt: this.now(),
      seen: { ...this.seen },
    };

    let event: PublishJob["event"];
    try {
      event = buildStateEvent({
        senderPrivateKey: this.identity!.privateKey,
        recipientPubkey: peer,
        envelope: payload,
      });
    } catch (err) {
      this.noteError(err);
      return false;
    }

    this.enqueue({
      key: jobKey,
      peer,
      kind: "snapshot",
      event,
      fingerprint,
      rev,
      attempts: 0,
      timer: null,
    });
    return true;
  }

  private enqueuePresence(peer: string): void {
    const myPubkey = this.myPubkey();
    if (!this.started || this.stopping || !myPubkey) return;
    if (this.blocked.has(peer) || !this.accepted.has(peer)) return;

    let envelope: PresenceEnvelope;
    try {
      envelope = this.adapter.buildPresence(peer, { ...this.seen });
    } catch (err) {
      this.noteError(err);
      return;
    }

    const updatedAt = this.now();
    const payload: PresenceEnvelope = {
      ...envelope,
      v: FRIENDS_SYNC_VERSION,
      type: "presence",
      sender: myPubkey,
      recipient: peer,
      rev: Math.floor(updatedAt / 1000),
      updatedAt,
      seen: { ...this.seen },
    };

    let event: PublishJob["event"];
    try {
      event = buildPresenceEvent({
        senderPrivateKey: this.identity!.privateKey,
        recipientPubkey: peer,
        envelope: payload,
      });
    } catch (err) {
      this.noteError(err);
      return;
    }

    // Presence is replaceable: a newer heartbeat supersedes one still
    // waiting in the queue instead of piling up behind it.
    const existing = this.publishJobs.get(`presence:${peer}`);
    if (existing) {
      existing.event = event;
      return;
    }

    this.enqueue({
      key: `presence:${peer}`,
      peer,
      kind: "presence",
      event,
      fingerprint: "",
      rev: payload.rev,
      attempts: 0,
      timer: null,
    });
  }

  private publishChat(peer: string, draft: ChatEnvelopeDraft): void {
    const myPubkey = this.myPubkey();
    if (!this.started || this.stopping || !myPubkey) return;
    if (!this.identity) return;

    const updatedAt = this.now();
    const envelope = {
      ...draft,
      v: FRIENDS_SYNC_VERSION,
      sender: myPubkey,
      recipient: peer,
      rev: Math.max(1, Math.floor(updatedAt / 1000)),
      updatedAt,
    } as ChatEnvelope;

    let event: PublishJob["event"];
    try {
      event = buildChatEvent({
        senderPrivateKey: this.identity.privateKey,
        recipientPubkey: peer,
        envelope,
      });
    } catch (err) {
      this.noteError(err);
      return;
    }

    const id =
      envelope.type === "message"
        ? envelope.id
        : envelope.type === "read"
          ? String(envelope.upTo)
          : String(envelope.at);
    const jobKey = `chat:${peer}:${envelope.type}:${id}`;
    if (this.publishJobs.has(jobKey)) return;

    this.enqueue({
      key: jobKey,
      peer,
      kind: "chat",
      event,
      fingerprint: "",
      rev: envelope.rev,
      attempts: 0,
      timer: null,
      chat: envelope,
    });
  }

  private flushPendingChat(): void {
    Array.from(this.accepted).forEach((peer) => {
      let pending: ChatEnvelope[];
      try {
        pending = this.adapter.pendingChat(peer);
      } catch (err) {
        this.noteError(err);
        return;
      }
      pending.forEach((envelope) => this.publishChat(peer, toDraft(envelope)));
    });
  }

  /** Publishes one friend-request envelope; `at` is what makes it a fresh one. */
  private publishOutgoingRequest(peer: string): void {
    this.publishChat(peer, {
      type: "request",
      profile: this.adapter.profile(),
      at: this.now(),
    });
  }

  /**
   * Peers we asked who still have not answered: pending consent, an outgoing
   * (not incoming) request, not accepted, not blocked. Anything that no longer
   * matches is dropped from `pending` so a stale entry cannot keep the replay
   * loop alive.
   */
  private requestReplayCandidates(): string[] {
    const candidates: string[] = [];
    Array.from(this.pending).forEach((peer) => {
      if (this.accepted.has(peer) || this.blocked.has(peer)) {
        this.pending.delete(peer);
        return;
      }
      if (this.adapter.isAccepted(peer) || this.adapter.isBlocked(peer)) {
        this.pending.delete(peer);
        return;
      }
      if (!this.adapter.hasOutgoingRequest(peer)) {
        this.pending.delete(peer);
        return;
      }
      candidates.push(peer);
    });
    return candidates;
  }

  /** Re-publishes every unanswered request; returns how many went out. */
  private replayOutgoingRequests(): number {
    if (!this.started || this.stopping || !this.identity) return 0;
    const candidates = this.requestReplayCandidates();
    candidates.forEach((peer) => this.publishOutgoingRequest(peer));
    return candidates.length;
  }

  /**
   * The replay loop only stays scheduled while at least one request is still
   * unanswered, so an accepted friend is never re-asked.
   */
  private scheduleRequestReplay(): void {
    if (!this.started || this.stopping) return;
    if (this.requestReplayTimer) return;
    this.requestReplayTimer = setTimeout(() => {
      this.requestReplayTimer = null;
      if (!this.started) return;
      if (this.replayOutgoingRequests() > 0) this.scheduleRequestReplay();
    }, REQUEST_REPLAY_MS);
  }

  private enqueue(job: PublishJob): void {
    this.publishJobs.set(job.key, job);
    this.emit();
    void this.run(() => this.deliverJob(job));
  }

  private async deliverJob(job: PublishJob): Promise<void> {
    const current = this.publishJobs.get(job.key);
    if (!current) return;
    if (!this.started || this.stopping) {
      this.publishJobs.delete(current.key);
      return;
    }

    let result: { ok: string[]; failed: string[] };
    try {
      result = await this.relay.publish(this.relays(), current.event);
    } catch (err) {
      result = { ok: [], failed: this.relays() };
      this.noteError(err);
    }

    if (!this.started) {
      this.publishJobs.delete(current.key);
      return;
    }

    this.recordRelayHealth(result);

    if (result.ok.length > 0) {
      this.publishJobs.delete(current.key);
      if (current.kind === "snapshot") {
        this.lastPublishedPayload.set(current.peer, current.fingerprint);
        this.publishedRevs.set(current.peer, current.rev);
        this.lastSyncedAt = this.now();
      } else if (current.kind === "chat" && current.chat) {
        try {
          this.adapter.markChatDelivered(current.peer, current.chat);
        } catch (err) {
          this.noteError(err);
        }
      }
      this.emit();
      return;
    }

    if (current.attempts >= RETRY_DELAYS_MS.length) {
      this.publishJobs.delete(current.key);
      this.noteError(
        `every relay refused a ${current.kind} event for ${current.peer.slice(0, 8)}…`
      );
      return;
    }

    const delay =
      RETRY_DELAYS_MS[current.attempts] + Math.floor(this.random() * 250);
    current.attempts += 1;
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => {
      current.timer = null;
      void this.run(() => this.deliverJob(current));
    }, delay);
    this.emit();
  }

  // ── internals: timers, health, errors ──────────────────────────────

  private scheduleHeartbeat(): void {
    this.clearTimer("heartbeat");
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.started) return;
      this.publishPresence();
      this.scheduleHeartbeat();
    }, PRESENCE_HEARTBEAT_MS);
  }

  private scheduleInboxPoll(): void {
    this.clearTimer("inbox");
    this.inboxTimer = setTimeout(() => {
      this.inboxTimer = null;
      if (!this.started) return;
      void this.run(() => this.pollInbox()).then(() => {
        if (this.started) this.scheduleInboxPoll();
      });
    }, INBOX_POLL_MS);
  }

  private clearTimer(
    which:
      | "publishDebounce"
      | "gap"
      | "heartbeat"
      | "inbox"
      | "resubscribe"
      | "requestReplay"
  ): void {
    const timer =
      which === "publishDebounce"
        ? this.publishDebounceTimer
        : which === "gap"
          ? this.gapTimer
          : which === "heartbeat"
            ? this.heartbeatTimer
            : which === "inbox"
              ? this.inboxTimer
              : which === "resubscribe"
                ? this.resubscribeTimer
                : this.requestReplayTimer;
    if (!timer) return;
    clearTimeout(timer);
    if (which === "publishDebounce") this.publishDebounceTimer = null;
    else if (which === "gap") this.gapTimer = null;
    else if (which === "heartbeat") this.heartbeatTimer = null;
    else if (which === "inbox") this.inboxTimer = null;
    else if (which === "resubscribe") this.resubscribeTimer = null;
    else this.requestReplayTimer = null;
  }

  private recordRelayHealth(result: { ok: string[]; failed: string[] }): void {
    if (result.ok.length === 0 && result.failed.length === 0) return;
    const next = { ...this.relayStatus };
    result.ok.forEach((relay) => {
      next[relay] = "accepted";
    });
    result.failed.forEach((relay) => {
      next[relay] = "failed";
    });
    this.relayStatus = next;
    this.updatePhase();
  }

  private updatePhase(): void {
    const health = Object.values(this.relayStatus);
    if (health.length === 0) return;
    const accepted = health.filter((value) => value === "accepted").length;
    const phase: FriendsSyncPhase =
      accepted === 0
        ? "offline"
        : accepted === health.length
          ? "online"
          : "degraded";
    if (phase === this.phase) return;
    this.phase = phase;
    this.emit();
  }

  private noteError(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.emit();
  }

  /** Runs a callback with errors captured into `lastError` instead of thrown. */
  private async run<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.noteError(err);
      return undefined;
    }
  }
}

export function createFriendsSyncEngine(
  options: FriendsSyncEngineOptions
): FriendsSyncEngine {
  return new FriendsSyncEngine(options);
}
