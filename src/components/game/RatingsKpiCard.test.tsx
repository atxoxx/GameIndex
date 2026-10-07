import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RatingsKpiCard from "./RatingsKpiCard";
import { useMetacriticScore } from "../../hooks/useMetacriticScore";
import type { Game, MetacriticScore } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: false }),
}));

vi.mock("../../hooks/useSteamGameStats", () => ({
  useSteamGameStats: () => ({ data: undefined, loading: false }),
}));

vi.mock("../../hooks/useMetacriticScore", () => ({
  useMetacriticScore: vi.fn(),
}));

vi.mock("./MetacriticDetailsModal", () => ({
  default: () => <div data-testid="mc-modal">modal</div>,
  MetacriticDetailsContent: () => <div>content</div>,
}));

const mockedUseMetacriticScore = vi.mocked(useMetacriticScore);

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Crimson Desert",
    platform: "PC",
    path: "",
    installed: true,
    playTime: "5h",
    addedAt: 1,
    ...overrides,
  } as Game;
}

const score: MetacriticScore = {
  url: "https://www.metacritic.com/game/crimson-desert/",
  metascore: 77,
  metascoreSentiment: "Generally Favorable",
  criticReviewCount: 115,
  userScore: 8.7,
  userRatingCount: 13805,
  positiveCount: 84,
  neutralCount: 30,
  negativeCount: 1,
};

describe("RatingsKpiCard", () => {
  beforeEach(() => {
    mockedUseMetacriticScore.mockReset();
  });

  it("shows both the Metascore and IGDB tiles and opens the details modal", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: score, loading: false });
    render(<RatingsKpiCard game={makeGame({ igdbRating: 91 })} />);

    expect(screen.getByText("ratings.metacritic")).toBeTruthy();
    expect(screen.getByText("ratings.igdbCommunity")).toBeTruthy();
    expect(screen.getByText("77")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    // Metacritic repartition replaces the old synthetic breakdown.
    expect(screen.getByText("ratings.positive")).toBeTruthy();
    expect(screen.getByText("ratings.mixed")).toBeTruthy();
    expect(screen.getByText("ratings.negative")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /common.details/ }));
    expect(screen.getByTestId("mc-modal")).toBeTruthy();
  });

  it("falls back to the IGDB community score when Metacritic has nothing", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: null, loading: false });
    render(<RatingsKpiCard game={makeGame({ igdbRating: 91 })} />);

    expect(screen.getByText("ratings.igdbCommunity")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    expect(screen.queryByText("ratings.metacritic")).toBeNull();
    expect(screen.queryByRole("button", { name: /common.details/ })).toBeNull();
  });

  it("renders nothing when no score source is available", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: null, loading: false });
    const { container } = render(<RatingsKpiCard game={makeGame()} />);
    expect(container.firstChild).toBeNull();
  });
});
