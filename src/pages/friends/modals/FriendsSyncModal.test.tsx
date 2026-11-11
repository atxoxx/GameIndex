import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { FriendsSyncStatus } from "../../../sync/friends/engine";
import type { Friend } from "../../friendsStorage";
import FriendsSyncModal from "./FriendsSyncModal";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);

function makeStatus(overrides: Partial<FriendsSyncStatus> = {}): FriendsSyncStatus {
  return {
    phase: "degraded",
    manualSync: "ok",
    manualSyncFinishedAt: 1,
    relayStatus: {
      "wss://relay.one": "accepted",
      "wss://relay.two": "accepted",
      "wss://relay.three": "accepted",
      "wss://relay.four": "failed",
      "wss://relay.five": "idle",
    },
    lastSyncedAt: 1,
    lastError: null,
    pendingPublish: 0,
    peers: {
      [PUBKEY_A]: {
        lastStateRev: 1,
        lastSeenAt: Date.now(),
        seenByPeer: 3,
        lastPublishedRev: 2,
        presence: {
          status: "online",
          currentlyPlaying: null,
          lastActive: Math.floor(Date.now() / 1000),
        },
      },
      [PUBKEY_B]: {
        lastStateRev: null,
        lastSeenAt: null,
        seenByPeer: null,
        lastPublishedRev: null,
        presence: null,
      },
    },
    ...overrides,
  };
}

function makeFriend(id: string, name: string, syncId: string): Friend {
  return { id, name, avatar: "procedural", status: "", addedAt: 1, syncId, consent: "accepted" };
}

const friends = [
  makeFriend("f1", "Marty_", PUBKEY_A),
  makeFriend("f2", "Marty_", PUBKEY_B),
];

// The dialog renders through a portal on document.body.
function renderModal(overrides: { status?: Partial<FriendsSyncStatus>; friends?: Friend[] } = {}) {
  return render(
    <FriendsSyncModal
      isOpen
      onClose={() => {}}
      syncStatus={makeStatus(overrides.status)}
      friends={overrides.friends ?? friends}
      lastSyncedTime="14:02"
      onTriggerSync={() => {}}
    />,
  );
}

describe("FriendsSyncModal", () => {
  it("summarizes relay health and labels idle relays honestly", () => {
    renderModal();

    expect(document.querySelector(".sync-relay-summary")?.textContent).toBe(
      "friendsPage.syncRelaysSummary",
    );

    const rows = Array.from(document.querySelectorAll(".nostr-relay-item"));
    expect(rows).toHaveLength(5);
    expect(rows[0].querySelector(".nostr-relay-dot")?.className).toContain("is-accepted");
    expect(rows[3].querySelector(".nostr-relay-dot")?.className).toContain("is-failed");
    expect(rows[3].querySelector(".nostr-relay-status")?.textContent).toBe(
      "friendsPage.nostrRelayFailed",
    );
    expect(rows[4].querySelector(".nostr-relay-dot")?.className).toContain("is-idle");
    expect(rows[4].querySelector(".nostr-relay-status")?.textContent).toBe(
      "friendsPage.syncRelayIdle",
    );
  });

  it("says when no relay is reachable", () => {
    renderModal({
      status: {
        relayStatus: {
          "wss://relay.one": "failed",
          "wss://relay.two": "idle",
        },
      },
    });

    const summary = document.querySelector(".sync-relay-summary");
    expect(summary?.textContent).toBe("friendsPage.syncRelaysSummaryNone");
    expect(summary?.className).toContain("is-none");
  });

  it("tells two friends with the same name apart by their key", () => {
    renderModal();

    const suffixes = Array.from(document.querySelectorAll(".sync-peer-suffix")).map(
      (el) => el.textContent,
    );
    expect(suffixes).toEqual([`#${PUBKEY_A.slice(-6)}`, `#${PUBKEY_B.slice(-6)}`]);
  });

  it("keeps the name alone when it is unique", () => {
    renderModal({ friends: [makeFriend("f1", "Nova", PUBKEY_A)] });

    expect(document.querySelector(".sync-peer-suffix")).toBeNull();
    expect(document.querySelector(".sync-peer-name")?.textContent).toBe("Nova");
  });

  it("shows presence, exchange wording and explained delivery badges", () => {
    renderModal();

    const rows = Array.from(document.querySelectorAll(".sync-peer-row"));
    expect(rows[0].querySelector(".sync-peer-state")?.textContent).toBe("friendsPage.syncPeerOnline");
    expect(rows[0].querySelector(".sync-peer-state")?.className).toContain("is-online");
    expect(rows[0].querySelector(".sync-peer-meta")?.textContent).toContain(
      "friendsPage.syncPeerLastExchange",
    );
    expect(rows[1].querySelector(".sync-peer-state")?.textContent).toBe(
      "friendsPage.syncPeerOffline",
    );
    expect(rows[1].querySelector(".sync-peer-meta")?.textContent).toBe(
      "friendsPage.syncPeerNeverHeard",
    );

    const delivery = rows[0].querySelector(".sync-peer-delivery");
    expect(delivery?.className).toContain("is-seen");
    expect(delivery?.getAttribute("title")).toBe("friendsPage.syncSeenHint");
  });

  it("spins and disables Sync now only while a manual pass runs", () => {
    renderModal({ status: { manualSync: "running" } });

    const primary = Array.from(document.querySelectorAll(".friends-modal-body button")).find((el) =>
      el.textContent?.includes("friends.syncNow"),
    ) as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.getAttribute("aria-busy")).toBe("true");
  });
});
