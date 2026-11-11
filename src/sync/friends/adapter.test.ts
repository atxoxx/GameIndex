import { webcrypto } from "node:crypto";

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dmThreadId,
  getNostrKeys,
  initNostrKeys,
  loadDms,
  loadFriends,
  loadSessions,
  saveDms,
  saveFriends,
  saveSessions,
  saveUserProfile,
  type DmThread,
  type Friend,
} from "../../pages/friendsStorage";
import type { Game } from "../../types/game";
import { createFriendsSyncAdapter } from "./adapter";
import { toSharedGameInputs } from "./sharedGames";
import type { SnapshotEnvelope } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => null,
}));

if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const bobPriv = generateSecretKey();
const bobPub = getPublicKey(bobPriv);

let me = "";
let errorSpy: ReturnType<typeof vi.spyOn>;

function friendRecord(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend_bob",
    name: "Bob",
    avatar: "procedural",
    status: "Offline",
    addedAt: 1,
    syncId: bobPub,
    consent: "accepted",
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<SnapshotEnvelope> = {}
): SnapshotEnvelope {
  return {
    v: 3,
    type: "snapshot",
    sender: bobPub,
    recipient: me,
    rev: 3,
    updatedAt: 5_000,
    profile: { name: "Bob" },
    friends: [me],
    seen: {},
    ...overrides,
  };
}

beforeAll(async () => {
  await initNostrKeys();
  me = getNostrKeys().publicKey;
});

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  sessionStorage.clear();
  saveUserProfile({
    name: "Alice",
    avatar: "procedural",
    status: "Ready to Play!",
    syncId: me,
  });
});

afterAll(() => {
  errorSpy?.mockRestore();
});

describe("createFriendsSyncAdapter", () => {
  it("re-keys a legacy name-addressed DM thread onto the pair's pubkeys", () => {
    saveFriends([friendRecord()]);
    const legacy: DmThread = {
      id: dmThreadId("Alice", "Bob"),
      participants: ["Alice", "Bob"],
      messages: [{ id: "m1", author: "Alice", text: "hi", timestamp: 1_000 }],
      updatedAt: 1_000,
      lastReadAt: { Bob: 900 },
    };
    saveDms([legacy]);

    const adapter = createFriendsSyncAdapter();
    const pending = adapter.pendingChat(bobPub);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: "message",
      id: "m1",
      body: "hi",
      threadId: dmThreadId(me, bobPub),
    });

    const stored = loadDms();
    const migrated = stored.find((thread) => thread.id === dmThreadId(me, bobPub));
    expect(migrated).toBeTruthy();
    expect(migrated?.participants).toEqual([me, bobPub]);
    expect(migrated?.lastReadAt).toEqual({ [bobPub]: 900 });
    // Nothing is deleted during the migration.
    expect(stored).toHaveLength(1);
  });

  it("merges inbound messages and read receipts by pubkey", () => {
    saveFriends([friendRecord()]);
    const adapter = createFriendsSyncAdapter();
    const threadId = dmThreadId(me, bobPub);

    adapter.applyChat(bobPub, {
      v: 3,
      type: "message",
      sender: bobPub,
      recipient: me,
      rev: 1,
      updatedAt: 2_000,
      id: "m2",
      threadId,
      body: "yo",
      sentAt: 2_000,
    });

    let thread = loadDms().find((candidate) => candidate.id === threadId);
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0].author).toBe("Bob");
    expect(thread?.messages[0].text).toBe("yo");

    adapter.applyChat(bobPub, {
      v: 3,
      type: "read",
      sender: bobPub,
      recipient: me,
      rev: 1,
      updatedAt: 3_000,
      threadId,
      upTo: 2_000,
      at: 3_000,
    });

    thread = loadDms().find((candidate) => candidate.id === threadId);
    expect(thread?.lastReadAt).toEqual({ [bobPub]: 2_000 });
  });

  it("records delivery so the same message is not re-sent", () => {    saveFriends([friendRecord()]);
    const adapter = createFriendsSyncAdapter();
    const threadId = dmThreadId(me, bobPub);
    adapter.applyChat(bobPub, {
      v: 3,
      type: "message",
      sender: me,
      recipient: bobPub,
      rev: 1,
      updatedAt: 2_000,
      id: "m3",
      threadId,
      body: "outbound",
      sentAt: 2_000,
    });

    expect(adapter.pendingChat(bobPub)).toHaveLength(1);
    const [envelope] = adapter.pendingChat(bobPub);
    adapter.markChatDelivered(bobPub, envelope);
    expect(adapter.pendingChat(bobPub)).toHaveLength(0);
  });

  it("replays an undelivered read receipt until the peer confirms it", () => {
    localStorage.setItem("gamelib.friends.read_receipts_enabled", "true");
    saveFriends([friendRecord()]);
    const threadId = dmThreadId(me, bobPub);
    saveDms([
      {
        id: threadId,
        participants: [me, bobPub],
        messages: [],
        updatedAt: 1_000,
        lastReadAt: { [me]: 1_500 },
      },
    ]);

    const adapter = createFriendsSyncAdapter();
    const first = adapter.pendingChat(bobPub);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "read", upTo: 1_500 });

    adapter.markChatDelivered(bobPub, first[0]);
    expect(adapter.pendingChat(bobPub)).toHaveLength(0);
  });

  it("never replays a read receipt while the user keeps them switched off", () => {
    saveFriends([friendRecord()]);
    saveDms([
      {
        id: dmThreadId(me, bobPub),
        participants: [me, bobPub],
        messages: [],
        updatedAt: 1_000,
        lastReadAt: { [me]: 1_500 },
      },
    ]);

    const adapter = createFriendsSyncAdapter();
    expect(adapter.pendingChat(bobPub)).toHaveLength(0);
  });

  it("applies a peer snapshot to their friend record and merges sessions", async () => {
    saveFriends([friendRecord()]);
    saveSessions([]);
    const adapter = createFriendsSyncAdapter();

    await adapter.applySnapshot(
      bobPub,
      snapshot({
        profile: {
          name: "Bobby",
          status: "In a game",
          currentlyPlaying: "Doom",
          bio: "hello",
        },
        sessions: [
          {
            id: "s1",
            title: "Deep Rock",
            gameName: "Deep Rock",
            startsAt: Date.parse("2026-02-01T18:00:00Z"),
            durationMinutes: 90,
            updatedAt: 4_000,
          },
        ],
      })
    );

    const friend = loadFriends().find((candidate) => candidate.syncId === bobPub);
    expect(friend?.name).toBe("Bobby");
    expect(friend?.status).toBe("In a game");
    expect(friend?.currentlyPlaying).toBe("Doom");

    const session = loadSessions().find((candidate) => candidate.id === "s1");
    expect(session?.gameName).toBe("Deep Rock");
    expect(session?.durationMin).toBe(90);
    expect(session?.creatorName).toBe("Bobby");
  });

  it("ignores snapshots from a blocked peer", async () => {
    saveFriends([friendRecord({ blocked: true })]);
    const adapter = createFriendsSyncAdapter();

    await adapter.applySnapshot(bobPub, snapshot({ profile: { name: "Hacked" } }));

    const friend = loadFriends().find((candidate) => candidate.syncId === bobPub);
    expect(friend?.name).toBe("Bob");
  });

  it("keeps consent bookkeeping in sync with the friend graph", () => {
    const adapter = createFriendsSyncAdapter();

    adapter.outgoingRequest(bobPub);
    expect(adapter.hasOutgoingRequest(bobPub)).toBe(true);
    expect(adapter.peers().pending).toEqual([bobPub]);
    expect(adapter.isAccepted(bobPub)).toBe(false);

    adapter.acceptPeer(bobPub);
    expect(adapter.isAccepted(bobPub)).toBe(true);
    expect(adapter.peers().accepted).toEqual([bobPub]);

    adapter.blockPeer(bobPub);
    expect(adapter.isBlocked(bobPub)).toBe(true);
    expect(adapter.peers().blocked).toEqual([bobPub]);
    expect(adapter.peers().accepted).toEqual([]);
  });

  it("puts the library-derived stats registered through setSharedGames into a snapshot", () => {
    localStorage.setItem("gamelib.friends.nostr_share_scope", "full");
    saveFriends([friendRecord()]);
    const library = [
      { id: "g1", name: "Hades", playTime: "12h 30m" },
      { id: "g2", name: "Balatro", playTime: "45m" },
    ] as unknown as Game[];

    const adapter = createFriendsSyncAdapter();
    adapter.setSharedGames(() => toSharedGameInputs(library));

    const payload = adapter.buildSnapshot(bobPub);
    expect(
      payload.games?.map((game) => ({
        id: game.gameId,
        name: game.name,
        minutes: game.minutes,
      }))
    ).toEqual([
      { id: "g1", name: "Hades", minutes: 750 },
      { id: "g2", name: "Balatro", minutes: 45 },
    ]);

    // Standard (core) shares the same capped library: it powers the Compare
    // tab and the achievement race, so it is not a "full only" field.
    localStorage.setItem("gamelib.friends.nostr_share_scope", "core");
    expect(adapter.buildSnapshot(bobPub).games).toHaveLength(2);

    // Unmounting the provider clears the reference: no games are shared.
    localStorage.setItem("gamelib.friends.nostr_share_scope", "full");
    adapter.setSharedGames(null);
    expect(adapter.buildSnapshot(bobPub).games).toEqual([]);
  });

  it("keeps every cached profile field a core snapshot omits", async () => {
    const libStats = {
      gamesCount: 42,
      playtimeMinutes: 1234,
      achievementsCount: 7,
    };
    saveFriends([
      friendRecord({
        avatar: "avatar-cached",
        status: "In a game",
        favoriteGame: "Hades",
        bio: "cached bio",
        region: "EU-West",
        libStats,
      }),
    ]);
    const adapter = createFriendsSyncAdapter();

    // A core snapshot: no favourite game, no bio, no region, no libStats.
    await adapter.applySnapshot(
      bobPub,
      snapshot({ profile: { name: "Bob", status: "In a game" } })
    );

    let friend = loadFriends().find((candidate) => candidate.syncId === bobPub);
    expect(friend?.favoriteGame).toBe("Hades");
    expect(friend?.bio).toBe("cached bio");
    expect(friend?.region).toBe("EU-West");
    expect(friend?.libStats).toEqual(libStats);
    expect(friend?.avatar).toBe("avatar-cached");
    expect(friend?.status).toBe("In a game");

    // A full snapshot carries the values, so they replace the cached ones.
    await adapter.applySnapshot(
      bobPub,
      snapshot({
        rev: 4,
        updatedAt: 6_000,
        profile: {
          name: "Bob",
          avatar: "avatar-fresh",
          status: "Ready to Play!",
          favoriteGame: "Balatro",
          bio: "fresh bio",
          region: "NA-East",
          libStats: {
            gamesCount: 50,
            playtimeMinutes: 2_000,
            achievementsCount: 9,
          },
        },
      })
    );

    friend = loadFriends().find((candidate) => candidate.syncId === bobPub);
    expect(friend?.favoriteGame).toBe("Balatro");
    expect(friend?.bio).toBe("fresh bio");
    expect(friend?.region).toBe("NA-East");
    expect(friend?.avatar).toBe("avatar-fresh");
    expect(friend?.status).toBe("Ready to Play!");
    expect(friend?.libStats).toEqual({
      gamesCount: 50,
      playtimeMinutes: 2_000,
      achievementsCount: 9,
    });
  });

  it("sends no read receipt while receipts are off and keeps the local marker", () => {
    localStorage.setItem("gamelib.friends.read_receipts_enabled", "false");
    saveFriends([friendRecord()]);
    const threadId = dmThreadId(me, bobPub);
    saveDms([
      {
        id: threadId,
        participants: [me, bobPub],
        messages: [
          { id: "m1", author: "Alice", text: "waiting for delivery", timestamp: 1_000 },
        ],
        updatedAt: 1_000,
        // Marked read locally (the unread badge is already cleared) but never
        // acknowledged to the peer.
        lastReadAt: { [me]: 1_500 },
      },
    ]);

    const adapter = createFriendsSyncAdapter();
    const pending = adapter.pendingChat(bobPub);

    expect(pending.map((envelope) => envelope.type)).toEqual(["message"]);
    // The local read marker survives the replay pass, so unread badges keep
    // working even though nothing leaves the device.
    const thread = loadDms().find((candidate) => candidate.id === threadId);
    expect(thread?.lastReadAt?.[me]).toBe(1_500);
  });
});
