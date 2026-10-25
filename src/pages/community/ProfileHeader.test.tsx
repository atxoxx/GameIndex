import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileHeader } from "./ProfileHeader";
import type { ProfileTotals } from "./useProfileController";
import type { GamerLevelInfo, GamerPersona, TimeframePreset } from "./statsTypes";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../utils/screenshot", () => ({
  captureAndSaveScreenshot: vi.fn().mockResolvedValue(null),
}));

const levelInfo: GamerLevelInfo = {
  level: 27,
  title: "Veteran",
  currentXp: 3400,
  xpForNextLevel: 5000,
  progressPct: 68,
  totalXp: 94000,
};

const persona: GamerPersona = {
  id: "night_owl",
  titleKey: "stats.persona.nightOwl.title",
  subtitleKey: "stats.persona.nightOwl.subtitle",
  badgeEmoji: "",
  traits: [],
};

const totals: ProfileTotals = {
  playtimeMin: 12840,
  sessionCount: 214,
  libraryCount: 86,
  playedGames: 54,
  achievementUnlocked: 320,
  achievementTotal: 900,
  achievementPct: 36,
  captureCount: 42,
};

describe("ProfileHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("changes the range and exports the report", () => {
    const onRangeChange = vi.fn();

    render(
      <ProfileHeader
        levelInfo={levelInfo}
        persona={persona}
        streak={{ current: 6, longest: 12, playedToday: true }}
        totals={totals}
        genreBreakdown={[]}
        range={"all" as TimeframePreset}
        onRangeChange={onRangeChange}
        hideAchievementProgress={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(onRangeChange).toHaveBeenCalledWith("30d");

    // Export stays reachable by its accessible name for keyboard/screen
    // reader users even though the action is icon-only.
    expect(screen.getByRole("button", { name: "stats.exportData" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "community.shareProfile" })).toBeTruthy();
  });
});
