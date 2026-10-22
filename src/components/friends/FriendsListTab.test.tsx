import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Friend } from "../../pages/friendsStorage";
import FriendsListTab from "./FriendsListTab";

vi.mock("../../context/LanguageContext", () => ({
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

function renderTab(friends: Friend[] = [makeFriend()]) {
  return render(
    <FriendsListTab
      friends={friends}
      circles={[]}
      invitations={[]}
      myGameIds={new Set<string>()}
      onOpenAddModal={noop}
      onOpenCirclesModal={noop}
      onAcceptInvitation={noop}
      onDenyInvitation={noop}
      onCompareFriend={noop}
      onInviteFriend={noop}
      onMessageFriend={noop}
      onTogglePin={noop}
      onEditNickname={noop}
      onToggleBlock={noop}
      onDeleteFriend={noop}
      onBulkPin={noop}
      onBulkUnpin={noop}
      onBulkBlock={noop}
      onBulkRemove={noop}
    />,
  );
}

describe("FriendsListTab", () => {
  it("toggles select mode and shows the batch action bar", () => {
    const { getByTitle, container } = renderTab();
    const toggle = getByTitle("friendsPage.selectMultiple");

    expect(toggle.className).not.toContain("ui-btn--active");
    expect(container.querySelector(".friends-batch-controls-bar")).toBeNull();

    fireEvent.click(toggle);

    expect(getByTitle("friendsPage.exitSelectMode").className).toContain("ui-btn--active");
    expect(container.querySelector(".friends-batch-controls-bar")).not.toBeNull();
  });

  it("does not mix blocked friends into the default list", () => {
    const { container } = renderTab([
      makeFriend(),
      makeFriend({ id: "friend-2", name: "Blocked", syncId: "b".repeat(64), blocked: true }),
    ]);

    const names = Array.from(container.querySelectorAll(".friend-name")).map((el) => el.textContent);

    expect(names).toEqual(["Ada"]);
  });

  it("shows the empty state when every friend is blocked", () => {
    const { container } = renderTab([
      makeFriend({ blocked: true }),
    ]);

    expect(container.querySelector(".friends-empty-state")).not.toBeNull();
    expect(container.querySelector(".friend-card-modern")).toBeNull();
  });
});
