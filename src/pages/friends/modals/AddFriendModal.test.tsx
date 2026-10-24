import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Friend } from "../../friendsStorage";
import AddFriendModal from "./AddFriendModal";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const noop = () => {};

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend-1",
    name: "3Lambda",
    avatar: "procedural",
    status: "Ready to Play!",
    addedAt: 1,
    syncId: "a".repeat(64),
    ...overrides,
  };
}

function renderModal(friend: Friend) {
  return render(
    <AddFriendModal
      isOpen
      onClose={noop}
      myFriendCode=""
      nostrPublicKey=""
      friendCodeInput=""
      onFriendCodeInputChange={noop}
      decodedFriend={friend}
      onAddFriend={noop}
    />,
  );
}

describe("AddFriendModal preview", () => {
  it("keeps the procedural avatar in a fixed square wrapper", () => {
    renderModal(makeFriend());

    const wrapper = document.querySelector(".preview-avatar-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector(".preview-avatar-procedural")?.textContent).toBe("3L");

    // The card avatar class stretches to its flex parent, so it must not be
    // used directly in the preview header.
    expect(document.querySelector(".friend-preview-header > .friend-avatar-procedural")).toBeNull();
  });

  it("uses the same wrapper for an uploaded avatar image", () => {
    renderModal(makeFriend({ avatar: "data:image/jpeg;base64,AAAA" }));

    expect(document.querySelector(".preview-avatar-wrapper .preview-avatar-img")).not.toBeNull();
  });

  it("lays the shared library stats out as three labelled tiles", () => {
    renderModal(
      makeFriend({
        libStats: { gamesCount: 256, playtimeMinutes: 276, achievementsCount: 869 },
      }),
    );

    const tiles = document.querySelectorAll(".friend-preview-stats .preview-stat-item");
    expect(tiles).toHaveLength(3);
    expect(tiles[0].querySelector(".preview-stat-val")?.textContent).toBe("256");
    expect(tiles[0].querySelector(".preview-stat-lbl")?.textContent).toBe("friendsPage.games");
    expect(tiles[2].querySelector(".preview-stat-val")?.textContent).toBe("869");
    expect(tiles[2].querySelector(".preview-stat-lbl")?.textContent).toBe("friendsPage.achievements");

    // Separators must not live in the grid as their own cells.
    expect(document.querySelector(".friend-preview-stats > span")).toBeNull();
  });
});
