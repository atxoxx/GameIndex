import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Friend } from "../../../pages/friendsStorage";
import FriendCard from "./FriendCard";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: "friend-1",
    name: "Ada",
    avatar: "procedural",
    status: "online",
    addedAt: 1,
    syncId: "sync-1",
    ...overrides,
  } as Friend;
}

const noop = () => {};

function renderCard(friend = makeFriend()) {
  return render(
    <FriendCard
      friend={friend}
      circles={[]}
      myGameIds={new Set<string>()}
      onPin={noop}
      onBlock={noop}
      onDelete={noop}
      onSetNickname={noop}
      onCompare={noop}
      onMessage={noop}
      onInviteToLobby={noop}
      onToggleCircle={noop}
    />,
  );
}

describe("FriendCard", () => {
  it("announces itself as a button that opens a dialog", () => {
    renderCard();

    const card = screen.getByRole("button", { name: /Ada/ });
    expect(card).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("opens the action sheet outside itself, so the card nests no controls", () => {
    const { container } = renderCard();
    const card = screen.getByRole("button", { name: /Ada/ });

    // Evidence for the plain `role="button"`: the card's own subtree holds no
    // interactive element, and the sheet it opens is a sibling dialog.
    expect(card.querySelector('[role="dialog"]')).toBeNull();
    expect(card.querySelectorAll("button")).toHaveLength(0);

    fireEvent.click(card);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(card.contains(dialog)).toBe(false);
  });
});
