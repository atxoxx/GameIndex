import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RatingsDetailsModal from "./RatingsDetailsModal";
import { RatingsDetailsContent } from "./RatingsDetailsContent";
import type {
  Game,
  MetacriticScore,
  SteamGameReviews,
} from "../../../types/game";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const metacritic: MetacriticScore = {
  url: "https://www.metacritic.com/game/the-witcher-3-wild-hunt/",
  metascore: 92,
  metascoreSentiment: "Universal Acclaim",
  criticReviewCount: 79,
  userScore: 9.1,
  userRatingCount: 20314,
  positiveCount: 70,
  neutralCount: 8,
  negativeCount: 1,
  userPositiveCount: 18364,
  userNeutralCount: 922,
  userNegativeCount: 1028,
};

const steam: SteamGameReviews = {
  totalPositive: 700000,
  totalNegative: 14000,
  totalReviews: 714000,
  score: 9,
  scoreDesc: "Overwhelmingly Positive",
};

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "The Witcher 3: Wild Hunt",
    platform: "PC",
    path: "",
    installed: true,
    playTime: "42h",
    addedAt: 1,
    developer: "CD Projekt Red",
    releaseDate: "2015-05-19",
    steamAppId: 292030,
    igdbRating: 93,
    timeToBeat: {
      hltb: {
        gameId: 1,
        gameName: "The Witcher 3: Wild Hunt",
        url: "https://howlongtobeat.com/game/1",
        community: {
          completed: 18364,
          backlog: 42000,
          playing: 812,
          reviews: 215,
          reviewScore: 91,
          total: 90000,
        },
        reviewHistogram: [
          { score: 100, count: 120 },
          { score: 80, count: 60 },
          { score: 40, count: 8 },
        ],
      },
    },
    ...overrides,
  } as Game;
}

describe("RatingsDetailsModal", () => {
  beforeEach(() => {
    openUrl.mockReset();
  });

  it("renders the score strip and switches between critics and community", () => {
    render(
      <RatingsDetailsModal
        game={makeGame()}
        metacritic={metacritic}
        steam={steam}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "The Witcher 3: Wild Hunt" })
    ).toBeTruthy();

    // Score strip has every source, including the new HLTB cell.
    expect(screen.getByText("ratings.metascore")).toBeTruthy();
    expect(screen.getByText("ratings.userScore")).toBeTruthy();
    expect(screen.getAllByText("ratings.igdb").length).toBeGreaterThan(0);
    expect(screen.getAllByText("92").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9.1").length).toBeGreaterThan(0);

    // Overview summarises critics and players.
    expect(screen.getByText("ratings.criticsSource")).toBeTruthy();
    expect(screen.getByText("ratings.playersSource")).toBeTruthy();
    expect(screen.getByText("ratings.steamReviews")).toBeTruthy();
    expect(screen.getByText("ratings.hltbSource")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /ratings\.tabCritics/ }));
    expect(screen.getByText("ratings.metacriticTitle")).toBeTruthy();
    expect(screen.getByText(/ratings\.basedOnCritics/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /ratings\.tabCommunity/ }));
    expect(screen.getByText("ratings.playersSource")).toBeTruthy();
    expect(screen.getByText("ratings.steamReviews")).toBeTruthy();
    expect(screen.getAllByText("hltb.communityScore").length).toBeGreaterThan(0);
    expect(screen.getByText("hltb.reviewDistribution")).toBeTruthy();
    expect(screen.getAllByText("hltb.completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("91").length).toBeGreaterThan(0);
  });

  it("opens the available sources from the footer", () => {
    render(
      <RatingsDetailsModal
        game={makeGame()}
        metacritic={metacritic}
        steam={steam}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "ratings.metacritic" }));
    expect(openUrl).toHaveBeenCalledWith(metacritic.url);

    fireEvent.click(screen.getByRole("button", { name: "ratings.steam" }));
    expect(openUrl).toHaveBeenCalledWith(
      "https://store.steampowered.com/app/292030/"
    );

    fireEvent.click(screen.getByRole("button", { name: "gameInfo.hltb" }));
    expect(openUrl).toHaveBeenCalledWith("https://howlongtobeat.com/game/1");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <RatingsDetailsModal
        game={makeGame()}
        metacritic={metacritic}
        steam={steam}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers a quiet empty state when no source has data", () => {
    render(
      <RatingsDetailsModal
        game={makeGame({ igdbRating: undefined, timeToBeat: undefined })}
        metacritic={null}
        steam={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("ratings.noRatings")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("still shows the community tab when Metacritic has nothing", () => {
    render(
      <RatingsDetailsModal
        game={makeGame()}
        metacritic={null}
        steam={steam}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole("tab", { name: /ratings\.tabCritics/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /ratings\.tabCommunity/ }));
    expect(screen.getByText("ratings.steamReviews")).toBeTruthy();
    expect(screen.getAllByText("hltb.communityScore").length).toBeGreaterThan(0);
  });

  it("stacks the detail sections for Big Screen without tabs", () => {
    render(
      <RatingsDetailsContent
        game={makeGame()}
        metacritic={metacritic}
        steam={steam}
        variant="stacked"
      />
    );

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("ratings.metacriticTitle")).toBeTruthy();
    expect(screen.getByText("ratings.steamReviews")).toBeTruthy();
    expect(screen.getByText("hltb.reviewDistribution")).toBeTruthy();
  });
});
