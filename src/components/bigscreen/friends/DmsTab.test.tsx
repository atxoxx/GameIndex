import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Friend, DmThread } from "../../../pages/friendsStorage";
import { dmThreadId } from "../../../pages/friendsStorage";
import type { PeerSyncState } from "../../../sync/friends/engine";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import DmsTab from "./DmsTab";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

const MY_PUBKEY = "b".repeat(64);
const PEER_PUBKEY = "c".repeat(64);

const friend: Friend = {
  id: "friend-1",
  name: "Nova",
  avatar: "procedural",
  status: "Offline",
  addedAt: 1,
  syncId: PEER_PUBKEY,
  consent: "accepted",
};

// The engine re-keys threads onto the pair's pubkeys, so the participants are
// hex and the id is the pair id — nothing here is keyed by display name.
const threadId = dmThreadId(MY_PUBKEY, PEER_PUBKEY);
const thread: DmThread = {
  id: threadId,
  participants: [MY_PUBKEY, PEER_PUBKEY],
  updatedAt: 10,
  messages: [{ id: "m1", author: "Nova", text: "Ready for a round?", timestamp: 10 }],
};

const peerStates: Record<string, PeerSyncState> = {
  [PEER_PUBKEY]: {
    lastStateRev: 4,
    lastSeenAt: Date.now(),
    seenByPeer: 7,
    lastPublishedRev: 7,
    presence: { status: "Online", currentlyPlaying: null, lastActive: Math.floor(Date.now() / 1000) },
  },
};

function makeSocial(overrides: Partial<UseFriendsSocialResult> = {}) {
  return {
    dms: [thread],
    friends: [friend],
    selectedDmId: threadId,
    selectedDmFriendName: "",
    handleOpenDmThread: vi.fn(),
    handleSendDm: vi.fn(),
    peerForThread: (id: string) => (id === threadId ? PEER_PUBKEY : null),
    ...overrides,
  } as unknown as UseFriendsSocialResult;
}

describe("DmsTab", () => {
  it("resolves a pubkey-addressed thread to the friend behind it", () => {
    const { container } = render(
      <DmsTab social={makeSocial()} profileName="Alex" myPubkey={MY_PUBKEY} peerStates={peerStates} />,
    );

    expect(container.querySelector(".bigscreen-dms-pane-head-name")?.textContent).toContain("Nova");
    expect(container.textContent).toContain("Ready for a round?");
  });

  it("shows presence and delivery from the peer's sync state", () => {
    const { container } = render(
      <DmsTab social={makeSocial()} profileName="Alex" myPubkey={MY_PUBKEY} peerStates={peerStates} />,
    );

    expect(container.querySelector(".bigscreen-dms-pane-online")?.textContent).toBe(
      "friendsPage.formatOnline",
    );
    expect(container.querySelector(".bigscreen-dms-pane-delivery.is-seen")?.textContent).toBe(
      "friendsPage.syncSeen",
    );
    // The thread row carries the same online state, not a name lookup.
    expect(container.querySelector(".bigscreen-dms-thread-online-dot")).not.toBeNull();
  });

  it("falls back to a legacy name-keyed thread", () => {
    const legacy: DmThread = {
      id: "dm_Alex_Nova",
      participants: ["Alex", "Nova"],
      updatedAt: 10,
      messages: [{ id: "m2", author: "Nova", text: "Still there?", timestamp: 10 }],
    };
    const { container } = render(
      <DmsTab
        social={makeSocial({ dms: [legacy], selectedDmId: legacy.id })}
        profileName="Alex"
        myPubkey={MY_PUBKEY}
        peerStates={{}}
      />,
    );

    expect(container.textContent).toContain("Still there?");
    // No engine state for this peer yet: no delivery claim is invented.
    expect(container.querySelector(".bigscreen-dms-pane-delivery")).toBeNull();
  });
});
