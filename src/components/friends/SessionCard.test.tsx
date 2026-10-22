import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { GameSession, UserProfile } from "../../pages/friendsStorage";
import SessionCard from "./SessionCard";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}` : key) }),
}));

beforeAll(() => {
  // jsdom has no layout engine; the chat drawer scrolls itself into view.
  Element.prototype.scrollIntoView = vi.fn();
});

const profile: UserProfile = {
  name: "Me",
  avatar: "procedural",
  status: "Ready to Play!",
  syncId: "a".repeat(64),
};

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    gameId: "g1",
    gameName: "Game X",
    scheduledAt: "2030-01-01T20:00",
    maxPlayers: 4,
    description: "",
    creatorName: "Me",
    attendees: ["Me"],
    rsvps: { Me: "going" },
    participants: [{ name: "Me", role: "host" }],
    messages: [],
    updatedAt: 1,
    ...overrides,
  };
}

const noop = () => {};

function renderCard(session: GameSession) {
  return render(
    <SessionCard
      session={session}
      profile={profile}
      friends={[]}
      onRsvp={noop}
      onDelete={noop}
      onSetRole={noop}
      onAddGuest={noop}
      onRemoveGuest={noop}
      onSetRsvpNote={noop}
      onSendMessage={noop}
      onTogglePinMessage={noop}
    />,
  );
}

describe("SessionCard", () => {
  it("counts a +1 guest as going even when the guest has no RSVP entry", () => {
    const { container } = renderCard(
      makeSession({
        participants: [
          { name: "Me", role: "host" },
          { name: "Plus One", role: "player", guest: true },
        ],
      }),
    );

    const guestRow = Array.from(container.querySelectorAll(".roster-row.rsvp-going")).find((row) =>
      row.textContent?.includes("Plus One"),
    );
    expect(guestRow).toBeTruthy();
    expect(guestRow?.querySelector(".roster-rsvp-badge")?.textContent).toContain("friends.going");
  });

  it("marks the poll option we voted for as active", () => {
    const session = makeSession({
      scheduledAt: "",
      poll: {
        options: [
          { id: "o1", label: "2030-01-01T20:00" },
          { id: "o2", label: "2030-01-02T20:00" },
        ],
        votes: { o2: ["Me"] },
      },
    });

    const { container } = renderCard(session);
    const rows = container.querySelectorAll(".session-poll-option");
    const voteButton = (row: Element) =>
      row.querySelector(".session-poll-option-actions button") as HTMLElement;

    expect(voteButton(rows[0]).className).not.toContain("ui-btn--active");
    expect(voteButton(rows[1]).className).toContain("ui-btn--active");
  });

  it("hides deleted chat messages from the thread", () => {
    const session = makeSession({
      messages: [
        { id: "m1", author: "Me", text: "visible", timestamp: 1 },
        { id: "m2", author: "Me", text: "removed", timestamp: 2, deleted: true },
      ],
    });

    const { container } = renderCard(session);
    fireEvent.click(container.querySelector(".session-chat-toggle") as HTMLElement);

    expect(container.textContent).toContain("visible");
    expect(container.textContent).not.toContain("removed");
  });
});
