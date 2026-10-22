import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Friend } from "../../pages/friendsStorage";
import AddFriendModal from "./AddFriendModal";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../context/ToastContext", () => ({
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
});
