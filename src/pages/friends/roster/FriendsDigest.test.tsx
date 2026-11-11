import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render } from "@testing-library/react";
import type {
  DmThread,
  GameRecommendation,
  GameSession,
  GameSuggestion,
  UserProfile,
} from "../../friendsStorage";
import FriendsDigest from "./FriendsDigest";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${key}(${Object.entries(vars)
            .map(([name, value]) => `${name}=${value}`)
            .join(",")})`
        : key,
  }),
}));

const profile: UserProfile = {
  name: "Alex",
  avatar: "procedural",
  status: "Ready to Play!",
  syncId: "a".repeat(64),
};

const future = new Date(Date.now() + 3_600_000);

const session: GameSession = {
  id: "session-1",
  gameId: "game-1",
  gameName: "Helldivers 2",
  scheduledAt: future.toISOString(),
  maxPlayers: 4,
  description: "",
  creatorName: "Nova",
  attendees: ["Nova"],
  updatedAt: Date.now(),
};

const dm: DmThread = {
  id: "dm_Alex_Nova",
  participants: ["Alex", "Nova"],
  updatedAt: Date.now(),
  messages: [{ id: "m1", author: "Nova", text: "Ready?", timestamp: Date.now() }],
  lastReadAt: { Alex: 0 },
};

const now = Date.now();

function makeSuggestion(index: number, gameName: string, by = "ArToutCrush"): GameSuggestion {
  return {
    id: `sug-${index}`,
    gameId: `game-${index}`,
    gameName,
    note: "",
    suggestedBy: by,
    suggestedTo: "All Friends",
    comments: [],
    createdAt: now - index * 1000,
    updatedAt: now - index * 1000,
  };
}

function makeRecommendation(index: number, gameName: string, by = "Nova"): GameRecommendation {
  return {
    id: `rec-${index}`,
    gameId: `game-${index}`,
    gameName,
    recommendedBy: by,
    recommendedTo: "All Friends",
    reason: "",
    rating: 4,
    comments: [],
    createdAt: now - index * 1000,
    updatedAt: now - index * 1000,
  };
}

function renderDigest(overrides: Partial<ComponentProps<typeof FriendsDigest>> = {}) {
  return render(
    <FriendsDigest
      friends={[]}
      sessions={[]}
      recommendations={[]}
      suggestions={[]}
      dms={[]}
      profile={profile}
      onNavigate={() => {}}
      {...overrides}
    />
  );
}

describe("FriendsDigest", () => {
  it("summarizes the next session and unread messages", () => {
    const { container } = renderDigest({ sessions: [session], dms: [dm] });

    expect(container.querySelector(".friends-digest__next")).not.toBeNull();
    expect(container.textContent).toContain("Helldivers 2");
    expect(container.querySelectorAll(".friends-digest__item").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the caught-up state when there is nothing new", () => {
    const { container } = renderDigest();

    expect(container.querySelector(".friends-empty--digest")).not.toBeNull();
    expect(container.querySelector(".friends-digest__list")).toBeNull();
  });

  it("collapses five wishlist shares from one friend into a single row", () => {
    const suggestions = [
      makeSuggestion(0, "Hades"),
      makeSuggestion(1, "Celeste"),
      makeSuggestion(2, "Tunic"),
      makeSuggestion(3, "Bastion"),
      makeSuggestion(4, "Pyre"),
    ];
    const { container } = renderDigest({ suggestions });

    const rows = Array.from(container.querySelectorAll(".friends-digest__item"));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".friends-digest__title")?.textContent).toBe(
      "friendsPage.digest.wishlistGroup(name=ArToutCrush,count=5)",
    );
    expect(rows[0].querySelector(".friends-digest__detail")?.textContent).toBe(
      "Hades · Celeste · Tunic friendsPage.digest.moreGames(count=2)",
    );
    // One timestamp per grouped row, and the friend's face replaces the icon.
    expect(rows[0].querySelectorAll(".friends-digest__time")).toHaveLength(1);
    expect(rows[0].querySelector(".friends-digest__media .friend-avatar")).not.toBeNull();
    expect(rows[0].querySelector(".friends-digest__kind.is-suggestion")).not.toBeNull();
  });

  it("collapses recommendations from the same friend too", () => {
    const recommendations = [
      makeRecommendation(0, "Elden Ring"),
      makeRecommendation(1, "Hollow Knight"),
      makeRecommendation(2, "Celeste"),
    ];
    const { container } = renderDigest({ recommendations });

    const rows = Array.from(container.querySelectorAll(".friends-digest__item"));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".friends-digest__title")?.textContent).toBe(
      "friendsPage.digest.recommendationGroup(name=Nova,count=3)",
    );
    expect(rows[0].querySelector(".friends-digest__detail")?.textContent).toBe(
      "Elden Ring · Hollow Knight · Celeste",
    );
  });

  it("keeps a single share as its own sentence", () => {
    const { container } = renderDigest({ suggestions: [makeSuggestion(0, "Hades")] });

    const rows = Array.from(container.querySelectorAll(".friends-digest__item"));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".friends-digest__title")?.textContent).toBe(
      "friendsPage.digest.newSuggestion(name=ArToutCrush,game=Hades)",
    );
  });

  it("never shows more than five rows", () => {
    const dms: DmThread[] = Array.from({ length: 7 }, (_, index) => ({
      id: `dm_${index}`,
      participants: ["Alex", `Friend${index}`],
      updatedAt: now - index * 1000,
      messages: [
        {
          id: `m${index}`,
          author: `Friend${index}`,
          text: "hi",
          timestamp: now - index * 1000,
        },
      ],
      lastReadAt: { Alex: 0 },
    }));
    const { container } = renderDigest({ dms });

    expect(container.querySelectorAll(".friends-digest__item")).toHaveLength(5);
  });
});
