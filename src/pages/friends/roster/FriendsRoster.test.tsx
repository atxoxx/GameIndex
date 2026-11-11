import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import type { Friend } from "../../friendsStorage";
import FriendsRoster from "./FriendsRoster";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const noop = () => {};

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend-1",
    name: "Ada",
    avatar: "procedural",
    status: "Ready to Play!",
    addedAt: 1,
    syncId: "a".repeat(64),
    ...overrides,
  };
}

function renderRoster(overrides: Partial<ComponentProps<typeof FriendsRoster>> = {}) {
  const props: ComponentProps<typeof FriendsRoster> = {
    friends: [makeFriend()],
    circles: [],
    invitations: [],
    selectedFriendId: null,
    filter: "all",
    onFilterChange: noop,
    onSelectFriend: noop,
    onOpenAddModal: noop,
    onOpenCirclesModal: noop,
    onAcceptInvitation: noop,
    onDenyInvitation: noop,
    onMessageFriend: noop,
    onInviteFriend: noop,
    onCompareFriend: noop,
    onTogglePin: noop,
    onEditNickname: noop,
    onToggleBlock: noop,
    onDeleteFriend: noop,
    onBulkPin: noop,
    onBulkUnpin: noop,
    onBulkBlock: noop,
    onBulkRemove: noop,
    ...overrides,
  };
  return render(<FriendsRoster {...props} />);
}

describe("FriendsRoster", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not mix blocked friends into the default list", () => {
    const { container } = renderRoster({
      friends: [makeFriend(), makeFriend({ id: "friend-2", name: "Blocked", blocked: true })],
    });

    const names = Array.from(container.querySelectorAll(".friends-row__name")).map((el) => el.textContent);
    expect(names).toEqual(["Ada"]);
  });

  it("shows blocked friends when the blocked filter is active", () => {
    const { container } = renderRoster({
      filter: "blocked",
      friends: [makeFriend(), makeFriend({ id: "friend-2", name: "Blocked", blocked: true })],
    });

    const names = Array.from(container.querySelectorAll(".friends-row__name")).map((el) => el.textContent);
    expect(names).toEqual(["Blocked"]);
  });

  it("filters by nickname, name and playing game", () => {
    const { container, getByLabelText } = renderRoster({
      friends: [
        makeFriend({ name: "Ada" }),
        makeFriend({ id: "friend-2", name: "Grace", nickname: "Amazing Grace" }),
        makeFriend({ id: "friend-3", name: "Linus", currentlyPlaying: "Factorio" }),
      ],
    });

    fireEvent.change(getByLabelText("friends.searchPlaceholder"), { target: { value: "grace" } });
    let names = Array.from(container.querySelectorAll(".friends-row__name")).map((el) => el.textContent);
    expect(names).toEqual(["Amazing Grace"]);

    fireEvent.change(getByLabelText("friends.searchPlaceholder"), { target: { value: "factorio" } });
    names = Array.from(container.querySelectorAll(".friends-row__name")).map((el) => el.textContent);
    expect(names).toEqual(["Linus"]);
  });

  it("selects a friend when a row is clicked", () => {
    const onSelectFriend = vi.fn();
    const { container } = renderRoster({ onSelectFriend });

    fireEvent.click(container.querySelector(".friends-row") as HTMLElement);

    expect(onSelectFriend).toHaveBeenCalledWith("friend-1");
  });

  it("reveals the bulk bar in select mode", () => {
    const { container, getByTitle } = renderRoster();

    expect(container.querySelector(".friends-bulk")).toBeNull();
    fireEvent.click(getByTitle("friendsPage.selectMultiple"));
    expect(container.querySelector(".friends-bulk")).not.toBeNull();
  });

  it("shows the empty state for an unmatched search", () => {
    const { container, getByLabelText } = renderRoster();

    fireEvent.change(getByLabelText("friends.searchPlaceholder"), { target: { value: "nobody" } });

    expect(container.querySelector(".friends-empty")).not.toBeNull();
  });

  it("keeps pending requests out of the friend total", () => {
    const { container } = renderRoster({
      friends: [
        makeFriend({ name: "Ada" }),
        makeFriend({
          id: "friend-2",
          name: "Nova",
          consent: "pending",
          incomingRequestAt: Date.now(),
        }),
      ],
    });

    expect(container.querySelector(".friends-roster__count")?.textContent).toBe("1");
    expect(container.querySelector(".friends-roster__pending-count")?.textContent).toBe("1");
    // Both rows render, but only one counts as a friend.
    expect(container.querySelectorAll(".friends-row")).toHaveLength(2);
    expect(container.querySelectorAll(".friends-row.is-pending")).toHaveLength(1);
  });

  it("labels an inbound request and accepts it from the row", () => {
    const onAcceptInvitation = vi.fn();
    const inviteFriend = makeFriend({
      id: "friend-2",
      name: "Nova",
      consent: "pending",
      incomingRequestAt: Date.now(),
    });
    const { container } = renderRoster({
      friends: [inviteFriend],
      onAcceptInvitation,
    });

    const row = container.querySelector(".friends-row.is-pending") as HTMLElement;
    expect(row.querySelector(".friends-row__presence")?.textContent).toBe("friendsPage.wantsToConnect");

    fireEvent.click(row.querySelector(".friends-row__actions .is-accept") as HTMLElement);
    expect(onAcceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: inviteFriend.syncId, name: "Nova" }),
    );
  });

  it("declines an inbound request by blocking the peer", () => {
    const onDenyInvitation = vi.fn();
    const { container } = renderRoster({
      friends: [makeFriend({ consent: "pending", incomingRequestAt: Date.now() })],
      onDenyInvitation,
    });

    fireEvent.click(container.querySelector(".friends-row__actions .is-decline") as HTMLElement);

    expect(onDenyInvitation).toHaveBeenCalledWith("a".repeat(64));
  });

  it("marks an outbound request as sent and offers a resend", () => {
    const onResendRequest = vi.fn();
    const { container } = renderRoster({
      friends: [makeFriend({ consent: "pending", requestedAt: Date.now() })],
      onResendRequest,
    });

    const row = container.querySelector(".friends-row.is-pending--outgoing") as HTMLElement;
    expect(row.querySelector(".friends-row__presence")?.textContent).toBe("friendsPage.requestSentShort");

    // No friend actions on a row that is not a friend yet.
    expect(row.querySelector(".friends-row__menu-trigger")).toBeNull();
    fireEvent.click(row.querySelector(".friends-row__actions button") as HTMLElement);
    expect(onResendRequest).toHaveBeenCalledWith("a".repeat(64));
  });
});
