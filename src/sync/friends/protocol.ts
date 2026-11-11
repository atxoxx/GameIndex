/**
 * Friends sync v3 wire protocol.
 *
 * One replaceable event per sender -> recipient for presence and snapshots,
 * NIP-59 gift wrap for chat. Pure module: no React, no invoke, no storage, no
 * timers, no module-level mutable state.
 */

import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { decode as nip19Decode, npubEncode } from "nostr-tools/nip19";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59";
import {
  finalizeEvent,
  getPublicKey,
  verifyEvent,
  type NostrEvent,
} from "nostr-tools/pure";

import type {
  ChatAttachment,
  ChatEnvelope,
  ParseRelayEventResult,
  PresenceEnvelope,
  SeenMap,
  SharedGameStat,
  SharedRecommendation,
  SharedSession,
  SnapshotEnvelope,
  SnapshotVersion,
} from "./types";

export const FRIENDS_SYNC_VERSION = 3;
export const STATE_D_TAG_PREFIX = "gamelib-v3:state:";
export const PRESENCE_D_TAG_PREFIX = "gamelib-v3:presence:";
export const MAX_STATE_BYTES = 65535;
export const MAX_CHAT_ATTACHMENT_BYTES = 24000;

const STREAM_KIND = 30078;
const CHAT_WRAP_KIND = 1059;
const CHAT_RUMOR_KIND = 4;

const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
// Base64 of a fully padded NIP-44 payload is ~116 kB at the 65535-byte
// plaintext ceiling; chat nests two of those, so leave room for the seal.
const MAX_WIRE_CONTENT_CHARS = 262144;

const GAMES_CAP = 200;
const COLLECTION_CAP = 100;

const TRUNCATED = {
  gamesLimited: "games-limited-to-200",
  sessionsLimited: "sessions-limited-to-100",
  recommendationsLimited: "recommendations-limited-to-100",
  suggestionsLimited: "suggestions-limited-to-100",
  gamesDropped: "games-dropped",
} as const;

export type DecodedFriendCode =
  | { pubkey: string }
  | { legacyDeviceId: string }
  | null;

/** `now` is in milliseconds (same unit as `Date.now()`). */
export type ParseRelayEventOptions = { now?: number };

export type BuildPresenceArgs = {
  senderPrivateKey: Uint8Array;
  recipientPubkey: string;
  envelope: PresenceEnvelope;
};

export type BuildStateArgs = {
  senderPrivateKey: Uint8Array;
  recipientPubkey: string;
  envelope: SnapshotEnvelope;
};

export type BuildChatArgs = {
  senderPrivateKey: Uint8Array;
  recipientPubkey: string;
  envelope: ChatEnvelope;
};

export type FitSnapshotOptions = { maxBytes?: number };
export type FitChatAttachmentOptions = { maxBytes?: number };

const textEncoder = new TextEncoder();

function jsonByteLength(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function normalizePubkey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

export function encodeFriendCode(pubkeyHex: string): string {
  const pubkey = normalizePubkey(pubkeyHex);
  if (!pubkey) throw new TypeError("encodeFriendCode expects a 32-byte hex pubkey");
  return npubEncode(pubkey);
}

export function decodeFriendCode(code: string): DecodedFriendCode {
  try {
    if (typeof code !== "string") return null;
    const trimmed = code.trim();
    if (!trimmed) return null;

    const direct = normalizePubkey(trimmed);
    if (direct) return { pubkey: direct };

    if (trimmed.toLowerCase().startsWith("npub1")) {
      try {
        const decoded = nip19Decode(trimmed.toLowerCase());
        if (decoded.type === "npub") {
          const pubkey = normalizePubkey(decoded.data);
          if (pubkey) return { pubkey };
        }
      } catch {
        // A broken bech32 string may still be a legacy code below.
      }
    }

    let candidate = trimmed;
    if (candidate.startsWith("GMLF-")) {
      const remainder = candidate.slice("GMLF-".length).trim();
      if (remainder.startsWith("device_")) return { legacyDeviceId: remainder };
      const decodedLegacy = decodeLegacyGmlfPayload(remainder);
      if (!decodedLegacy) return null;
      candidate = decodedLegacy;
    }

    if (candidate.startsWith("device_") && candidate.length > "device_".length) {
      return { legacyDeviceId: candidate };
    }

    const pubkey = normalizePubkey(candidate);
    return pubkey ? { pubkey } : null;
  } catch {
    return null;
  }
}

function decodeLegacyGmlfPayload(payload: string): string | null {
  try {
    const binary = atob(payload);
    let jsonText: string;
    try {
      jsonText = decodeURIComponent(
        Array.from(binary, (char) =>
          `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`
        ).join("")
      );
    } catch {
      jsonText = binary;
    }
    const parsed: unknown = JSON.parse(jsonText);
    if (isRecord(parsed) && typeof parsed.sy === "string" && parsed.sy.trim()) {
      return parsed.sy.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function stateDTagFor(pubkey: string): string {
  const normalized = normalizePubkey(pubkey);
  if (!normalized) throw new TypeError("stateDTagFor expects a 32-byte hex pubkey");
  return `${STATE_D_TAG_PREFIX}${normalized}`;
}

export function presenceDTagFor(pubkey: string): string {
  const normalized = normalizePubkey(pubkey);
  if (!normalized) {
    throw new TypeError("presenceDTagFor expects a 32-byte hex pubkey");
  }
  return `${PRESENCE_D_TAG_PREFIX}${normalized}`;
}

export function isStateDTagForMe(tag: string, myPubkey: string): boolean {
  const normalized = normalizePubkey(myPubkey);
  return normalized !== null && tag === `${STATE_D_TAG_PREFIX}${normalized}`;
}

/**
 * Canonical websocket URL for a relay entry. Accepts ws/wss/http/https and
 * bare hosts, converts http(s) to ws(s), and drops a trailing slash so the
 * same relay cannot be listed twice under different spellings.
 */
export function resourceUrlFor(relay: string): string {
  if (typeof relay !== "string") return "";
  let raw = relay.trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^http/i, "ws");
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!/^wss?:\/\//i.test(raw)) return "";
  } else raw = `wss://${raw}`;

  try {
    const url = new URL(raw);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    if (!url.hostname) return "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function buildPresenceEvent({
  senderPrivateKey,
  recipientPubkey,
  envelope,
}: BuildPresenceArgs): NostrEvent {
  return buildStreamEvent(senderPrivateKey, recipientPubkey, envelope, "presence");
}

export function buildStateEvent({
  senderPrivateKey,
  recipientPubkey,
  envelope,
}: BuildStateArgs): NostrEvent {
  return buildStreamEvent(senderPrivateKey, recipientPubkey, envelope, "snapshot");
}

export function buildChatEvent({
  senderPrivateKey,
  recipientPubkey,
  envelope,
}: BuildChatArgs): NostrEvent {
  const { sender, recipient } = resolveEnvelopeIdentity(
    envelope,
    senderPrivateKey,
    recipientPubkey
  );
  const normalized: ChatEnvelope = { ...envelope, sender, recipient };
  return wrapEvent(
    {
      kind: CHAT_RUMOR_KIND,
      created_at: nowSeconds(),
      tags: [["p", recipient]],
      content: JSON.stringify(normalized),
    },
    senderPrivateKey,
    recipient
  );
}

function buildStreamEvent<T extends PresenceEnvelope | SnapshotEnvelope>(
  senderPrivateKey: Uint8Array,
  recipientPubkey: string,
  envelope: T,
  stream: "presence" | "snapshot"
): NostrEvent {
  const { sender, recipient } = resolveEnvelopeIdentity(
    envelope,
    senderPrivateKey,
    recipientPubkey
  );
  const normalized = { ...envelope, sender, recipient };
  const dTag =
    stream === "presence" ? presenceDTagFor(recipient) : stateDTagFor(recipient);
  const conversationKey = getConversationKey(senderPrivateKey, recipient);

  return finalizeEvent(
    {
      kind: STREAM_KIND,
      created_at: nowSeconds(),
      tags: [
        ["d", dTag],
        ["p", recipient],
      ],
      content: encrypt(JSON.stringify(normalized), conversationKey),
    },
    senderPrivateKey
  );
}

function resolveEnvelopeIdentity(
  envelope: { sender: string; recipient: string },
  senderPrivateKey: Uint8Array,
  recipientPubkey: string
): { sender: string; recipient: string } {
  const sender = getPublicKey(senderPrivateKey);
  const recipient = normalizePubkey(recipientPubkey);
  if (!recipient) throw new TypeError("recipientPubkey must be 32-byte hex");
  if (normalizePubkey(envelope.sender) !== sender) {
    throw new TypeError("envelope.sender does not match senderPrivateKey");
  }
  if (normalizePubkey(envelope.recipient) !== recipient) {
    throw new TypeError("envelope.recipient does not match recipientPubkey");
  }
  return { sender, recipient };
}

export function parseRelayEvent(
  event: NostrEvent,
  myPrivateKey: Uint8Array,
  opts: ParseRelayEventOptions = {}
): ParseRelayEventResult {
  try {
    if (!isRelayEvent(event)) return { error: "malformed" };
    if (event.content.length > MAX_WIRE_CONTENT_CHARS) return { error: "malformed" };

    // Copy instead of verifying in place: the verified-symbol cache on the
    // caller's object must never be trusted for an untrusted relay event.
    const candidate: NostrEvent = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      sig: event.sig,
    };

    if (!verifyEvent(candidate)) return { error: "bad-signature" };
    if (candidate.kind !== STREAM_KIND && candidate.kind !== CHAT_WRAP_KIND) {
      return { error: "malformed" };
    }

    const now =
      opts.now !== undefined && Number.isFinite(opts.now) ? opts.now : Date.now();
    if (!isFresh(candidate.created_at, now)) return { error: "stale" };

    const myPubkey = getPublicKey(myPrivateKey);
    return candidate.kind === CHAT_WRAP_KIND
      ? parseChatEvent(candidate, myPrivateKey, myPubkey)
      : parseStreamEvent(candidate, myPrivateKey, myPubkey);
  } catch {
    return { error: "malformed" };
  }
}

function isFresh(createdAt: number, nowMs: number): boolean {
  const eventMs = createdAt * 1000;
  return (
    eventMs >= nowMs - MAX_EVENT_AGE_MS && eventMs <= nowMs + MAX_FUTURE_SKEW_MS
  );
}

function parseStreamEvent(
  event: NostrEvent,
  myPrivateKey: Uint8Array,
  myPubkey: string
): ParseRelayEventResult {
  if (!hasRecipientTag(event, myPubkey)) return { error: "not-for-me" };

  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (typeof dTag !== "string" || dTag.length === 0) {
    return { error: "malformed" };
  }

  const expectedType =
    dTag === presenceDTagFor(myPubkey)
      ? "presence"
      : dTag === stateDTagFor(myPubkey)
        ? "snapshot"
        : null;
  if (expectedType === null) return { error: "not-for-me" };

  let plaintext: string;
  try {
    plaintext = decrypt(
      event.content,
      getConversationKey(myPrivateKey, event.pubkey)
    );
  } catch {
    return { error: "decrypt-failed" };
  }

  if (textEncoder.encode(plaintext).length > MAX_STATE_BYTES) {
    return { error: "malformed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { error: "malformed" };
  }
  if (!isRecord(parsed)) return { error: "malformed" };
  if (parsed.v !== FRIENDS_SYNC_VERSION) return { error: "bad-version" };
  if (parsed.type !== expectedType) return { error: "malformed" };
  if (!hasBaseFields(parsed)) return { error: "malformed" };
  if (parsed.recipient !== myPubkey) return { error: "not-for-me" };
  if (parsed.sender !== event.pubkey) return { error: "malformed" };

  if (expectedType === "presence") {
    if (!isPresenceEnvelope(parsed)) return { error: "malformed" };
    return { sender: parsed.sender, kind: "presence", payload: parsed };
  }

  if (!isSnapshotEnvelope(parsed)) return { error: "malformed" };
  return { sender: parsed.sender, kind: "snapshot", payload: parsed };
}

function parseChatEvent(
  event: NostrEvent,
  myPrivateKey: Uint8Array,
  myPubkey: string
): ParseRelayEventResult {
  if (!hasRecipientTag(event, myPubkey)) return { error: "not-for-me" };

  let rumor: ReturnType<typeof unwrapEvent>;
  try {
    rumor = unwrapEvent(event, myPrivateKey);
  } catch {
    return { error: "decrypt-failed" };
  }

  if (rumor.kind !== CHAT_RUMOR_KIND) return { error: "malformed" };
  if (textEncoder.encode(rumor.content).length > MAX_STATE_BYTES) {
    return { error: "malformed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rumor.content);
  } catch {
    return { error: "malformed" };
  }
  if (!isRecord(parsed)) return { error: "malformed" };
  if (parsed.v !== FRIENDS_SYNC_VERSION) return { error: "bad-version" };
  if (!hasBaseFields(parsed)) return { error: "malformed" };
  if (parsed.recipient !== myPubkey) return { error: "not-for-me" };
  if (parsed.sender !== rumor.pubkey) return { error: "malformed" };
  if (!isChatEnvelope(parsed)) return { error: "malformed" };

  return { sender: parsed.sender, kind: "chat", payload: parsed };
}

function hasRecipientTag(event: NostrEvent, myPubkey: string): boolean {
  return event.tags.some(
    (tag) => tag[0] === "p" && normalizePubkey(tag[1]) === myPubkey
  );
}

function isRelayEvent(value: unknown): value is NostrEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.pubkey === "string" &&
    typeof value.created_at === "number" &&
    typeof value.kind === "number" &&
    typeof value.content === "string" &&
    typeof value.sig === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every(
      (tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string")
    )
  );
}

function hasBaseFields(value: Record<string, unknown>): boolean {
  return (
    value.v === FRIENDS_SYNC_VERSION &&
    typeof value.type === "string" &&
    normalizePubkey(value.sender) !== null &&
    normalizePubkey(value.recipient) !== null &&
    isFiniteNumber(value.rev) &&
    isFiniteNumber(value.updatedAt)
  );
}

function isPresenceEnvelope(value: unknown): value is PresenceEnvelope {
  if (!isRecord(value) || !hasBaseFields(value)) return false;
  return (
    value.type === "presence" &&
    typeof value.status === "string" &&
    (value.currentlyPlaying === null ||
      typeof value.currentlyPlaying === "string") &&
    isFiniteNumber(value.lastActive) &&
    isSeenMap(value.seen)
  );
}

function isSnapshotEnvelope(value: unknown): value is SnapshotEnvelope {
  if (!isRecord(value) || !hasBaseFields(value)) return false;
  return (
    value.type === "snapshot" &&
    isRecord(value.profile) &&
    isStringArray(value.friends) &&
    isOptionalRecordArray(value.games) &&
    isOptionalRecordArray(value.sessions) &&
    isOptionalRecordArray(value.recommendations) &&
    isOptionalRecordArray(value.suggestions) &&
    (value.truncated === undefined || isStringArray(value.truncated)) &&
    isSeenMap(value.seen)
  );
}

function isChatEnvelope(value: unknown): value is ChatEnvelope {
  if (!isRecord(value) || !hasBaseFields(value)) return false;
  switch (value.type) {
    case "message":
      return (
        typeof value.id === "string" &&
        typeof value.threadId === "string" &&
        typeof value.body === "string" &&
        isFiniteNumber(value.sentAt) &&
        (value.attachment === undefined || isChatAttachment(value.attachment)) &&
        (value.attachmentDropped === undefined ||
          typeof value.attachmentDropped === "boolean")
      );
    case "read":
      return (
        typeof value.threadId === "string" &&
        isFiniteNumber(value.upTo) &&
        isFiniteNumber(value.at)
      );
    case "request":
      return isRecord(value.profile) && isFiniteNumber(value.at);
    case "accept":
      return isFiniteNumber(value.at);
    default:
      return false;
  }
}

function isChatAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.dataUrl === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.mimeType === undefined || typeof value.mimeType === "string") &&
    (value.size === undefined || isFiniteNumber(value.size)) &&
    (value.width === undefined || isFiniteNumber(value.width)) &&
    (value.height === undefined || isFiniteNumber(value.height))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalRecordArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isRecord(item)))
  );
}

function isSeenMap(value: unknown): value is SeenMap {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

export function isNewerSnapshot(
  known: SnapshotVersion | null | undefined,
  incoming: SnapshotVersion
): boolean {
  if (!known) return true;
  if (!isFiniteNumber(incoming.rev) || !isFiniteNumber(incoming.updatedAt)) {
    return false;
  }
  if (!isFiniteNumber(known.rev) || !isFiniteNumber(known.updatedAt)) {
    return true;
  }
  if (incoming.rev !== known.rev) return incoming.rev > known.rev;
  return incoming.updatedAt > known.updatedAt;
}

export function nextRev(current?: number | null): number {
  if (current === null || current === undefined || !Number.isFinite(current)) {
    return 1;
  }
  const base = Math.floor(current);
  if (base >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, base + 1);
}

export class SnapshotTooLargeError extends Error {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(byteLength: number, maxBytes: number) {
    super(`Snapshot needs ${byteLength} bytes; the limit is ${maxBytes}`);
    this.name = "SnapshotTooLargeError";
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

/**
 * Fits a snapshot inside the NIP-44 plaintext ceiling. Reductions run in
 * order only while the encoded snapshot is still too large:
 * cap games (most-played) -> newest sessions -> recommendations ->
 * suggestions -> drop games entirely.
 */
export function fitSnapshot(
  envelope: SnapshotEnvelope,
  opts: FitSnapshotOptions = {}
): SnapshotEnvelope {
  const maxBytes = opts.maxBytes ?? MAX_STATE_BYTES;
  const current: SnapshotEnvelope = {
    ...envelope,
    profile: { ...envelope.profile },
    friends: [...envelope.friends],
    games: envelope.games ? [...envelope.games] : undefined,
    sessions: envelope.sessions ? [...envelope.sessions] : undefined,
    recommendations: envelope.recommendations
      ? [...envelope.recommendations]
      : undefined,
    suggestions: envelope.suggestions ? [...envelope.suggestions] : undefined,
    truncated: envelope.truncated ? [...envelope.truncated] : undefined,
    seen: { ...envelope.seen },
  };

  const over = () => jsonByteLength(current) > maxBytes;
  const mark = (reason: string) => {
    if (!current.truncated?.includes(reason)) {
      current.truncated = [...(current.truncated ?? []), reason];
    }
  };

  if (over() && current.games && current.games.length > GAMES_CAP) {
    current.games = [...current.games]
      .sort(byMostPlayed)
      .slice(0, GAMES_CAP);
    mark(TRUNCATED.gamesLimited);
  }

  if (
    over() &&
    current.sessions &&
    current.sessions.length > COLLECTION_CAP
  ) {
    current.sessions = [...current.sessions]
      .sort(byNewestSession)
      .slice(0, COLLECTION_CAP);
    mark(TRUNCATED.sessionsLimited);
  }

  if (
    over() &&
    current.recommendations &&
    current.recommendations.length > COLLECTION_CAP
  ) {
    current.recommendations = [...current.recommendations]
      .sort(byNewestRecommendation)
      .slice(0, COLLECTION_CAP);
    mark(TRUNCATED.recommendationsLimited);
  }

  if (
    over() &&
    current.suggestions &&
    current.suggestions.length > COLLECTION_CAP
  ) {
    current.suggestions = [...current.suggestions]
      .sort(byNewestRecommendation)
      .slice(0, COLLECTION_CAP);
    mark(TRUNCATED.suggestionsLimited);
  }

  if (over() && current.games !== undefined) {
    delete current.games;
    mark(TRUNCATED.gamesDropped);
  }

  const byteLength = jsonByteLength(current);
  if (byteLength > maxBytes) {
    throw new SnapshotTooLargeError(byteLength, maxBytes);
  }
  return current;
}

function byMostPlayed(a: SharedGameStat, b: SharedGameStat): number {
  return b.minutes - a.minutes;
}

function byNewestSession(a: SharedSession, b: SharedSession): number {
  return sessionStamp(b) - sessionStamp(a);
}

function sessionStamp(session: SharedSession): number {
  return Number.isFinite(session.updatedAt)
    ? session.updatedAt
    : session.startsAt;
}

function byNewestRecommendation(
  a: SharedRecommendation,
  b: SharedRecommendation
): number {
  return recommendationStamp(b) - recommendationStamp(a);
}

function recommendationStamp(item: SharedRecommendation): number {
  return Number.isFinite(item.updatedAt) ? item.updatedAt : item.createdAt;
}

export function fitChatAttachment<T extends ChatAttachment>(
  attachment: T | null | undefined,
  opts: FitChatAttachmentOptions = {}
): T | null {
  if (!attachment || typeof attachment.dataUrl !== "string") return null;
  if (attachment.dataUrl.length === 0) return null;

  const maxBytes = opts.maxBytes ?? MAX_CHAT_ATTACHMENT_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return null;
  if (textEncoder.encode(attachment.dataUrl).length > maxBytes) return null;
  return attachment;
}
