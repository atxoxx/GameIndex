import { describe, expect, it } from "vitest";

import type { PeerSyncState } from "../../sync/friends/engine";
import {
  extractNpub,
  isPeerOnline,
  peerCurrentlyPlaying,
  peerDeliveryState,
  pendingPeerLabel,
  syncTone,
} from "./friendsSyncPresentation";

const PEER = "c".repeat(64);

function state(overrides: Partial<PeerSyncState> = {}): PeerSyncState {
  return {
    lastStateRev: null,
    lastSeenAt: null,
    seenByPeer: null,
    lastPublishedRev: null,
    presence: null,
    ...overrides,
  };
}

describe("extractNpub", () => {
  it("pulls a code out of pasted prose", () => {
    const npub = `npub1${"q".repeat(58)}`;
    expect(extractNpub(`my code is ${npub}, thanks!`)).toBe(npub);
  });

  it("ignores text without a code", () => {
    expect(extractNpub("no code here")).toBeNull();
    expect(extractNpub("")).toBeNull();
  });
});

describe("peer presence", () => {
  it("treats a fresh heartbeat as online and a stale one as offline", () => {
    const now = Date.now();
    const fresh = state({
      presence: { status: "Online", currentlyPlaying: null, lastActive: Math.floor(now / 1000) },
    });
    const stale = state({
      presence: { status: "Online", currentlyPlaying: null, lastActive: Math.floor(now / 1000) - 900 },
    });

    expect(isPeerOnline(fresh, now)).toBe(true);
    expect(isPeerOnline(stale, now)).toBe(false);
    expect(isPeerOnline(undefined, now)).toBe(false);
  });

  it("reads the game from presence, ignoring blank values", () => {
    expect(
      peerCurrentlyPlaying(
        state({ presence: { status: "Online", currentlyPlaying: "Hades II", lastActive: 1 } }),
      ),
    ).toBe("Hades II");
    expect(
      peerCurrentlyPlaying(
        state({ presence: { status: "Online", currentlyPlaying: "   ", lastActive: 1 } }),
      ),
    ).toBeUndefined();
  });
});

describe("peerDeliveryState", () => {
  it("separates delivered from seen", () => {
    expect(peerDeliveryState(undefined)).toBe("none");
    expect(peerDeliveryState(state({ lastPublishedRev: 4, seenByPeer: 2 }))).toBe("delivered");
    expect(peerDeliveryState(state({ lastPublishedRev: 4, seenByPeer: 4 }))).toBe("seen");
    expect(peerDeliveryState(state({ lastPublishedRev: 4, seenByPeer: 5 }))).toBe("seen");
  });

  it("falls back to any inbound contact when no revision is known", () => {
    expect(peerDeliveryState(state({ lastSeenAt: Date.now() }))).toBe("delivered");
  });
});

describe("pendingPeerLabel", () => {
  it("replaces the engine placeholder with the shortened key", () => {
    expect(pendingPeerLabel("Gamer Syncing...", PEER)).toBe(`${PEER.slice(0, 8)}…${PEER.slice(-4)}`);
    expect(pendingPeerLabel("Nova", PEER)).toBe("Nova");
  });
});

describe("syncTone", () => {
  it("reads queued work as still connecting", () => {
    expect(syncTone("online", 2)).toBe("connecting");
    expect(syncTone("online", 0)).toBe("online");
    expect(syncTone("offline", 0)).toBe("offline");
    expect(syncTone("idle", 0)).toBe("idle");
  });
});
