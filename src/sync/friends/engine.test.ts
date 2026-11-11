import { webcrypto } from "node:crypto";

import type { Filter } from "nostr-tools/filter";
import {
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FriendsSyncEngine,
  type FriendsSyncAdapter,
  type FriendsSyncPhase,
} from "./engine";
import {
  buildChatEvent,
  buildPresenceEvent,
  buildStateEvent,
} from "./protocol";
import type { RelayPort, RelaySubscriptionHandlers } from "./relay";
import type {
  ChatEnvelope,
  PresenceEnvelope,
  SeenMap,
  SharedProfile,
  SnapshotEnvelope,
} from "./types";

if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const alicePriv = generateSecretKey();
const alicePub = getPublicKey(alicePriv);
const bobPriv = generateSecretKey();
const bobPub = getPublicKey(bobPriv);
const carolPriv = generateSecretKey();
const carolPub = getPublicKey(carolPriv);
const davePriv = generateSecretKey();
const davePub = getPublicKey(davePriv);

const RELAY_ONE = "wss://relay.one";
const RELAY_TWO = "wss://relay.two";

const STATE_PREFIX = "gamelib-v3:state:";
const PRESENCE_PREFIX = "gamelib-v3:presence:";

type Subscription = {
  relays: string[];
  filters: Filter[];
  handlers: RelaySubscriptionHandlers;
  closed: boolean;
};

class FakeRelay implements RelayPort {
  published: Array<{ relays: string[]; event: NostrEvent }> = [];
  subscriptions: Subscription[] = [];
  queries: Array<{ relays: string[]; filter: Filter }> = [];
  queryResults: NostrEvent[] = [];
  accepted = new Set<string>([RELAY_ONE, RELAY_TWO]);
  refuseAll = false;

  async publish(relays: string[], event: NostrEvent) {
    this.published.push({ relays: [...relays], event });
    if (this.refuseAll) return { ok: [], failed: [...relays] };
    const ok = relays.filter((relay) => this.accepted.has(relay));
    return { ok, failed: relays.filter((relay) => !ok.includes(relay)) };
  }

  subscribe(
    relays: string[],
    filters: Filter[],
    handlers: RelaySubscriptionHandlers
  ) {
    const subscription: Subscription = {
      relays: [...relays],
      filters,
      handlers,
      closed: false,
    };
    this.subscriptions.push(subscription);
    return {
      close: () => {
        subscription.closed = true;
      },
    };
  }

  async query(relays: string[], filter: Filter) {
    this.queries.push({ relays: [...relays], filter });
    if (this.refuseAll) {
      return { events: [] as NostrEvent[], ok: [] as string[], failed: [...relays] };
    }
    const ok = relays.filter((relay) => this.accepted.has(relay));
    return {
      events: [...this.queryResults],
      ok,
      failed: relays.filter((relay) => !ok.includes(relay)),
    };
  }

  emit(event: NostrEvent) {
    this.subscriptions
      .filter((subscription) => !subscription.closed)
      .forEach((subscription) => subscription.handlers.onEvent(event));
  }

  drop(reasons: string[] = ["relay closed"]) {
    this.subscriptions
      .filter((subscription) => !subscription.closed)
      .forEach((subscription) => {
        subscription.closed = true;
        subscription.handlers.onClose?.(reasons);
      });
  }

  stateEvents() {
    return this.published.filter(
      ({ event }) =>
        event.kind === 30078 &&
        event.tags.some(
          (tag) =>
            tag[0] === "d" && typeof tag[1] === "string" && tag[1].startsWith(STATE_PREFIX)
        )
    );
  }

  presenceEvents() {
    return this.published.filter(
      ({ event }) =>
        event.kind === 30078 &&
        event.tags.some(
          (tag) =>
            tag[0] === "d" &&
            typeof tag[1] === "string" &&
            tag[1].startsWith(PRESENCE_PREFIX)
        )
    );
  }

  chatEvents() {
    return this.published.filter(({ event }) => event.kind === 1059);
  }

  recipients(events: Array<{ event: NostrEvent }>): string[] {
    return events
      .map(
        ({ event }) =>
          event.tags.find((tag) => tag[0] === "p")?.[1] ?? ""
      )
      .sort();
  }
}

type FakeState = {
  accepted: Set<string>;
  pending: Set<string>;
  blocked: Set<string>;
  outgoing: Set<string>;
  revision: number;
  applied: Array<{ peer: string; payload: SnapshotEnvelope }>;
  presence: Array<{ peer: string; payload: PresenceEnvelope }>;
  chat: Array<{ peer: string; payload: ChatEnvelope }>;
  delivered: Array<{ peer: string; envelope: ChatEnvelope }>;
  invites: Array<{ peer: string; profile: SharedProfile }>;
  acceptedCalls: string[];
  listeners: Set<() => void>;
  pendingChat: Map<string, ChatEnvelope[]>;
};

function createFakeAdapter(): { adapter: FriendsSyncAdapter; state: FakeState } {
  const state: FakeState = {
    accepted: new Set<string>(),
    pending: new Set<string>(),
    blocked: new Set<string>(),
    outgoing: new Set<string>(),
    revision: 1,
    applied: [],
    presence: [],
    chat: [],
    delivered: [],
    invites: [],
    acceptedCalls: [],
    listeners: new Set(),
    pendingChat: new Map(),
  };

  const adapter: FriendsSyncAdapter = {
    identity: () => ({ pubkey: alicePub, privateKey: alicePriv }),
    relays: () => [RELAY_ONE, RELAY_TWO],
    peers: () => ({
      accepted: Array.from(state.accepted),
      pending: Array.from(state.pending),
      blocked: Array.from(state.blocked),
    }),
    profile: () => ({ name: "Alice", status: "Ready to Play!" }),
    buildSnapshot: (peer) => ({
      v: 3,
      type: "snapshot",
      sender: alicePub,
      recipient: peer,
      rev: 0,
      updatedAt: 0,
      profile: { name: "Alice", status: `revision-${state.revision}` },
      friends: Array.from(state.accepted),
      seen: {},
    }),
    applySnapshot: (peer, payload) => {
      state.applied.push({ peer, payload });
    },
    buildPresence: (peer, seen) => ({
      v: 3,
      type: "presence",
      sender: alicePub,
      recipient: peer,
      rev: 0,
      updatedAt: 0,
      status: "Ready to Play!",
      currentlyPlaying: null,
      lastActive: 1_700_000_000,
      seen: { ...seen },
    }),
    applyPresence: (peer, payload) => {
      state.presence.push({ peer, payload });
    },
    pendingChat: (peer) => state.pendingChat.get(peer) ?? [],
    applyChat: (peer, payload) => {
      state.chat.push({ peer, payload });
    },
    markChatDelivered: (peer, envelope) => {
      state.delivered.push({ peer, envelope });
    },
    incomingRequest: (peer, profile) => {
      state.invites.push({ peer, profile });
      state.pending.add(peer);
    },
    outgoingRequest: (peer) => {
      state.pending.add(peer);
      state.outgoing.add(peer);
    },
    acceptPeer: (peer) => {
      state.acceptedCalls.push(peer);
      state.accepted.add(peer);
      state.pending.delete(peer);
    },
    removePeer: (peer) => {
      state.accepted.delete(peer);
      state.pending.delete(peer);
    },
    blockPeer: (peer) => {
      state.blocked.add(peer);
      state.accepted.delete(peer);
    },
    isBlocked: (peer) => state.blocked.has(peer),
    isAccepted: (peer) => state.accepted.has(peer),
    isPending: (peer) => state.pending.has(peer),
    hasOutgoingRequest: (peer) => state.outgoing.has(peer),
    subscribeLocalChanges: (cb) => {
      state.listeners.add(cb);
      return () => {
        state.listeners.delete(cb);
      };
    },
    notifyLocalChange: () => {
      state.listeners.forEach((cb) => cb());
    },
    setSharedGames: () => {},
  };

  return { adapter, state };
}

function snapshotEvent(
  senderPriv: Uint8Array,
  senderPub: string,
  recipientPub: string,
  rev: number,
  updatedAt: number,
  profile: SharedProfile = { name: "Peer" }
): NostrEvent {
  return buildStateEvent({
    senderPrivateKey: senderPriv,
    recipientPubkey: recipientPub,
    envelope: {
      v: 3,
      type: "snapshot",
      sender: senderPub,
      recipient: recipientPub,
      rev,
      updatedAt,
      profile,
      friends: [recipientPub],
      seen: {},
    },
  });
}

function presenceEvent(
  senderPriv: Uint8Array,
  senderPub: string,
  recipientPub: string,
  seen: SeenMap
): NostrEvent {
  return buildPresenceEvent({
    senderPrivateKey: senderPriv,
    recipientPubkey: recipientPub,
    envelope: {
      v: 3,
      type: "presence",
      sender: senderPub,
      recipient: recipientPub,
      rev: 1,
      updatedAt: Date.now(),
      status: "In a game",
      currentlyPlaying: "Doom",
      lastActive: 1_700_000_100,
      seen,
    },
  });
}

function chatEvent(
  senderPriv: Uint8Array,
  senderPub: string,
  recipientPub: string,
  envelope: Record<string, unknown>
): NostrEvent {
  return buildChatEvent({
    senderPrivateKey: senderPriv,
    recipientPubkey: recipientPub,
    envelope: {
      v: 3,
      sender: senderPub,
      recipient: recipientPub,
      rev: 1,
      updatedAt: Date.now(),
      ...envelope,
    } as ChatEnvelope,
  });
}

/** Flush the engine's promise chains without touching the fake clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

/** Advance the fake clock and flush everything the timers started. */
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle();
}

function startEngine(adapter: FriendsSyncAdapter, relay: FakeRelay) {
  const engine = new FriendsSyncEngine({
    relay,
    adapter,
    now: () => Date.now(),
    random: () => 0,
  });
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FriendsSyncEngine", () => {
  it("publishes one snapshot per peer and skips an unchanged payload", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    state.accepted.add(carolPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    expect(engine.getStatus().phase).toBe("online");
    expect(relay.recipients(relay.stateEvents())).toEqual(
      [bobPub, carolPub].sort()
    );

    // Same content: nothing goes out, even after the debounce and gap.
    engine.requestPublish();
    await advance(2000);
    await advance(5000);
    expect(relay.stateEvents()).toHaveLength(2);

    // One local change fans out to both peers, once each.
    state.revision += 1;
    engine.requestPublish();
    await advance(2000);
    await advance(5000);
    expect(relay.stateEvents()).toHaveLength(4);
    expect(relay.recipients(relay.stateEvents().slice(2))).toEqual(
      [bobPub, carolPub].sort()
    );
  });

  it("ignores a duplicate event id and a stale revision", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    const fresh = snapshotEvent(bobPriv, bobPub, alicePub, 5, 1_000);
    relay.emit(fresh);
    await settle();
    expect(state.applied).toHaveLength(1);

    relay.emit(fresh);
    await settle();
    expect(state.applied).toHaveLength(1);

    const stale = snapshotEvent(bobPriv, bobPub, alicePub, 3, 500);
    relay.emit(stale);
    await settle();
    expect(state.applied).toHaveLength(1);
    expect(state.applied[0].payload.rev).toBe(5);
  });

  it("never applies or publishes for a blocked peer", async () => {
    const { adapter, state } = createFakeAdapter();
    state.blocked.add(carolPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    expect(relay.recipients(relay.stateEvents())).not.toContain(carolPub);

    relay.emit(snapshotEvent(carolPriv, carolPub, alicePub, 9, 1_000));
    await settle();

    expect(state.applied).toHaveLength(0);
    expect(state.invites).toHaveLength(0);

    engine.blockPeer(carolPub);
    engine.requestPublish();
    await advance(2000);
    await advance(5000);
    expect(relay.recipients(relay.stateEvents())).not.toContain(carolPub);
  });

  it("surfaces an invite for an unknown sender and publishes on accept", async () => {
    const { adapter, state } = createFakeAdapter();
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    relay.published.length = 0;

    relay.emit(
      chatEvent(davePriv, davePub, alicePub, {
        type: "request",
        profile: { name: "Dave" },
        at: Date.now(),
      })
    );
    await settle();

    expect(state.invites).toHaveLength(1);
    expect(state.invites[0].peer).toBe(davePub);
    expect(state.invites[0].profile.name).toBe("Dave");
    expect(relay.published).toHaveLength(0);

    engine.acceptFriend(davePub);
    await settle();

    const chats = relay.chatEvents();
    expect(chats).toHaveLength(1);
    expect(chats[0].event.tags.some((tag) => tag[0] === "p" && tag[1] === davePub)).toBe(true);
    expect(relay.recipients(relay.stateEvents())).toEqual([davePub]);
  });

  it("treats a snapshot from a peer we invited as acceptance", async () => {
    const { adapter, state } = createFakeAdapter();
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    relay.published.length = 0;

    engine.sendFriendRequest(bobPub);
    await settle();
    expect(state.outgoing.has(bobPub)).toBe(true);
    expect(relay.chatEvents()).toHaveLength(1);

    relay.emit(snapshotEvent(bobPriv, bobPub, alicePub, 1, 1_000));
    await settle();

    expect(state.accepted.has(bobPub)).toBe(true);
    expect(state.applied).toHaveLength(1);
    expect(relay.recipients(relay.stateEvents())).toEqual([bobPub]);
  });

  it("replays an unanswered request on start and every ten minutes, then stops once accepted", async () => {
    const { adapter, state } = createFakeAdapter();
    state.pending.add(bobPub);
    state.outgoing.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    // The request that was queued while the peer was offline goes out again.
    expect(relay.recipients(relay.chatEvents())).toEqual([bobPub]);

    await advance(10 * 60_000);
    expect(relay.chatEvents()).toHaveLength(2);

    engine.acceptFriend(bobPub);
    await settle();
    const afterAccept = relay.chatEvents().length;
    expect(afterAccept).toBe(3);

    // Accepted: the replay loop must not ask again.
    await advance(10 * 60_000);
    expect(relay.chatEvents()).toHaveLength(afterAccept);
  });

  it("resends a pending request on demand but never for an accepted or blocked peer", async () => {
    const { adapter, state } = createFakeAdapter();
    state.pending.add(bobPub);
    state.outgoing.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    expect(relay.chatEvents()).toHaveLength(1);

    engine.resendRequest(bobPub);
    await settle();
    expect(relay.chatEvents()).toHaveLength(2);

    state.outgoing.delete(bobPub);
    state.pending.delete(bobPub);
    state.accepted.add(bobPub);
    engine.resendRequest(bobPub);
    await settle();
    expect(relay.chatEvents()).toHaveLength(2);

    state.accepted.delete(bobPub);
    state.blocked.add(bobPub);
    engine.resendRequest(bobPub);
    await settle();
    expect(relay.chatEvents()).toHaveLength(2);
  });

  it("never replays a request for a blocked peer", async () => {
    const { adapter, state } = createFakeAdapter();
    state.pending.add(bobPub);
    state.outgoing.add(bobPub);
    state.blocked.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    expect(relay.chatEvents()).toHaveLength(0);

    await advance(10 * 60_000);
    expect(relay.chatEvents()).toHaveLength(0);
  });

  it("retries three times, then records the error and goes offline", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    relay.refuseAll = true;
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    expect(engine.getStatus().pendingPublish).toBeGreaterThan(0);
    expect(engine.getStatus().phase).toBe("offline");

    await advance(2000);
    await advance(8000);
    await advance(30000);
    await settle();

    const status = engine.getStatus();
    expect(status.pendingPublish).toBe(0);
    expect(status.lastError).toMatch(/refused/);
    expect(status.phase).toBe("offline");
  });

  it("reports degraded when only one relay accepts", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    relay.accepted = new Set([RELAY_ONE]);
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    const status = engine.getStatus();
    expect(status.phase).toBe("degraded");
    expect(status.relayStatus[RELAY_ONE]).toBe("accepted");
    expect(status.relayStatus[RELAY_TWO]).toBe("failed");
  });

  it("publishes chat immediately, records delivery and applies read receipts", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    relay.published.length = 0;

    engine.sendChat(bobPub, {
      type: "message",
      id: "m1",
      threadId: "dm_pair",
      body: "hello",
      sentAt: Date.now(),
    });
    await settle();

    expect(relay.chatEvents()).toHaveLength(1);
    expect(state.delivered).toHaveLength(1);
    expect(state.delivered[0].envelope).toMatchObject({
      type: "message",
      id: "m1",
    });

    relay.emit(
      chatEvent(bobPriv, bobPub, alicePub, {
        type: "read",
        threadId: "dm_pair",
        upTo: 1234,
        at: Date.now(),
      })
    );
    await settle();

    const read = state.chat.find((entry) => entry.payload.type === "read");
    expect(read?.payload).toMatchObject({ type: "read", upTo: 1234 });
  });

  it("moves idle -> connecting -> online and records the peer's seen revision", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    const phases: FriendsSyncPhase[] = [];
    engine.subscribeStatus((status) => {
      if (phases[phases.length - 1] !== status.phase) phases.push(status.phase);
    });

    expect(engine.getStatus().phase).toBe("idle");
    engine.start();
    expect(engine.getStatus().phase).toBe("connecting");
    await settle();

    expect(engine.getStatus().phase).toBe("online");
    expect(phases).toEqual(["connecting", "online"]);

    relay.emit(presenceEvent(bobPriv, bobPub, alicePub, { [alicePub]: 7 }));
    await settle();

    const peer = engine.getStatus().peers[bobPub];
    expect(peer.seenByPeer).toBe(7);
    // Our own published revision is exposed too, so the UI can compare
    // "delivered" (lastPublishedRev) with "seen" (seenByPeer).
    expect(typeof peer.lastPublishedRev).toBe("number");
    expect(peer.lastPublishedRev).toBeGreaterThan(0);
    expect(peer.presence?.currentlyPlaying).toBe("Doom");
    expect(state.presence).toHaveLength(1);
  });

  it("stop() closes subscriptions and clears every timer", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    expect(relay.subscriptions.length).toBe(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    engine.stop();

    expect(relay.subscriptions.every((subscription) => subscription.closed)).toBe(
      true
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.getStatus().phase).toBe("idle");
    expect(engine.getStatus().peers).toEqual({});
  });

  it("resubscribes with backoff when a subscription drops", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    expect(relay.subscriptions.length).toBe(2);

    relay.drop(["relay closed"]);
    await settle();
    expect(engine.getStatus().lastError).toMatch(/relay closed/);

    await advance(1000);
    expect(relay.subscriptions.length).toBe(4);
  });

  it("lists every configured relay as idle on start and flips it after a pass", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    // Known before any network work, so the UI can render "not checked yet".
    expect(engine.getStatus().relayStatus).toEqual({
      [RELAY_ONE]: "idle",
      [RELAY_TWO]: "idle",
    });

    await settle();
    expect(engine.getStatus().relayStatus).toEqual({
      [RELAY_ONE]: "accepted",
      [RELAY_TWO]: "accepted",
    });

    relay.accepted = new Set([RELAY_ONE]);
    await engine.syncNow();
    expect(engine.getStatus().relayStatus).toEqual({
      [RELAY_ONE]: "accepted",
      [RELAY_TWO]: "failed",
    });
  });

  it("marks a manual sync running before it finishes and ends ok", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();

    const seen: string[] = [];
    engine.subscribeStatus((status) => seen.push(status.manualSync));

    const pass = engine.syncNow();
    expect(engine.getStatus().manualSync).toBe("running");
    await pass;

    const status = engine.getStatus();
    expect(status.manualSync).toBe("ok");
    expect(status.manualSyncFinishedAt).not.toBeNull();
    expect(status.phase).toBe("online");
    expect(seen[0]).toBe("running");
    expect(seen[seen.length - 1]).toBe("ok");
  });

  it("republishes a byte-identical snapshot on a manual sync", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    expect(relay.stateEvents()).toHaveLength(1);

    await engine.syncNow();

    // The content did not change, yet the forced pass sent it again.
    const events = relay.stateEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event.id).not.toBe(events[1].event.id);

    // The ordinary debounced path still skips the same content.
    engine.requestPublish();
    await advance(2000);
    await advance(5000);
    expect(relay.stateEvents()).toHaveLength(2);
  });

  it("reports a partial manual sync when one relay refuses", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    relay.accepted = new Set([RELAY_ONE]);
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    const before = engine.getStatus().lastSyncedAt;
    expect(before).not.toBeNull();

    await advance(1000);
    await engine.syncNow();

    const status = engine.getStatus();
    expect(status.manualSync).toBe("partial");
    expect(status.phase).toBe("degraded");
    expect(status.lastSyncedAt).toBeGreaterThan(before as number);
    expect(status.relayStatus[RELAY_ONE]).toBe("accepted");
    expect(status.relayStatus[RELAY_TWO]).toBe("failed");
  });

  it("fails the manual sync when no relay answers and keeps the chat cursor", async () => {
    const { adapter, state } = createFakeAdapter();
    state.accepted.add(bobPub);
    const relay = new FakeRelay();
    relay.refuseAll = true;
    const engine = startEngine(adapter, relay);

    engine.start();
    await settle();
    const before = engine.getStatus().lastSyncedAt;
    expect(before).not.toBeNull();

    await advance(1000);
    await engine.syncNow();

    const status = engine.getStatus();
    expect(status.manualSync).toBe("failed");
    expect(status.phase).toBe("offline");
    expect(status.lastSyncedAt).toBe(before);

    const chatWindows = () =>
      relay.queries
        .filter((entry) => entry.filter.kinds?.includes(1059))
        .map((entry) => entry.filter.since);
    const first = chatWindows();
    await engine.syncNow();
    const second = chatWindows();
    // The cursor never advanced, so the next read replays the same window.
    expect(second[second.length - 1]).toBe(first[first.length - 1]);
  });
});
