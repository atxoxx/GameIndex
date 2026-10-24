import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render } from "@testing-library/react";
import type { DmThread, GameSession, UserProfile } from "../../friendsStorage";
import FriendsDigest from "./FriendsDigest";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const profile: UserProfile = {
  name: "Alex",
  avatar: "procedural",
  status: "Ready to Play!",
  syncId: "a".repeat(64),
};

const future = new Date(Date.now() + 3_600_000);
const futureLocal = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(
  future.getDate()
).padStart(2, "0")}T${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}`;

const session: GameSession = {
  id: "session-1",
  gameId: "game-1",
  gameName: "Helldivers 2",
  scheduledAt: futureLocal,
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
});
