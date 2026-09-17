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
  useAchievements: () => ({ cache: null }),
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
