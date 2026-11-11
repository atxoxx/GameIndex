import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import type { Friend } from "../../friendsStorage";
import type { FriendInvitation } from "../friendsTypes";
import AddFriendModal from "./AddFriendModal";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const noop = () => {};

const PUBKEY = "a".repeat(64);

function makeDecodedFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend-1",
    name: "aaaaaaaa…aaaa",
    avatar: "procedural",
    status: "",
    addedAt: 1,
    syncId: PUBKEY,
    ...overrides,
  };
}

// The dialog renders through a portal on document.body, so assertions look at
// the document rather than the render container.
function renderModal(overrides: Partial<ComponentProps<typeof AddFriendModal>> = {}) {
  return render(
    <AddFriendModal
      isOpen
      onClose={noop}
      myFriendCode=""
      nostrPublicKey=""
      friendCodeInput={PUBKEY}
      onFriendCodeInputChange={noop}
      decodedFriend={makeDecodedFriend()}
      onAddFriend={() => true}
      {...overrides}
    />,
  );
}

describe("AddFriendModal", () => {
  it("shows a neutral card instead of inventing a profile", () => {
    const { queryByText } = renderModal();

    const card = document.querySelector(".friend-preview-card--neutral");
    expect(card).not.toBeNull();
    // No remote preview: no stats tiles and no fake status line.
    expect(document.querySelector(".friend-preview-stats")).toBeNull();
    expect(card?.querySelector(".friend-preview-status")?.textContent).toBe(
      "friendsPage.profileAfterAccept",
    );
    expect(queryByText("friendsPage.syncStartsOnAccept")).not.toBeNull();
    // The procedural avatar keeps its fixed square wrapper.
    expect(document.querySelector(".preview-avatar-wrapper .preview-avatar-procedural")).not.toBeNull();
  });

  it("extracts an npub from pasted text before decoding", () => {
    const onFriendCodeInputChange = vi.fn();
    const { getByLabelText } = renderModal({
      friendCodeInput: "",
      decodedFriend: null,
      onFriendCodeInputChange,
    });

    fireEvent.change(getByLabelText("friends.pasteCodePlaceholder"), {
      target: { value: "hey, my code is npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq thanks" },
    });

    expect(onFriendCodeInputChange).toHaveBeenCalledWith(
      "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    );
  });

  it("switches to the waiting state after a request is sent", () => {
    const onAddFriend = vi.fn(() => true);
    const { getByText, queryByText } = renderModal({ onAddFriend });

    expect(queryByText("friendsPage.requestSentTitle")).toBeNull();
    fireEvent.click(getByText("friendsPage.sendRequest"));

    expect(onAddFriend).toHaveBeenCalledTimes(1);
    expect(queryByText("friendsPage.requestSentTitle")).not.toBeNull();
    expect(queryByText("friendsPage.requestSentBody")).not.toBeNull();
    expect(queryByText("friendsPage.sendAgain")).not.toBeNull();
    expect(queryByText("friendsPage.cancelRequest")).not.toBeNull();
    // The primary action is gone: a second press cannot queue a duplicate.
    expect(queryByText("friendsPage.sendRequest")).toBeNull();
    expect(document.querySelector(".friend-request-pending")).not.toBeNull();
  });

  it("stays on the paste form when the request could not be queued", () => {
    const onAddFriend = vi.fn(() => false);
    const { getByText, queryByText } = renderModal({ onAddFriend });

    fireEvent.click(getByText("friendsPage.sendRequest"));

    expect(queryByText("friendsPage.requestSentTitle")).toBeNull();
    expect(getByText("friendsPage.sendRequest")).toBeInTheDocument();
  });

  it("opens straight into the waiting state for an existing pending request", () => {
    const pending: FriendInvitation = {
      syncId: PUBKEY,
      name: "aaaaaaaa…aaaa",
      avatar: "procedural",
      status: "",
      requestedAt: Date.now(),
    };
    const onCancelRequest = vi.fn();
    const { getByText, queryByText } = renderModal({
      pendingRequest: pending,
      onCancelRequest,
    });

    expect(queryByText("friendsPage.requestSentTitle")).not.toBeNull();
    fireEvent.click(getByText("friendsPage.cancelRequest"));
    expect(onCancelRequest).toHaveBeenCalledTimes(1);
  });

  it("does not offer to add someone who is already a friend", () => {
    const { getByText, queryByText } = renderModal({ existingFriendName: "Nova" });

    expect(queryByText("friendsPage.alreadyFriends")).not.toBeNull();
    expect(queryByText("friendsPage.sendRequest")).toBeNull();
    expect(getByText("common.cancel")).toBeInTheDocument();
  });

  it("explains that the shared code is safe to hand out", () => {
    const { getByText } = renderModal({ myFriendCode: PUBKEY });

    fireEvent.click(getByText("friendsPage.myFriendCodeTab"));
    expect(getByText("friendsPage.myCodeSafeHint")).toBeInTheDocument();
    // Hex is shown as npub so nobody copies 64 raw characters.
    expect(getByText(/^npub1/)).toBeInTheDocument();
  });
});
