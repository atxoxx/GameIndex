import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import {
  NOSTR_RELAYS,
  getLastRelayStatus,
  getNostrShareScope,
  initNostrKeys,
  isNostrIdentityReady,
  onRelayStatusChange,
  publishNostrOutbox,
  remoteFriendsInclude,
  scopeNostrPayload,
  setNostrShareScope,
  loadFriends,
  loadRecommendations,
  loadSuggestions,
  mergeDms,
  mergeRecommendations,
  mergeSessions,
  mergeSuggestions,
  buildOutboxPayload,
  loadUserProfile,
  visibleMessages,
  dmThreadId,
  startDmThreadId,
} from "./friendsStorage";
import type { NostrOutboxPayload } from "./friendsStorage";

// ── Mocks ────────────────────────────────────────────────────────────
//
// `invokeState` and `relayPublishMock` are hoisted so they survive
// `vi.resetModules()` (used by the identity tests to get a fresh module
// with an empty key cache).
const invokeState = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args?: unknown }>,
  impl: (async (_command: string, _args?: unknown) => null) as (
    command: string,
    args?: unknown,
  ) => Promise<unknown>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string, args?: unknown) => {
    invokeState.calls.push({ command, args });
    return invokeState.impl(command, args);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const relayPublishMock = vi.hoisted(() => vi.fn());

// SimplePool is mocked so no real WebSocket ever opens.
vi.mock("nostr-tools/pool", () => ({
  SimplePool: vi.fn().mockImplementation(function () {
    return {
      subscribeMany: vi.fn(() => ({ close: vi.fn() })),
      publish: relayPublishMock,
      get: vi.fn(async () => null),
    };
  }),
}));

// Contexts consumed by useFriendsData.
vi.mock("../context/GameContext", () => ({
  useGames: () => ({ games: [], runningGameIds: [] }),
}));
vi.mock("../context/AchievementContext", () => ({
  useAchievements: () => ({ summaries: {}, rarestUnlocks: [], recentUnlocks: [] }),
}));
vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../context/SettingsContext", () => ({
  useSettings: () => ({ dmReadReceipts: false }),
}));

import { useFriendsData } from "../hooks/useFriendsData";

// @noble (via nostr-tools) needs a real getRandomValues; jsdom may not
// expose one.
try {
  if (!globalThis.crypto?.getRandomValues) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
} catch {
  /* ignore — tests that don't sign still run */
}

const LS_PROFILE_A = "gamelib.friends.profile.A";
const LS_FRIENDS_A = "gamelib.friends.list.A";
const LS_SCOPE = "gamelib.friends.nostr_share_scope";
const LS_LEGACY_PUBLISH = "gamelib.friends.nostr_public_publish";
const LS_NOSTR_PRIVKEY = "gamelib.friends.nostr_privkey";

const FRIEND_ID = "c".repeat(64);

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI__", { value: {}, configurable: true });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makePayload(overrides: Partial<NostrOutboxPayload> = {}): NostrOutboxPayload {
  return {
    syncId: "self",
    profile: {
      name: "Me",
      avatar: "data:image/png;base64,AAAA",
      status: "Ready",
      favoriteGame: "Favorite",
      currentlyPlaying: "Game X",
      bio: "hello",
      region: "EU",
      lastActive: 123,
      libStats: { gamesCount: 10, playtimeMinutes: 500, achievementsCount: 3 },
    },
    friends: ["aaa", "bbb"],
    games: [{ id: "g1", name: "Lib Game", playTimeMin: 100, achievementPercent: 10, genres: ["RPG"] }],
    sessions: [
      {
        id: "s1",
        gameId: "g1",
        gameName: "Game X",
        scheduledAt: "2026-01-01T20:00",
        maxPlayers: 4,
        description: "co-op night",
        creatorName: "Me",
        attendees: ["Me", "Other"],
        rsvps: { Me: "going", Other: "maybe" },
        updatedAt: 1,
        participants: [{ name: "Other", role: "player" }],
        messages: [{ id: "m1", author: "Other", text: "hi", timestamp: 1 }],
        invited: ["Other"],
        poll: { options: [{ id: "o1", label: "8pm" }], votes: { o1: ["Other"] } },
      },
    ],
    recommendations: [
      {
        id: "r1",
        gameId: "g1",
        gameName: "Game X",
        recommendedBy: "Me",
        recommendedTo: "All Friends",
        reason: "great",
        rating: 5,
        comments: [{ id: "c1", authorName: "Other", text: "agree", timestamp: 1 }],
        reactions: { Other: "like" },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    suggestions: [
      {
        id: "sg1",
        gameId: "g2",
        gameName: "Wish Game",
        note: "try it",
        suggestedBy: "Me",
        suggestedTo: "All Friends",
        comments: [{ id: "c2", authorName: "Other", text: "nice", timestamp: 1 }],
        reactions: { Other: "interest" },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    updatedAt: 2,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invokeState.calls = [];
  invokeState.impl = async () => null;
  relayPublishMock.mockReset();
  relayPublishMock.mockImplementation(() => [Promise.resolve("ok")]);
});

/** Resolve the static module's identity once so publish tests can sign. */
async function ensureIdentityReady() {
  enableTauriRuntime();
  if (isNostrIdentityReady()) return;
  invokeState.impl = async (command: string) =>
    command === "get_friends_nostr_privkey" ? "d".repeat(64) : null;
  await initNostrKeys();
}

/** The kind-30078 event handed to the mocked pool by the last publish. */
function lastPublishedContent(): Record<string, unknown> {
  const call = relayPublishMock.mock.calls[relayPublishMock.mock.calls.length - 1];
  const event = call?.[1] as { content: string };
  return JSON.parse(event.content) as Record<string, unknown>;
}

describe("NOSTR_RELAYS", () => {
  it("exposes the public relay list once, as a readonly array", () => {
    expect(NOSTR_RELAYS).toHaveLength(4);
    expect(NOSTR_RELAYS).toContain("wss://relay.damus.io");
  });
});

describe("getNostrShareScope", () => {
  it("defaults to core when nothing is stored", () => {
    expect(getNostrShareScope()).toBe("core");
  });

  it("migrates the legacy opt-in flag to full", () => {
    localStorage.setItem(LS_LEGACY_PUBLISH, "true");
    expect(getNostrShareScope()).toBe("full");
  });

  it("treats a legacy flag of false as the new core default", () => {
    localStorage.setItem(LS_LEGACY_PUBLISH, "false");
    expect(getNostrShareScope()).toBe("core");
  });

  it("prefers the stored scope over the legacy flag", () => {
    localStorage.setItem(LS_SCOPE, "off");
    localStorage.setItem(LS_LEGACY_PUBLISH, "true");
    expect(getNostrShareScope()).toBe("off");
  });

  it("notifies subscribers and dispatches a window event on change", () => {
    const subscriber = vi.fn();
    const onWindowEvent = vi.fn();
    const unsubscribe = onRelayStatusChange(subscriber);
    window.addEventListener("gamelib:nostr-share-scope-changed", onWindowEvent);

    setNostrShareScope("full");

    expect(getNostrShareScope()).toBe("full");
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(onWindowEvent).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("gamelib:nostr-share-scope-changed", onWindowEvent);
  });
});

describe("scopeNostrPayload (core)", () => {
  it("drops the library dump, libStats and the favourite game", () => {
    const core = scopeNostrPayload(makePayload(), "core", new Set(["aaa"]));

    expect(core.games).toBeUndefined();
    expect(core.profile.libStats).toBeUndefined();
    expect(core.profile.favoriteGame).toBeUndefined();
    expect(core.profile.avatar).toBe("procedural");
    // Publisher-authored profile text is kept.
    expect(core.profile.name).toBe("Me");
    expect(core.profile.status).toBe("Ready");
    expect(core.profile.currentlyPlaying).toBe("Game X");
    expect(core.profile.bio).toBe("hello");
    expect(core.profile.region).toBe("EU");
    expect(core.profile.lastActive).toBe(123);
    // Blocked peers are removed from the broadcast friend graph.
    expect(core.friends).toEqual(["bbb"]);
  });

  it("keeps publisher-authored session text and strips other people's content", () => {
    const core = scopeNostrPayload(makePayload(), "core");
    const session = core.sessions[0] as unknown as Record<string, unknown>;

    expect(session.description).toBe("co-op night");
    expect(session.creatorName).toBe("Me");
    expect(session.gameName).toBe("Game X");
    expect(session.maxPlayers).toBe(4);
    expect(session.scheduledAt).toBe("2026-01-01T20:00");
    expect((session.poll as { options: unknown }).options).toEqual([{ id: "o1", label: "8pm" }]);

    expect(session.participants).toBeUndefined();
    expect(session.messages).toBeUndefined();
    expect(session.rsvps).toBeUndefined();
    expect(session.attendees).toBeUndefined();
    expect(session.invited).toBeUndefined();
    expect((session.poll as Record<string, unknown>).votes).toBeUndefined();
  });

  it("strips comments and reactions from recommendations and suggestions", () => {
    const core = scopeNostrPayload(makePayload(), "core");
    const rec = core.recommendations[0] as unknown as Record<string, unknown>;
    const sug = core.suggestions[0] as unknown as Record<string, unknown>;

    expect(rec.reason).toBe("great");
    expect(rec.recommendedBy).toBe("Me");
    expect(rec.comments).toBeUndefined();
    expect(rec.reactions).toBeUndefined();

    expect(sug.note).toBe("try it");
    expect(sug.suggestedBy).toBe("Me");
    expect(sug.comments).toBeUndefined();
    expect(sug.reactions).toBeUndefined();
  });

  it("does not mutate the input payload", () => {
    const payload = makePayload();
    scopeNostrPayload(payload, "core");
    expect(payload.games).toHaveLength(1);
    expect(payload.profile.libStats).toBeDefined();
  });
});

describe("scopeNostrPayload (full)", () => {
  it("keeps games and libStats while still sanitizing", () => {
    const payload = makePayload();
    const full = scopeNostrPayload(payload, "full");

    expect(full).not.toBe(payload);
    expect(full.games).toHaveLength(1);
    expect(full.profile.libStats).toEqual({
      gamesCount: 10,
      playtimeMinutes: 500,
      achievementsCount: 3,
    });
    const session = full.sessions[0] as unknown as Record<string, unknown>;
    expect(session.participants).toHaveLength(1);
    expect(session.messages).toHaveLength(1);
    expect((session.poll as Record<string, unknown>).votes).toBeDefined();
    expect(full.recommendations[0].comments).toHaveLength(1);
    expect(full.recommendations[0].reactions).toBeDefined();
    // The photo avatar is forced procedural in both scopes.
    expect(full.profile.avatar).toBe("procedural");
  });

  it("strips dms and data-url avatars in both scopes", () => {
    for (const scope of ["core", "full"] as const) {
      const payload: NostrOutboxPayload = makePayload();
      (payload as unknown as Record<string, unknown>).dms = [{ id: "dm1" }];

      const out = scopeNostrPayload(payload, scope);

      expect("dms" in (out as unknown as Record<string, unknown>)).toBe(false);
      expect(out.profile.avatar).toBe("procedural");
    }
  });
});

describe("publishNostrOutbox", () => {
  it("does not open a relay publish when the scope is off", async () => {
    setNostrShareScope("off");
    relayPublishMock.mockClear();

    await publishNostrOutbox(makePayload());

    expect(relayPublishMock).not.toHaveBeenCalled();
    expect(getLastRelayStatus()).toEqual({});
  });

  it("publishes a core event that carries v2/scope and omits library + third-party data", async () => {
    await ensureIdentityReady();
    setNostrShareScope("core");
    relayPublishMock.mockClear();

    await publishNostrOutbox(makePayload());

    const content = lastPublishedContent();
    expect(content.v).toBe(2);
    expect(content.scope).toBe("core");
    expect(content.profile).toMatchObject({ avatar: "procedural", name: "Me" });
    expect(content.games).toBeUndefined();
    expect((content.profile as Record<string, unknown>).libStats).toBeUndefined();

    const session = (content.sessions as Array<Record<string, unknown>>)[0];
    expect(session.description).toBe("co-op night");
    expect(session.participants).toBeUndefined();
    expect(session.messages).toBeUndefined();
    expect(session.rsvps).toBeUndefined();
    expect(session.attendees).toBeUndefined();
    expect(session.invited).toBeUndefined();
    expect((session.poll as Record<string, unknown>).votes).toBeUndefined();
    expect((session.poll as { options: unknown[] }).options).toHaveLength(1);

    const rec = (content.recommendations as Array<Record<string, unknown>>)[0];
    expect(rec.reason).toBe("great");
    expect(rec.comments).toBeUndefined();
    expect(rec.reactions).toBeUndefined();

    const sug = (content.suggestions as Array<Record<string, unknown>>)[0];
    expect(sug.note).toBe("try it");
    expect(sug.comments).toBeUndefined();
    expect(sug.reactions).toBeUndefined();
  });

  it("publishes a full event that keeps third-party data and still sanitizes", async () => {
    await ensureIdentityReady();
    setNostrShareScope("full");
    relayPublishMock.mockClear();

    await publishNostrOutbox(makePayload());

    const content = lastPublishedContent();
    expect(content.v).toBe(2);
    expect(content.scope).toBe("full");
    expect((content.profile as Record<string, unknown>).avatar).toBe("procedural");
    expect(content.games).toHaveLength(1);
    expect((content.profile as { libStats: { gamesCount: number } }).libStats.gamesCount).toBe(10);

    const session = (content.sessions as Array<Record<string, unknown>>)[0];
    expect(session.participants).toHaveLength(1);
    expect(session.messages).toHaveLength(1);
    expect(session.rsvps).toBeDefined();
    expect((session.poll as Record<string, unknown>).votes).toBeDefined();

    expect((content.recommendations as Array<{ comments: unknown[] }>)[0].comments).toHaveLength(1);
    expect((content.suggestions as Array<{ comments: unknown[] }>)[0].comments).toHaveLength(1);
  });

  it("records a failed relay when the publish promise rejects", async () => {
    await ensureIdentityReady();
    setNostrShareScope("core");
    relayPublishMock.mockImplementation(() => [Promise.reject(new Error("relay down"))]);

    await publishNostrOutbox(makePayload());

    expect(getLastRelayStatus()[NOSTR_RELAYS[0]]).toBe("failed");
  });

  it("records a failed relay when the publish times out", async () => {
    await ensureIdentityReady();
    setNostrShareScope("core");
    vi.useFakeTimers();
    try {
      relayPublishMock.mockImplementation(() => [new Promise<string>(() => {})]);

      const publishPromise = publishNostrOutbox(makePayload());
      await vi.advanceTimersByTimeAsync(12000);
      await publishPromise;

      expect(getLastRelayStatus()[NOSTR_RELAYS[0]]).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending relay status when the sharing scope changes", async () => {
    await ensureIdentityReady();
    setNostrShareScope("core");
    await publishNostrOutbox(makePayload());
    expect(getLastRelayStatus()[NOSTR_RELAYS[0]]).toBe("accepted");

    const subscriber = vi.fn();
    const unsubscribe = onRelayStatusChange(subscriber);
    setNostrShareScope("off");

    expect(getLastRelayStatus()).toEqual({});
    expect(subscriber).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("remoteFriendsInclude", () => {
  it("matches both the string-pubkey and Friend-object shapes", () => {
    expect(remoteFriendsInclude(["aaa", FRIEND_ID], FRIEND_ID)).toBe(true);
    expect(remoteFriendsInclude([{ syncId: "aaa" }, { syncId: FRIEND_ID }], FRIEND_ID)).toBe(true);
    expect(remoteFriendsInclude(["aaa"], FRIEND_ID)).toBe(false);
    expect(remoteFriendsInclude([{ syncId: "aaa" }], FRIEND_ID)).toBe(false);
    expect(remoteFriendsInclude(undefined, FRIEND_ID)).toBe(false);
    expect(remoteFriendsInclude(["aaa"], "")).toBe(false);
  });
});

describe("identity lifecycle", () => {
  it("is not ready before init resolves and never persists the placeholder syncId", async () => {
    localStorage.clear();
    enableTauriRuntime();
    localStorage.setItem(
      LS_PROFILE_A,
      JSON.stringify({ name: "Me", avatar: "procedural", status: "Ready", syncId: "stored-sync-id" }),
    );

    vi.resetModules();
    const storage = await import("./friendsStorage");

    const gate = deferred<string | null>();
    invokeState.impl = async (command: string) => {
      if (command === "get_friends_nostr_privkey") return gate.promise;
      return null;
    };

    const pending = storage.initNostrKeys();
    expect(storage.isNostrIdentityReady()).toBe(false);

    // Unresolved identity returns the STORED syncId (not the session
    // placeholder) and writes nothing.
    const display = storage.loadUserProfile();
    expect(display.syncId).toBe("stored-sync-id");
    expect(JSON.parse(localStorage.getItem(LS_PROFILE_A)!).syncId).toBe("stored-sync-id");

    gate.resolve("a".repeat(64));
    await pending;
    expect(storage.isNostrIdentityReady()).toBe(true);
  });

  it("dedupes concurrent initNostrKeys callers to a single key mint", async () => {
    localStorage.clear();
    enableTauriRuntime();

    vi.resetModules();
    const storage = await import("./friendsStorage");

    const gate = deferred<string | null>();
    invokeState.impl = async (command: string) => {
      if (command === "get_friends_nostr_privkey") return gate.promise;
      return null;
    };

    const first = storage.initNostrKeys();
    const second = storage.initNostrKeys();
    gate.resolve(null);
    await Promise.all([first, second]);

    const getCalls = invokeState.calls.filter((c) => c.command === "get_friends_nostr_privkey");
    const setCalls = invokeState.calls.filter((c) => c.command === "set_friends_nostr_privkey");
    expect(getCalls).toHaveLength(1);
    expect(setCalls).toHaveLength(1);
  });
});

describe("friend profile sync scope handling", () => {
  it("does not overwrite a cached friend's libStats with a core/v2 payload", async () => {
    await ensureIdentityReady();
    localStorage.setItem(LS_NOSTR_PRIVKEY, "b".repeat(64));
    localStorage.setItem(
      LS_PROFILE_A,
      JSON.stringify({ name: "Me", avatar: "procedural", status: "Ready", syncId: "self" }),
    );
    localStorage.setItem(
      LS_FRIENDS_A,
      JSON.stringify([
        {
          id: "friend_1",
          name: "Friend",
          avatar: "procedural",
          status: "Ready",
          addedAt: 1,
          syncId: FRIEND_ID,
          libStats: { gamesCount: 5, playtimeMinutes: 100, achievementsCount: 2 },
        },
      ]),
    );

    const remoteCoreOutbox = {
      v: 2,
      scope: "core",
      syncId: FRIEND_ID,
      profile: { name: "Friend", avatar: "procedural", status: "Ready" },
      sessions: [],
      recommendations: [],
      suggestions: [],
    };

    invokeState.impl = async (command: string) => {
      switch (command) {
        case "load_friends_db":
          return JSON.stringify({ profile: null });
        case "get_friends_sync_dir":
          return "C:/sync";
        case "get_friends_device_id":
          return "device_a";
        case "read_sync_file":
          return JSON.stringify(remoteCoreOutbox);
        default:
          return null;
      }
    };

    const { result } = renderHook(() => useFriendsData());

    await waitFor(() => expect(loadFriends()[0]?.lastSeen).toBeTruthy());
    expect(loadFriends()[0].libStats).toEqual({
      gamesCount: 5,
      playtimeMinutes: 100,
      achievementsCount: 2,
    });
    expect(result.current.friends[0].libStats).toEqual({
      gamesCount: 5,
      playtimeMinutes: 100,
      achievementsCount: 2,
    });
  });
});

describe("merge tolerates core-scoped payloads", () => {
  it("merges a remote recommendation that lost its comments and reactions", () => {
    const localRec = makePayload().recommendations[0];
    const coreRec = scopeNostrPayload(makePayload(), "core").recommendations[0];
    expect(coreRec.comments).toBeUndefined();

    const merged = mergeRecommendations([localRec], [coreRec]);

    expect(merged).toHaveLength(1);
    expect(merged[0].comments.map((c) => c.id)).toEqual(["c1"]);
    expect(merged[0].reactions).toEqual({ Other: "like" });
  });

  it("normalizes a brand-new remote recommendation without comments", () => {
    const coreRec = scopeNostrPayload(makePayload(), "core").recommendations[0];

    const merged = mergeRecommendations([], [{ ...coreRec, id: "r2" }]);

    expect(merged[0].comments).toEqual([]);
    expect(merged[0].reactions).toEqual({});
  });

  it("merges a remote suggestion that lost its comments and reactions", () => {
    const localSug = makePayload().suggestions[0];
    const coreSug = scopeNostrPayload(makePayload(), "core").suggestions[0];
    expect(coreSug.comments).toBeUndefined();

    const merged = mergeSuggestions([localSug], [coreSug]);

    expect(merged[0].comments.map((c) => c.id)).toEqual(["c2"]);
    expect(merged[0].reactions).toEqual({ Other: "interest" });
  });

  it("merges a core-scoped session missing attendees and poll votes", () => {
    const localSession = makePayload().sessions[0];
    const coreSession = scopeNostrPayload(makePayload(), "core").sessions[0];
    expect(coreSession.attendees).toBeUndefined();

    const mergedLocalWins = mergeSessions([localSession], [coreSession]);
    expect(mergedLocalWins[0].attendees).toEqual(expect.arrayContaining(["Me", "Other"]));
    expect(mergedLocalWins[0].poll?.votes["o1"]).toEqual(["Other"]);

    const mergedRemoteWins = mergeSessions([localSession], [{ ...coreSession, updatedAt: 99 }]);
    expect(mergedRemoteWins[0].attendees).toEqual(["Me"]);
  });
});

describe("load normalization", () => {
  it("defaults missing comments and reactions on stored records", () => {
    localStorage.setItem(
      "gamelib.friends.recommendations.A",
      JSON.stringify([
        {
          id: "r9",
          gameId: "g1",
          gameName: "Game X",
          recommendedBy: "Me",
          recommendedTo: "All Friends",
          reason: "",
          rating: 5,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    localStorage.setItem(
      "gamelib.friends.suggestions.A",
      JSON.stringify([
        {
          id: "sg9",
          gameId: "g2",
          gameName: "Wish Game",
          note: "",
          suggestedBy: "Me",
          suggestedTo: "All Friends",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    expect(loadRecommendations()[0].comments).toEqual([]);
    expect(loadRecommendations()[0].reactions).toEqual({});
    expect(loadSuggestions()[0].comments).toEqual([]);
    expect(loadSuggestions()[0].reactions).toEqual({});
  });
});

describe("message tombstones", () => {
  const thread = (messages: any[], overrides: Record<string, unknown> = {}) => ({
    id: "dm_Me_Other",
    participants: ["Me", "Other"],
    messages,
    updatedAt: 20,
    ...overrides,
  });

  it("does not resurrect a locally deleted message when the peer still has it", () => {
    const deleted = { id: "m1", author: "Me", text: "oops", timestamp: 10, deleted: true };
    const peerCopy = { id: "m1", author: "Me", text: "oops", timestamp: 10 };

    const merged = mergeDms([thread([deleted])], [thread([peerCopy])], "Me");

    expect(merged[0].messages[0].deleted).toBe(true);
    expect(visibleMessages(merged[0].messages)).toHaveLength(0);
  });

  it("keeps reactions from both copies while the tombstone unions", () => {
    const local = { id: "m1", author: "Me", text: "hi", timestamp: 10, deleted: true, reactions: { Me: "👍" } };
    const remote = { id: "m1", author: "Me", text: "hi", timestamp: 10, reactions: { Other: "🔥" } };

    const merged = mergeDms([thread([local])], [thread([remote])], "Me");

    expect(merged[0].messages[0].deleted).toBe(true);
    expect(merged[0].messages[0].reactions).toEqual({ Me: "👍", Other: "🔥" });
  });

  it("ignores a thread tombstone from a conversation we take no part in", () => {
    const mine = thread([]);
    const foreignTombstone = {
      id: mine.id,
      participants: ["Someone", "Else"],
      messages: [],
      updatedAt: 99,
      deleted: true,
    };

    const merged = mergeDms([mine], [foreignTombstone], "Me");

    expect(merged).toHaveLength(1);
    expect(merged[0].deleted).toBeFalsy();
  });

  it("unions a session message tombstone across a merge", () => {
    const baseSession = {
      id: "s1",
      gameId: "g1",
      gameName: "Game X",
      scheduledAt: "2026-01-01T20:00",
      maxPlayers: 4,
      description: "",
      creatorName: "Me",
      attendees: ["Me"],
      updatedAt: 5,
      messages: [{ id: "m1", author: "Me", text: "removed", timestamp: 10, deleted: true }],
    };
    const remoteSession = {
      ...baseSession,
      updatedAt: 6,
      messages: [{ id: "m1", author: "Me", text: "removed", timestamp: 10 }],
    };

    const merged = mergeSessions([baseSession], [remoteSession]);

    expect(merged[0].messages?.[0].deleted).toBe(true);
  });
});

describe("profile normalization", () => {
  it("preserves presence and shared stats across a load", () => {
    localStorage.setItem(
      "gamelib.friends.profile.A",
      JSON.stringify({
        name: "Me",
        avatar: "procedural",
        status: "Ready to Play!",
        syncId: "",
        lastActive: 1234,
        lastPublished: 500,
        libStats: { gamesCount: 3, playtimeMinutes: 120, achievementsCount: 7 },
      }),
    );

    const profile = loadUserProfile();

    expect(profile.lastActive).toBe(1234);
    expect(profile.lastPublished).toBe(500);
    expect(profile.libStats).toEqual({ gamesCount: 3, playtimeMinutes: 120, achievementsCount: 7 });
  });
});

describe("folder outbox payload", () => {
  it("omits blocked peers from the broadcast friend graph", () => {
    const allowed = "a".repeat(64);
    const blocked = "b".repeat(64);
    localStorage.setItem(
      "gamelib.friends.list.A",
      JSON.stringify([
        { id: "f1", name: "Allowed", avatar: "procedural", status: "", addedAt: 1, syncId: allowed },
        { id: "f2", name: "Blocked", avatar: "procedural", status: "", addedAt: 2, syncId: blocked, blocked: true },
      ]),
    );

    const payload = buildOutboxPayload(
      { name: "Me", avatar: "procedural", status: "Ready", syncId: allowed },
      { gamesCount: 0, playtimeMinutes: 0, achievementsCount: 0 },
      [],
      [],
      [],
      [],
      [],
    );

    expect(payload.friends).toEqual([allowed]);
  });
});

describe("startDmThreadId", () => {
  it("uses the shared deterministic id when no tombstone exists", () => {
    const id = startDmThreadId("Me", "Ada");

    expect(id).toBe(dmThreadId("Me", "Ada"));
    expect(id).toBe(startDmThreadId("Ada", "Me"));
  });

  it("starts a fresh thread when the deterministic id was deleted", () => {
    const deleted = { id: dmThreadId("Me", "Ada"), participants: ["Ada", "Me"], messages: [], updatedAt: 1, deleted: true };

    const id = startDmThreadId("Me", "Ada", [deleted]);

    expect(id).not.toBe(deleted.id);
    expect(id.startsWith(deleted.id)).toBe(true);
  });
});
