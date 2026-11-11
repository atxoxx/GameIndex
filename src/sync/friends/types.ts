/**
 * Wire types for the v3 friends sync protocol.
 *
 * These are deliberately loose snapshots of what travels over a relay. They
 * describe JSON only: no React, no Tauri, no imports from friendsStorage.
 */

export type SharedProfile = {
  name?: string;
  avatar?: string;
  status?: string;
  favoriteGame?: string;
  currentlyPlaying?: string;
  bio?: string;
  region?: string;
  lastActive?: number;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
};

export type SharedGameStat = {
  gameId: string;
  name: string;
  minutes: number;
  lastPlayed: number;
  coverUrl?: string;
};

export type SharedSession = {
  id: string;
  title: string;
  gameName: string;
  startsAt: number;
  durationMinutes: number;
  status?: string;
  updatedAt: number;
  deleted?: boolean;
  participants?: unknown[];
  messages?: unknown[];
  rsvps?: unknown[];
};

export type SharedRecommendation = {
  id: string;
  fromName: string;
  fromSyncId: string;
  gameName: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  reactions?: unknown;
  comments?: unknown;
};

export type SharedSuggestion = SharedRecommendation;

export type ChatAttachment = {
  name?: string;
  mimeType?: string;
  dataUrl: string;
  size?: number;
  width?: number;
  height?: number;
};

export type EnvelopeType =
  | "presence"
  | "snapshot"
  | "message"
  | "read"
  | "request"
  | "accept";

/** Common header on every encrypted envelope. Timestamps are milliseconds. */
export type EnvelopeBase = {
  v: 3;
  type: EnvelopeType;
  sender: string;
  recipient: string;
  rev: number;
  updatedAt: number;
};

export type SeenMap = Record<string, number>;

export type PresenceEnvelope = EnvelopeBase & {
  type: "presence";
  status: string;
  currentlyPlaying: string | null;
  lastActive: number;
  seen: SeenMap;
};

/**
 * `truncated` records the reductions applied by `fitSnapshot`, in order:
 * `games-limited-to-200`, `sessions-limited-to-100`,
 * `recommendations-limited-to-100`, `suggestions-limited-to-100`,
 * `games-dropped`.
 */
export type SnapshotEnvelope = EnvelopeBase & {
  type: "snapshot";
  profile: SharedProfile;
  friends: string[];
  games?: SharedGameStat[];
  sessions?: SharedSession[];
  recommendations?: SharedRecommendation[];
  suggestions?: SharedSuggestion[];
  truncated?: string[];
  seen: SeenMap;
};

export type ChatMessageEnvelope = EnvelopeBase & {
  type: "message";
  id: string;
  threadId: string;
  body: string;
  sentAt: number;
  attachment?: ChatAttachment;
  attachmentDropped?: boolean;
};

export type ChatReadEnvelope = EnvelopeBase & {
  type: "read";
  threadId: string;
  upTo: number;
  at: number;
};

export type ChatRequestEnvelope = EnvelopeBase & {
  type: "request";
  profile: SharedProfile;
  at: number;
};

export type ChatAcceptEnvelope = EnvelopeBase & {
  type: "accept";
  at: number;
};

export type ChatEnvelope =
  | ChatMessageEnvelope
  | ChatReadEnvelope
  | ChatRequestEnvelope
  | ChatAcceptEnvelope;

export type FriendsEnvelope =
  | PresenceEnvelope
  | SnapshotEnvelope
  | ChatEnvelope;

export type ParseRelayError =
  | "bad-signature"
  | "bad-version"
  | "not-for-me"
  | "decrypt-failed"
  | "malformed"
  | "stale";

export type ParsedPresence = {
  sender: string;
  kind: "presence";
  payload: PresenceEnvelope;
};

export type ParsedSnapshot = {
  sender: string;
  kind: "snapshot";
  payload: SnapshotEnvelope;
};

export type ParsedChat = {
  sender: string;
  kind: "chat";
  payload: ChatEnvelope;
};

export type ParsedRelayEvent = ParsedPresence | ParsedSnapshot | ParsedChat;

export type ParseFailure = { error: ParseRelayError };

export type ParseRelayEventResult = ParsedRelayEvent | ParseFailure;

export type SnapshotVersion = Pick<SnapshotEnvelope, "rev" | "updatedAt">;
