/**
 * Presentation-only views over the sync engine's status.
 *
 * The engine (`src/sync/friends`) owns networking and speaks in revisions and
 * timestamps; the UI only ever needs "are they around", "what are they
 * playing" and "did our last change reach them". These helpers keep that
 * translation in one place so the desktop roster and the Big Screen cards
 * cannot disagree, and so it can be unit-tested without React or Tauri.
 */

import type { FriendsSyncPhase, PeerSyncState } from "../../sync/friends/engine";

/** The presence heartbeat is 60s; allow a few missed beats before "offline". */
export const PEER_ONLINE_WINDOW_SECONDS = 300;

/** Bech32 `npub` inside arbitrary pasted text (charset excludes 1/b/i/o). */
const NPUB_IN_TEXT = /npub1[02-9ac-hj-np-z]{20,90}/i;

/**
 * The name the adapter gives a record it created from a pubkey alone. Until
 * the peer answers we have no profile for them, so showing this literal name
 * would be noise — the shortened key is the honest label.
 */
export const PENDING_PLACEHOLDER_NAME = "Gamer Syncing...";

/** Human label for a request we have no profile for yet. */
export function pendingPeerLabel(name: string | undefined, pubkey: string | undefined): string {
  const trimmed = (name || "").trim();
  if (trimmed && trimmed !== PENDING_PLACEHOLDER_NAME) return trimmed;
  const key = (pubkey || "").trim();
  if (!key) return trimmed;
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

/**
 * Pulls the first `npub` out of whatever the user pasted, so a code copied
 * inside a sentence ("my code is npub1… thanks!") still resolves.
 */
export function extractNpub(text: string): string | null {
  const match = NPUB_IN_TEXT.exec(text || "");
  return match ? match[0].toLowerCase() : null;
}

/** Epoch seconds of the peer's last heartbeat, or null when never seen. */
export function peerLastActiveSeconds(state: PeerSyncState | undefined): number | null {
  const lastActive = state?.presence?.lastActive;
  return typeof lastActive === "number" && Number.isFinite(lastActive) && lastActive > 0
    ? lastActive
    : null;
}

/** True when their heartbeat is recent enough to read as online. */
export function isPeerOnline(state: PeerSyncState | undefined, nowMs = Date.now()): boolean {
  const lastActive = peerLastActiveSeconds(state);
  if (lastActive === null) return false;
  return nowMs / 1000 - lastActive < PEER_ONLINE_WINDOW_SECONDS;
}

/** The game their presence reports, if it is a real one. */
export function peerCurrentlyPlaying(state: PeerSyncState | undefined): string | undefined {
  const playing = state?.presence?.currentlyPlaying;
  return typeof playing === "string" && playing.trim() ? playing.trim() : undefined;
}

export type DeliveryState = "seen" | "delivered" | "none";

/**
 * How far our latest state got.
 *
 * `seen` means their presence envelope reports a revision at least as new as
 * the one we last published. `delivered` means we published and they accepted
 * an event (or we have heard from them, so the relay path works) without their
 * presence catching up yet. `none` means no round-trip has completed.
 */
export function peerDeliveryState(state: PeerSyncState | undefined): DeliveryState {
  if (!state) return "none";
  const seen = state.seenByPeer;
  const published = state.lastPublishedRev;
  if (typeof seen === "number" && (typeof published !== "number" || seen >= published)) {
    return "seen";
  }
  if (typeof published === "number") return "delivered";
  if (typeof state.lastSeenAt === "number") return "delivered";
  return "none";
}

export type SyncPhaseTone = "idle" | "connecting" | "online" | "degraded" | "offline";

/**
 * Maps a phase plus pending work onto the four visual states the chip and the
 * modal dot understand. `pendingPublish > 0` reads as "still working", even
 * when the relay phase already says online.
 */
export function syncTone(phase: FriendsSyncPhase, pendingPublish = 0): SyncPhaseTone {
  if (phase === "idle") return "idle";
  if (phase === "connecting") return "connecting";
  if (phase === "degraded") return "degraded";
  if (phase === "offline") return "offline";
  return pendingPublish > 0 ? "connecting" : "online";
}
