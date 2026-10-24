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
});
