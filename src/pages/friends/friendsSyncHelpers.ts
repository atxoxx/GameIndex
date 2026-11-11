/**
 * Pure helpers shared by the Friends page controller and its UI.
 *
 * Two jobs, both derived purely from their arguments so they can be tested
 * without React, Tauri or the sync engine:
 *   - map a DM thread onto the peer pubkey its chat envelopes go to,
 *   - split the friend graph into the consent buckets the roster renders.
 */

import type { DmThread, Friend } from "../friendsStorage";

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

/** Lowercase 64-char hex, or null for anything that is not a pubkey. */
export function asPeerPubkey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return PUBKEY_PATTERN.test(trimmed) ? trimmed : null;
}

export type ThreadPeerContext = {
  /** Our own pubkey once the identity is loaded. */
  myPubkey?: string | null;
  /** Our own profile name, so a legacy name-keyed thread is recognised. */
  myName?: string;
};

/**
 * The peer a thread's chat envelopes belong to.
 *
 * Threads are name-keyed until the adapter re-keys them onto pubkeys, so a
 * participant can be either. Returns null whenever the answer would be a
 * guess — an unknown name, two friends sharing a name, a thread that is not
 * a pair, or an identity that is not loaded yet. Callers keep the local
 * message and skip the network send in that case.
 */
export function peerPubkeyForThread(
  thread: Pick<DmThread, "participants">,
  friends: readonly Friend[],
  context: ThreadPeerContext = {}
): string | null {
  const participants = thread?.participants ?? [];
  if (participants.length !== 2) return null;

  const myPubkey = asPeerPubkey(context.myPubkey);
  const myName = context.myName?.trim() || "";

  const byName = new Map<string, Set<string>>();
  for (const friend of friends) {
    const pubkey = asPeerPubkey(friend.syncId);
    if (!pubkey) continue;
    for (const name of [friend.name, friend.nickname]) {
      const key = name?.trim();
      if (!key) continue;
      const known = byName.get(key) ?? new Set<string>();
      known.add(pubkey);
      byName.set(key, known);
    }
  }

  const candidates = new Set<string>();
  for (const raw of participants) {
    const value = (raw ?? "").trim();
    if (!value) return null;

    const direct = asPeerPubkey(value);
    if (direct) {
      if (direct !== myPubkey) candidates.add(direct);
      continue;
    }
    if (myName && value === myName) continue;

    const resolved = byName.get(value);
    if (!resolved || resolved.size === 0) return null;
    if (resolved.size > 1) return null;

    const only = [...resolved][0];
    if (only !== myPubkey) candidates.add(only);
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

export type FriendConsentGroups = {
  /** Mutual consent established (a legacy record without `consent` counts). */
  accepted: Friend[];
  /** They asked us and we have not answered yet. */
  incoming: Friend[];
  /** We asked them and they have not answered yet. */
  outgoing: Friend[];
  /** Pending with no timestamp at all: malformed or hand-written data. */
  pending: Friend[];
  /** Locally blocked; never synced. */
  blocked: Friend[];
};

/** Split the friend graph into the consent states the UI distinguishes. */
export function classifyFriendsByConsent(
  friends: readonly Friend[]
): FriendConsentGroups {
  const groups: FriendConsentGroups = {
    accepted: [],
    incoming: [],
    outgoing: [],
    pending: [],
    blocked: [],
  };

  for (const friend of friends) {
    if (friend.blocked) {
      groups.blocked.push(friend);
      continue;
    }
    if (friend.consent !== "pending") {
      groups.accepted.push(friend);
      continue;
    }
    if (typeof friend.incomingRequestAt === "number") {
      groups.incoming.push(friend);
      continue;
    }
    if (typeof friend.requestedAt === "number") {
      groups.outgoing.push(friend);
      continue;
    }
    groups.pending.push(friend);
  }

  return groups;
}
