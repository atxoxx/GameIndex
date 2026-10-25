import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RatingsKpiCard from "./RatingsKpiCard";
import { useMetacriticScore } from "../../hooks/useMetacriticScore";
import { useSteamGameStats } from "../../hooks/useSteamGameStats";
import type {
  Game,
  MetacriticScore,
  SteamGameStats,
} from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: false }),
}));

vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: (onActivate: () => void) => ({
    ref: () => {},
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: () => {},
  }),
}));

vi.mock("../../hooks/useSteamGameStats", () => ({
  useSteamGameStats: vi.fn(),
}));

vi.mock("../../hooks/useMetacriticScore", () => ({
  useMetacriticScore: vi.fn(),
}));

vi.mock("./ratings/RatingsDetailsModal", () => ({
  default: () => <div data-testid="ratings-modal">modal</div>,
}));

vi.mock("./ratings/RatingsDetailsContent", () => ({
  default: () => <div>content</div>,
}));

const mockedUseMetacriticScore = vi.mocked(useMetacriticScore);
const mockedUseSteamGameStats = vi.mocked(useSteamGameStats);

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

const steamStats: SteamGameStats = {
  appId: 292030,
  details: null,
  reviews: {
    totalPositive: 700000,
    totalNegative: 14000,
    totalReviews: 714000,
    score: 9,
    scoreDesc: "Overwhelmingly Positive",
  },
  detailsError: null,
  reviewsError: null,
};

const hltbGame = makeGame({
  igdbRating: 91,
  timeToBeat: {
    hltb: {
      gameId: 1,
      gameName: "Crimson Desert",
      community: {
        reviewScore: 78,
        reviews: 215,
        completed: 314,
        backlog: 1103,
        playing: 258,
      },
    },
  },
});

describe("RatingsKpiCard", () => {
  beforeEach(() => {
    mockedUseMetacriticScore.mockReset();
    mockedUseSteamGameStats.mockReset();
    mockedUseSteamGameStats.mockReturnValue({
      data: steamStats,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });
  });

  it("shows every score tile and the critic sentiment bar", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: score, loading: false });
    render(<RatingsKpiCard game={hltbGame} />);

    expect(screen.getByText("ratings.metacritic")).toBeTruthy();
    expect(screen.getByText("ratings.igdb")).toBeTruthy();
    expect(screen.getByText("ratings.steam")).toBeTruthy();
    expect(screen.getByText("ratings.hltb")).toBeTruthy();
    expect(screen.getByText("77")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    expect(screen.getByText("98%")).toBeTruthy();
    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.getByText("ratings.positive")).toBeTruthy();
    expect(screen.getByText("ratings.mixed")).toBeTruthy();
    expect(screen.getByText("ratings.negative")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /ratings\.openAll/ }));
    expect(screen.getByTestId("ratings-modal")).toBeTruthy();
  });

  it("still opens the sheet when only the IGDB score exists", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: null, loading: false });
    mockedUseSteamGameStats.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });
    render(<RatingsKpiCard game={makeGame({ igdbRating: 91 })} />);

    expect(screen.getByText("ratings.igdb")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    expect(screen.queryByText("ratings.metacritic")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /ratings\.openAll/ }));
    expect(screen.getByTestId("ratings-modal")).toBeTruthy();
  });

  it("renders nothing when no score source is available", () => {
    mockedUseMetacriticScore.mockReturnValue({ data: null, loading: false });
    mockedUseSteamGameStats.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: async () => {},
    });
    const { container } = render(<RatingsKpiCard game={makeGame()} />);
    expect(container.firstChild).toBeNull();
  });
});
