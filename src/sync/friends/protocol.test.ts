import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type NostrEvent,
} from "nostr-tools/pure";

import {
  FRIENDS_SYNC_VERSION,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_STATE_BYTES,
  PRESENCE_D_TAG_PREFIX,
  STATE_D_TAG_PREFIX,
  SnapshotTooLargeError,
  buildChatEvent,
  buildPresenceEvent,
  buildStateEvent,
  decodeFriendCode,
  encodeFriendCode,
  fitChatAttachment,
  fitSnapshot,
  isNewerSnapshot,
  isStateDTagForMe,
  nextRev,
  normalizePubkey,
  parseRelayEvent,
  presenceDTagFor,
  resourceUrlFor,
  stateDTagFor,
} from "./protocol";
import type {
  ChatAttachment,
  ChatEnvelope,
  ChatMessageEnvelope,
  PresenceEnvelope,
  SharedGameStat,
  SharedRecommendation,
  SharedSession,
  SnapshotEnvelope,
} from "./types";

// Noble builds keys from crypto.getRandomValues; jsdom does not always
// expose it, and the whole suite needs real keys.
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

const STREAM_KIND = 30078;
const CHAT_WRAP_KIND = 1059;

const nowSec = () => Math.floor(Date.now() / 1000);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

function baseHeader(
  sender: string,
  recipient: string
): Omit<PresenceEnvelope, "type" | "status" | "currentlyPlaying" | "lastActive" | "seen"> {
  return {
    v: FRIENDS_SYNC_VERSION,
    sender,
    recipient,
    rev: 1,
    updatedAt: 1_700_000_000_000,
  };
}

function presence(
  sender: string,
  recipient: string,
  seen: Record<string, number> = { [recipient]: 1_700_000_000_000 }
): PresenceEnvelope {
  return {
    ...baseHeader(sender, recipient),
    type: "presence",
    status: "Online",
    currentlyPlaying: "Hades II",
    lastActive: 1_700_000_000_000,
    seen,
  };
}

function snapshot(
  sender: string,
  recipient: string,
  partial: Partial<SnapshotEnvelope> = {}
): SnapshotEnvelope {
  return {
    ...baseHeader(sender, recipient),
    type: "snapshot",
    profile: {
      name: "Alice",
      avatar: "procedural",
      status: "Online",
      lastActive: 1_700_000_000_000,
      libStats: { gamesCount: 12, playtimeMinutes: 900, achievementsCount: 4 },
    },
    friends: [carolPub],
    games: [],
    sessions: [],
    recommendations: [],
    suggestions: [],
    seen: { [recipient]: 1_700_000_000_000 },
    ...partial,
  };
}

function chatMessage(
  sender: string,
  recipient: string,
  partial: Partial<ChatMessageEnvelope> = {}
): ChatMessageEnvelope {
  return {
    ...baseHeader(sender, recipient),
    type: "message",
    id: "m1",
    threadId: "t1",
    body: "gg",
    sentAt: 1_700_000_000_000,
    ...partial,
  };
}

function signedStream(
  envelope: unknown,
  senderPriv: Uint8Array,
  recipientPub: string,
  stream: "presence" | "snapshot",
  createdAt = nowSec()
): NostrEvent {
  const content = encrypt(
    JSON.stringify(envelope),
    getConversationKey(senderPriv, recipientPub)
  );
  return finalizeEvent(
    {
      kind: STREAM_KIND,
      created_at: createdAt,
      tags: [
        [
          "d",
          stream === "presence"
            ? presenceDTagFor(recipientPub)
            : stateDTagFor(recipientPub),
        ],
        ["p", recipientPub],
      ],
      content,
    },
    senderPriv
  );
}

function makeGames(
  count: number,
  coverSize: number,
  descendingMinutes = false
): SharedGameStat[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `game-${index}`,
    name: `Game ${index}`,
    minutes: descendingMinutes ? count - index : index,
    lastPlayed: 1_700_000_000_000 + index,
    coverUrl: `https://img.example/${"c".repeat(coverSize)}.jpg`,
  }));
}

function makeSessions(count: number, titleSize: number): SharedSession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `Session ${"s".repeat(titleSize)}${index}`,
    gameName: `Game ${index}`,
    startsAt: 1_700_000_000_000 + index * 1000,
    durationMinutes: 90,
    updatedAt: 1_700_000_000_000 + index,
  }));
}

function makeRecommendations(
  count: number,
  noteSize: number
): SharedRecommendation[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `rec-${index}`,
    fromName: "Alice",
    fromSyncId: alicePub,
    gameName: `Game ${index}`,
    note: "n".repeat(noteSize),
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  }));
}

describe("friend codes", () => {
  it("round-trips a pubkey through npub", () => {
    const code = encodeFriendCode(alicePub);
    expect(code.startsWith("npub1")).toBe(true);
    expect(decodeFriendCode(code)).toEqual({ pubkey: alicePub });
    expect(decodeFriendCode(`  ${code}\n`)).toEqual({ pubkey: alicePub });
    expect(decodeFriendCode(code.toUpperCase())).toEqual({ pubkey: alicePub });
  });

  it("accepts 64 hex in any case and trims whitespace", () => {
    expect(decodeFriendCode(alicePub.toUpperCase())).toEqual({
      pubkey: alicePub,
    });
    expect(decodeFriendCode(`\t ${alicePub}  `)).toEqual({ pubkey: alicePub });
    const mixed = `${alicePub.slice(0, 32).toUpperCase()}${alicePub.slice(32)}`;
    expect(decodeFriendCode(mixed)).toEqual({ pubkey: alicePub });
  });

  it("decodes legacy GMLF base64 payloads", () => {
    const pubkeyCode = `GMLF-${btoa(JSON.stringify({ sy: alicePub }))}`;
    expect(decodeFriendCode(pubkeyCode)).toEqual({ pubkey: alicePub });

    const deviceCode = `GMLF-${btoa(JSON.stringify({ sy: "device_legacy123" }))}`;
    expect(decodeFriendCode(deviceCode)).toEqual({
      legacyDeviceId: "device_legacy123",
    });

    expect(decodeFriendCode("GMLF-device_abc")).toEqual({
      legacyDeviceId: "device_abc",
    });
  });

  it("accepts bare legacy device ids", () => {
    expect(decodeFriendCode("device_123456")).toEqual({
      legacyDeviceId: "device_123456",
    });
  });

  it("returns null for garbage and never throws", () => {
    for (const input of [
      "",
      "   ",
      "hello",
      "npub1notreal",
      "GMLF-@@@",
      "GMLF-",
      "GMLF-AAAA",
      `${alicePub}00`,
    ]) {
      expect(decodeFriendCode(input)).toBeNull();
    }
    expect(decodeFriendCode(null as unknown as string)).toBeNull();
    expect(decodeFriendCode(undefined as unknown as string)).toBeNull();
  });

  it("normalizes pubkeys", () => {
    expect(normalizePubkey(` ${alicePub.toUpperCase()} `)).toBe(alicePub);
    expect(normalizePubkey("not-a-key")).toBeNull();
    expect(normalizePubkey(42)).toBeNull();
  });

  it("rejects an invalid pubkey when encoding", () => {
    expect(() => encodeFriendCode("nope")).toThrow(TypeError);
  });
});

describe("d-tags and relay urls", () => {
  it("builds the documented tag prefixes", () => {
    expect(FRIENDS_SYNC_VERSION).toBe(3);
    expect(STATE_D_TAG_PREFIX).toBe("gamelib-v3:state:");
    expect(PRESENCE_D_TAG_PREFIX).toBe("gamelib-v3:presence:");
    expect(stateDTagFor(bobPub)).toBe(`gamelib-v3:state:${bobPub}`);
    expect(presenceDTagFor(bobPub)).toBe(`gamelib-v3:presence:${bobPub}`);
  });

  it("only matches a state tag addressed to me", () => {
    expect(isStateDTagForMe(stateDTagFor(alicePub), alicePub)).toBe(true);
    expect(isStateDTagForMe(stateDTagFor(bobPub), alicePub)).toBe(false);
    expect(isStateDTagForMe("garbage", alicePub)).toBe(false);
    expect(isStateDTagForMe(stateDTagFor(alicePub), "bad")).toBe(false);
  });

  it("canonicalizes relay urls", () => {
    expect(resourceUrlFor("wss://relay.damus.io/")).toBe(
      "wss://relay.damus.io"
    );
    expect(resourceUrlFor("relay.damus.io")).toBe("wss://relay.damus.io");
    expect(resourceUrlFor("https://relay.example/path/")).toBe(
      "wss://relay.example/path"
    );
    expect(resourceUrlFor("http://localhost:7777")).toBe(
      "ws://localhost:7777"
    );
    expect(resourceUrlFor("ws://localhost:7777/")).toBe("ws://localhost:7777");
    expect(resourceUrlFor("ftp://relay.example")).toBe("");
    expect(resourceUrlFor("   ")).toBe("");
  });
});

describe("presence and snapshot round-trips", () => {
  it("round-trips presence with its seen map", () => {
    const seen = { [bobPub]: 11, [carolPub]: 22 };
    const envelope = presence(alicePub, bobPub, seen);
    const event = buildPresenceEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope,
    });

    expect(event.kind).toBe(STREAM_KIND);
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual(["d", presenceDTagFor(bobPub)]);
    expect(event.tags).toContainEqual(["p", bobPub]);

    const parsed = parseRelayEvent(event, bobPriv);
    expect(parsed).toEqual({
      sender: alicePub,
      kind: "presence",
      payload: envelope,
    });
    if ("kind" in parsed && parsed.kind === "presence") {
      expect(parsed.payload.seen).toEqual(seen);
    }
  });

  it("round-trips a snapshot with every optional collection", () => {
    const envelope = snapshot(alicePub, bobPub, {
      games: makeGames(2, 4),
      sessions: makeSessions(2, 4),
      recommendations: makeRecommendations(2, 4),
      suggestions: makeRecommendations(2, 4),
      truncated: ["games-limited-to-200"],
    });
    const event = buildStateEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope,
    });

    expect(event.tags).toContainEqual(["d", stateDTagFor(bobPub)]);
    const parsed = parseRelayEvent(event, bobPriv);
    expect(parsed).toEqual({
      sender: alicePub,
      kind: "snapshot",
      payload: envelope,
    });
  });

  it("normalizes an uppercase sender/recipient at build time", () => {
    const envelope = presence(alicePub.toUpperCase(), bobPub.toUpperCase());
    const event = buildPresenceEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope,
    });
    const parsed = parseRelayEvent(event, bobPriv);
    expect(parsed).toEqual({
      sender: alicePub,
      kind: "presence",
      payload: { ...envelope, sender: alicePub, recipient: bobPub },
    });
  });

  it("throws when the envelope identity does not match the keys", () => {
    expect(() =>
      buildPresenceEvent({
        senderPrivateKey: alicePriv,
        recipientPubkey: bobPub,
        envelope: presence(carolPub, bobPub),
      })
    ).toThrow(TypeError);
    expect(() =>
      buildStateEvent({
        senderPrivateKey: alicePriv,
        recipientPubkey: bobPub,
        envelope: snapshot(alicePub, carolPub),
      })
    ).toThrow(TypeError);
  });
});

describe("stream rejections", () => {
  it("rejects a tampered signature", () => {
    const event = buildPresenceEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope: presence(alicePub, bobPub),
    });
    const tampered = { ...event, content: `${event.content}A` };
    expect(parseRelayEvent(tampered, bobPriv)).toEqual({
      error: "bad-signature",
    });
  });

  it("rejects a valid signature on the wrong kind", () => {
    const event = finalizeEvent(
      { kind: 1, created_at: nowSec(), tags: [], content: "hi" },
      alicePriv
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a stream addressed to another recipient", () => {
    const event = buildPresenceEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: carolPub,
      envelope: presence(alicePub, carolPub),
    });
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "not-for-me" });
  });

  it("rejects ciphertext it cannot authenticate", () => {
    const event = buildPresenceEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope: presence(alicePub, bobPub),
    });
    const tampered = finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: `${event.content.slice(0, -4)}AAAA`,
      },
      alicePriv
    );
    expect(parseRelayEvent(tampered, bobPriv)).toEqual({
      error: "decrypt-failed",
    });
  });

  it("rejects ciphertext encrypted for someone else", () => {
    const envelope = presence(alicePub, bobPub);
    const event = finalizeEvent(
      {
        kind: STREAM_KIND,
        created_at: nowSec(),
        tags: [
          ["d", presenceDTagFor(bobPub)],
          ["p", bobPub],
        ],
        content: encrypt(
          JSON.stringify(envelope),
          getConversationKey(alicePriv, carolPub)
        ),
      },
      alicePriv
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({
      error: "decrypt-failed",
    });
  });

  it("rejects an envelope with the wrong version", () => {
    const event = signedStream(
      { ...presence(alicePub, bobPub), v: 2 },
      alicePriv,
      bobPub,
      "presence"
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "bad-version" });
  });

  it("rejects malformed JSON", () => {
    const event = signedStream("not json", alicePriv, bobPub, "presence");
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a valid JSON envelope with missing fields", () => {
    const event = signedStream(
      { ...baseHeader(alicePub, bobPub), type: "presence" },
      alicePriv,
      bobPub,
      "presence"
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a payload type that disagrees with its d-tag", () => {
    const event = signedStream(
      snapshot(alicePub, bobPub),
      alicePriv,
      bobPub,
      "presence"
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a spoofed envelope sender", () => {
    const event = signedStream(
      presence(carolPub, bobPub),
      alicePriv,
      bobPub,
      "presence"
    );
    expect(parseRelayEvent(event, bobPriv)).toMatchObject({
      error: "malformed",
    });
  });

  it("rejects an envelope recipient that is not me", () => {
    const event = signedStream(
      presence(alicePub, carolPub),
      alicePriv,
      bobPub,
      "presence"
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "not-for-me" });
  });

  it("rejects old and future timestamps", () => {
    const now = Date.now();
    const nowInSeconds = Math.floor(now / 1000);
    const envelope = presence(alicePub, bobPub);

    const old = signedStream(
      envelope,
      alicePriv,
      bobPub,
      "presence",
      nowInSeconds - 8 * 86400
    );
    expect(parseRelayEvent(old, bobPriv, { now })).toEqual({ error: "stale" });

    const future = signedStream(
      envelope,
      alicePriv,
      bobPub,
      "presence",
      nowInSeconds + 11 * 60
    );
    expect(parseRelayEvent(future, bobPriv, { now })).toEqual({
      error: "stale",
    });

    const fresh = signedStream(
      envelope,
      alicePriv,
      bobPub,
      "presence",
      nowInSeconds - 6 * 86400
    );
    expect(parseRelayEvent(fresh, bobPriv, { now })).toMatchObject({
      kind: "presence",
    });
  });

  it("rejects an oversized encrypted plaintext", () => {
    const event = signedStream(
      snapshot(alicePub, bobPub, { profile: { name: "x".repeat(70_000) } }),
      alicePriv,
      bobPub,
      "snapshot"
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects an oversized wire payload before decrypting", () => {
    const event = finalizeEvent(
      {
        kind: STREAM_KIND,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: "A".repeat(300_000),
      },
      alicePriv
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("never throws on junk input", () => {
    expect(parseRelayEvent(null as unknown as NostrEvent, bobPriv)).toEqual({
      error: "malformed",
    });
    expect(parseRelayEvent({} as NostrEvent, bobPriv)).toEqual({
      error: "malformed",
    });
    expect(
      parseRelayEvent(
        { kind: 30078, tags: null } as unknown as NostrEvent,
        bobPriv
      )
    ).toEqual({ error: "malformed" });
  });
});

describe("chat gift wrap", () => {
  it("recovers the sender and every chat envelope type", () => {
    const envelopes: ChatEnvelope[] = [
      chatMessage(alicePub, bobPub),
      chatMessage(alicePub, bobPub, {
        type: "message",
        id: "m2",
        body: "",
        attachment: {
          name: "shot.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          size: 3,
        },
        attachmentDropped: false,
      }),
      {
        ...baseHeader(alicePub, bobPub),
        type: "read",
        threadId: "t1",
        upTo: 99,
        at: 1_700_000_000_000,
      },
      {
        ...baseHeader(alicePub, bobPub),
        type: "request",
        profile: { name: "Alice" },
        at: 1_700_000_000_000,
      },
      {
        ...baseHeader(alicePub, bobPub),
        type: "accept",
        at: 1_700_000_000_000,
      },
    ];

    for (const envelope of envelopes) {
      const event = buildChatEvent({
        senderPrivateKey: alicePriv,
        recipientPubkey: bobPub,
        envelope,
      });

      expect(event.kind).toBe(CHAT_WRAP_KIND);
      expect(event.tags).toContainEqual(["p", bobPub]);
      expect(verifyEvent(event)).toBe(true);

      const rumor = unwrapEvent(event, bobPriv);
      expect(rumor.kind).toBe(4);
      expect(rumor.pubkey).toBe(alicePub);

      expect(parseRelayEvent(event, bobPriv)).toEqual({
        sender: alicePub,
        kind: "chat",
        payload: envelope,
      });
    }
  });

  it("rejects a wrap addressed to someone else", () => {
    const event = buildChatEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: carolPub,
      envelope: chatMessage(alicePub, carolPub),
    });
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "not-for-me" });
  });

  it("rejects a wrap it cannot open", () => {
    const ephemeral = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: CHAT_WRAP_KIND,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: encrypt(
          JSON.stringify({ v: 3 }),
          getConversationKey(ephemeral, carolPub)
        ),
      },
      ephemeral
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({
      error: "decrypt-failed",
    });
  });

  it("rejects a rumor that is not kind 4", () => {
    const event = wrapEvent(
      {
        kind: 1,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: JSON.stringify(chatMessage(alicePub, bobPub)),
      },
      alicePriv,
      bobPub
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a chat envelope with the wrong version", () => {
    const event = wrapEvent(
      {
        kind: 4,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: JSON.stringify({
          ...chatMessage(alicePub, bobPub),
          v: 2,
        }),
      },
      alicePriv,
      bobPub
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "bad-version" });
  });

  it("rejects a chat envelope with missing fields", () => {
    const event = wrapEvent(
      {
        kind: 4,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: JSON.stringify({
          ...baseHeader(alicePub, bobPub),
          type: "message",
          id: "m1",
        }),
      },
      alicePriv,
      bobPub
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a spoofed chat sender", () => {
    const event = wrapEvent(
      {
        kind: 4,
        created_at: nowSec(),
        tags: [["p", bobPub]],
        content: JSON.stringify(chatMessage(carolPub, bobPub)),
      },
      alicePriv,
      bobPub
    );
    expect(parseRelayEvent(event, bobPriv)).toEqual({ error: "malformed" });
  });

  it("rejects a tampered wrap signature", () => {
    const event = buildChatEvent({
      senderPrivateKey: alicePriv,
      recipientPubkey: bobPub,
      envelope: chatMessage(alicePub, bobPub),
    });
    const tampered = { ...event, content: `${event.content}A` };
    expect(parseRelayEvent(tampered, bobPriv)).toEqual({
      error: "bad-signature",
    });
  });
});

describe("isNewerSnapshot", () => {
  const cases: Array<{
    name: string;
    known: { rev: number; updatedAt: number } | null;
    incoming: { rev: number; updatedAt: number };
    expected: boolean;
  }> = [
    {
      name: "no known snapshot is always newer",
      known: null,
      incoming: { rev: 1, updatedAt: 1 },
      expected: true,
    },
    {
      name: "higher rev wins",
      known: { rev: 1, updatedAt: 100 },
      incoming: { rev: 2, updatedAt: 1 },
      expected: true,
    },
    {
      name: "lower rev loses even with a newer timestamp",
      known: { rev: 2, updatedAt: 100 },
      incoming: { rev: 1, updatedAt: 999 },
      expected: false,
    },
    {
      name: "equal rev and newer timestamp wins",
      known: { rev: 2, updatedAt: 100 },
      incoming: { rev: 2, updatedAt: 101 },
      expected: true,
    },
    {
      name: "equal rev and older timestamp loses",
      known: { rev: 2, updatedAt: 100 },
      incoming: { rev: 2, updatedAt: 99 },
      expected: false,
    },
    {
      name: "exact tie is not newer",
      known: { rev: 2, updatedAt: 100 },
      incoming: { rev: 2, updatedAt: 100 },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(isNewerSnapshot(testCase.known, testCase.incoming)).toBe(
        testCase.expected
      );
    });
  }
});

describe("nextRev", () => {
  it("increments, starts at one, and clamps", () => {
    expect(nextRev(null)).toBe(1);
    expect(nextRev(undefined)).toBe(1);
    expect(nextRev(0)).toBe(1);
    expect(nextRev(-10)).toBe(1);
    expect(nextRev(Number.NaN)).toBe(1);
    expect(nextRev(1.9)).toBe(2);
    expect(nextRev(41)).toBe(42);
    expect(nextRev(Number.MAX_SAFE_INTEGER - 1)).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(nextRev(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(nextRev(Number.MAX_SAFE_INTEGER + 1000)).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });
});

describe("fitSnapshot", () => {
  it("trims in the documented order and lands under the limit", () => {
    const original = snapshot(alicePub, bobPub, {
      games: makeGames(300, 1200, true),
      sessions: makeSessions(300, 40),
      recommendations: makeRecommendations(300, 0),
      suggestions: makeRecommendations(300, 0),
    });
    const before = JSON.stringify(original);

    const fitted = fitSnapshot(original);

    expect(JSON.stringify(original)).toBe(before);
    expect(fitted.truncated).toEqual([
      "games-limited-to-200",
      "sessions-limited-to-100",
      "recommendations-limited-to-100",
      "suggestions-limited-to-100",
      "games-dropped",
    ]);
    expect(fitted.games).toBeUndefined();
    expect(fitted.sessions).toHaveLength(100);
    expect(fitted.recommendations).toHaveLength(100);
    expect(fitted.suggestions).toHaveLength(100);
    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_STATE_BYTES);
  });

  it("caps games at the 200 most-played", () => {
    const games = makeGames(300, 300, true);
    const original = snapshot(alicePub, bobPub, {
      games,
      sessions: makeSessions(3, 4),
      recommendations: [],
      suggestions: [],
    });
    const expectedGames = [...games]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 200);
    const limit = bytes({
      ...original,
      games: expectedGames,
      truncated: ["games-limited-to-200"],
    });

    const fitted = fitSnapshot(original, { maxBytes: limit });

    expect(fitted.games?.map((game) => game.gameId)).toEqual(
      expectedGames.map((game) => game.gameId)
    );
    expect(fitted.sessions).toHaveLength(3);
    expect(fitted.truncated).toEqual(["games-limited-to-200"]);
    expect(bytes(fitted)).toBe(limit);
  });

  it("keeps the newest 100 sessions", () => {
    const sessions = makeSessions(300, 200);
    const original = snapshot(alicePub, bobPub, {
      games: [],
      sessions,
      recommendations: [],
      suggestions: [],
    });
    const expected = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
    const limit = bytes({
      ...original,
      sessions: expected,
      truncated: ["sessions-limited-to-100"],
    });

    const fitted = fitSnapshot(original, { maxBytes: limit });

    expect(fitted.sessions?.map((session) => session.id)).toEqual(
      expected.map((session) => session.id)
    );
    expect(fitted.games).toEqual([]);
    expect(fitted.truncated).toEqual(["sessions-limited-to-100"]);
  });

  it("counts UTF-8 bytes, not string length", () => {
    const maxBytes = 1200;
    const original = snapshot(alicePub, bobPub, {
      profile: { name: "é".repeat(600) },
      games: [],
      sessions: [],
      recommendations: [],
      suggestions: [],
    });

    expect(JSON.stringify(original).length).toBeLessThan(maxBytes);
    expect(bytes(original)).toBeGreaterThan(maxBytes);

    try {
      fitSnapshot(original, { maxBytes });
      throw new Error("expected fitSnapshot to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotTooLargeError);
      const typed = error as SnapshotTooLargeError;
      expect(typed.byteLength).toBeGreaterThan(maxBytes);
      expect(typed.maxBytes).toBe(maxBytes);
    }
  });

  it("throws when nothing left can be trimmed", () => {
    expect(() =>
      fitSnapshot(snapshot(alicePub, bobPub), { maxBytes: 10 })
    ).toThrow(SnapshotTooLargeError);
  });

  it("enforces the NIP-44 plaintext ceiling by default", () => {
    expect(MAX_STATE_BYTES).toBe(65535);
    const fitted = fitSnapshot(
      snapshot(alicePub, bobPub, { games: makeGames(400, 200, true) })
    );
    expect(fitted.games).toHaveLength(200);
    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_STATE_BYTES);
  });
});

describe("fitChatAttachment", () => {
  it("accepts an attachment exactly at the byte cap", () => {
    expect(MAX_CHAT_ATTACHMENT_BYTES).toBe(24000);
    const dataUrl = "a".repeat(MAX_CHAT_ATTACHMENT_BYTES);
    expect(fitChatAttachment({ dataUrl })).toEqual({ dataUrl });
  });

  it("rejects one byte over the cap", () => {
    expect(
      fitChatAttachment({ dataUrl: "a".repeat(MAX_CHAT_ATTACHMENT_BYTES + 1) })
    ).toBeNull();
  });

  it("measures UTF-8 bytes, not characters", () => {
    const attachment: ChatAttachment = { dataUrl: "é".repeat(12001) };
    expect(attachment.dataUrl.length).toBeLessThan(
      MAX_CHAT_ATTACHMENT_BYTES
    );
    expect(fitChatAttachment(attachment)).toBeNull();
  });

  it("honors a custom cap and a missing attachment", () => {
    expect(fitChatAttachment({ dataUrl: "abcde" }, { maxBytes: 5 })).toEqual({
      dataUrl: "abcde",
    });
    expect(
      fitChatAttachment({ dataUrl: "abcdef" }, { maxBytes: 5 })
    ).toBeNull();
    expect(fitChatAttachment(null)).toBeNull();
    expect(fitChatAttachment(undefined)).toBeNull();
    expect(fitChatAttachment({ dataUrl: "" })).toBeNull();
  });
});
