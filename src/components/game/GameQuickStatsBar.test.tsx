import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GameQuickStatsBar from "./GameQuickStatsBar";
import { useSteamGameStats } from "../../hooks/useSteamGameStats";
import type { Game, SteamGameStats } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ showDeckVerified: false }),
}));

vi.mock("../../hooks/useSteamGameStats", () => ({
  useSteamGameStats: vi.fn(),
}));

const mockedUseSteamGameStats = vi.mocked(useSteamGameStats);

const steamStats: SteamGameStats = {
  appId: 292030,
  details: null,
  reviews: {
    totalPositive: 94795,
    totalNegative: 15606,
    totalReviews: 110401,
    score: 8,
    scoreDesc: "Very Positive",
  },
  detailsError: null,
  reviewsError: null,
};

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Crimson Desert",
    platform: "PC",
    path: "",
    installed: true,
    playTime: "5h",
    addedAt: 1,
    timeToBeat: { normally: 26 * 3600, completely: 60 * 3600 },
    ...overrides,
  } as Game;
}

describe("GameQuickStatsBar", () => {
  it("renders the reception card above the remaining quick stats", () => {
    mockedUseSteamGameStats.mockReturnValue({
      data: steamStats,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });

    render(<GameQuickStatsBar game={makeGame({ igdbRating: 78 })} sizeUnit="gib" />);

    expect(screen.getByText("game.quickStats.reception")).toBeTruthy();
    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.getByText(/86%/)).toBeTruthy();
    expect(screen.getByText("ratings.igdb")).toBeTruthy();
    expect(screen.getByText(/ratings\.steamBasedOn/)).toBeTruthy();
    expect(screen.getByText("game.quickStats.timeToBeat")).toBeTruthy();
  });

  it("renders the remaining stat cards when there is no reception data", () => {
    mockedUseSteamGameStats.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });

    render(<GameQuickStatsBar game={makeGame()} sizeUnit="gib" />);

    expect(screen.queryByText("game.quickStats.reception")).toBeNull();
    expect(screen.getByText("game.quickStats.timeToBeat")).toBeTruthy();
  });

  it("renders a rating-only card when Steam has no reviews", () => {
    mockedUseSteamGameStats.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });

    render(<GameQuickStatsBar game={makeGame({ igdbRating: 64 })} sizeUnit="gib" />);

    expect(screen.getByText("64")).toBeTruthy();
    expect(screen.getByText("ratings.igdbCommunity")).toBeTruthy();
    expect(screen.queryByText(/86%/)).toBeNull();
  });
});
