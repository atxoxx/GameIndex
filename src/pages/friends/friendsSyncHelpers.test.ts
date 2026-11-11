import { describe, expect, it } from "vitest";

import type { Friend } from "../friendsStorage";
import {
  asPeerPubkey,
  classifyFriendsByConsent,
  peerPubkeyForThread,
} from "./friendsSyncHelpers";

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);

function friend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend_1",
    name: "Bob",
    avatar: "procedural",
    status: "Offline",
    addedAt: 1,
    syncId: BOB,
    ...overrides,
  };
}

describe("asPeerPubkey", () => {
  it("normalizes hex and rejects anything else", () => {
    expect(asPeerPubkey(`  ${BOB.toUpperCase()} `)).toBe(BOB);
    expect(asPeerPubkey("device_abc")).toBeNull();
    expect(asPeerPubkey(undefined)).toBeNull();
  });
});

describe("peerPubkeyForThread", () => {
  it("reads the peer out of a pubkey-keyed thread", () => {
    expect(
      peerPubkeyForThread(
        { participants: [ME, BOB] },
        [friend()],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBe(BOB);
  });

  it("resolves a legacy name-keyed thread through the friend list", () => {
    expect(
      peerPubkeyForThread(
        { participants: ["Alice", "Bob"] },
        [friend()],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBe(BOB);
  });

  it("matches a local nickname", () => {
    expect(
      peerPubkeyForThread(
        { participants: ["Alice", "Bobby"] },
        [friend({ nickname: "Bobby" })],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBe(BOB);
  });

  it("skips the send when two friends share the participant's name", () => {
    expect(
      peerPubkeyForThread(
        { participants: ["Alice", "Bob"] },
        [friend(), friend({ id: "friend_2", syncId: CAROL })],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBeNull();
  });

  it("skips the send when the other participant is unknown", () => {
    expect(
      peerPubkeyForThread(
        { participants: ["Alice", "Mallory"] },
        [friend()],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBeNull();
  });

  it("skips the send for a thread that is not a pair", () => {
    expect(
      peerPubkeyForThread(
        { participants: [ME, BOB, CAROL] },
        [friend()],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBeNull();
  });

  it("skips the send when the identity is unknown and both sides are pubkeys", () => {
    expect(
      peerPubkeyForThread({ participants: [ME, BOB] }, [friend()], {
        myPubkey: null,
        myName: "Alice",
      })
    ).toBeNull();
  });

  it("skips a friend record without a usable pubkey", () => {
    expect(
      peerPubkeyForThread(
        { participants: ["Alice", "Bob"] },
        [friend({ syncId: "device_123" })],
        { myPubkey: ME, myName: "Alice" }
      )
    ).toBeNull();
  });
});

describe("classifyFriendsByConsent", () => {
  it("splits accepted, incoming and outgoing records", () => {
    const groups = classifyFriendsByConsent([
      friend({ id: "a", syncId: BOB, consent: "accepted" }),
      friend({ id: "b", syncId: CAROL, consent: "pending", incomingRequestAt: 10 }),
      friend({
        id: "c",
        syncId: ME,
        consent: "pending",
        requestedAt: 20,
      }),
    ]);

    expect(groups.accepted.map((f) => f.id)).toEqual(["a"]);
    expect(groups.incoming.map((f) => f.id)).toEqual(["b"]);
    expect(groups.outgoing.map((f) => f.id)).toEqual(["c"]);
    expect(groups.pending).toHaveLength(0);
    expect(groups.blocked).toHaveLength(0);
  });

  it("treats a legacy record without consent as accepted", () => {
    const groups = classifyFriendsByConsent([friend({ consent: undefined })]);
    expect(groups.accepted).toHaveLength(1);
  });

  it("keeps a blocked record out of every other bucket", () => {
    const groups = classifyFriendsByConsent([
      friend({
        blocked: true,
        consent: "pending",
        incomingRequestAt: 10,
      }),
    ]);
    expect(groups.blocked).toHaveLength(1);
    expect(groups.incoming).toHaveLength(0);
  });

  it("flags a pending record with no attribution instead of guessing", () => {
    const groups = classifyFriendsByConsent([friend({ consent: "pending" })]);
    expect(groups.pending).toHaveLength(1);
    expect(groups.incoming).toHaveLength(0);
    expect(groups.outgoing).toHaveLength(0);
  });

  it("prefers the inbound timestamp when both are present", () => {
    const groups = classifyFriendsByConsent([
      friend({
        consent: "pending",
        incomingRequestAt: 10,
        requestedAt: 20,
      }),
    ]);
    expect(groups.incoming).toHaveLength(1);
    expect(groups.outgoing).toHaveLength(0);
  });
});
