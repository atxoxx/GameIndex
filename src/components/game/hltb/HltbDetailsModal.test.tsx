import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HltbDetailsModal from "./HltbDetailsModal";
import { HltbDetailsContent } from "./HltbDetailsContent";
import type { HltbStats } from "../../../types/game";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const HOUR = 3600;

function makeStats(overrides: Partial<HltbStats> = {}): HltbStats {
  return {
    gameId: 1,
    gameName: "Enshrouded",
    gameType: "game",
    releaseWorld: "2024-01-24",
    imageUrl: "https://example.test/cover.jpg",
    description: "Survival action RPG",
    developer: "Keen Games",
    publisher: "Keen Games",
    genres: "Action, RPG",
    platforms: "PC",
    levels: { singlePlayer: true, coOp: true, multiplayer: true },
    mainStory: { average: 48 * HOUR, median: 50 * HOUR, low: 29 * HOUR, high: 64 * HOUR, count: 9 },
    mainExtra: { average: 70 * HOUR, median: 67 * HOUR, low: 45 * HOUR, high: 125 * HOUR, count: 25 },
    completionist: { average: 76 * HOUR, median: 68 * HOUR, low: 56 * HOUR, high: 138 * HOUR, count: 21 },
    allStyles: { average: 68 * HOUR, median: 63 * HOUR, low: 39 * HOUR, high: 134 * HOUR, count: 55 },
    speedrun: { average: 20 * HOUR, low: 15 * HOUR, high: 30 * HOUR, count: 12 },
    investedCo: { average: 30 * HOUR, count: 4 },
    community: {
      playing: 78,
      backlog: 1661,
      completed: 218,
      replays: 25,
      retired: 131,
      reviews: 81,
      reviewScore: 78,
      total: 3231,
    },
    reviewHistogram: [
      { score: 100, count: 21 },
      { score: 50, count: 5 },
      { score: 5, count: 1 },
    ],
    platformStats: [
      {
        platform: "PC",
        mainStory: 48 * HOUR,
        mainExtra: 70 * HOUR,
        completionist: 76 * HOUR,
        allStyles: 68 * HOUR,
        completed: 119,
        low: 29 * HOUR,
        high: 120 * HOUR,
      },
    ],
    related: [
      { gameId: 2, gameName: "Enshrouded: Prologue", gameType: "dlc", mainStory: 5 * HOUR },
    ],
    url: "https://howlongtobeat.com/game/1",
    ...overrides,
  };
}

describe("HltbDetailsModal", () => {
  beforeEach(() => {
    showToast.mockReset();
  });

  it("renders the hero, playstyle ranges and personal progress", () => {
    render(
      <HltbDetailsModal stats={makeStats()} playTime="26h" onClose={vi.fn()} />
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Enshrouded" })).toBeTruthy();
    expect(screen.getByText("Survival action RPG")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /hltb\.tabTimes/ })).toBeTruthy();
    expect(screen.getByText(/hltb\.percentOfStyle.*54/)).toBeTruthy();

    const mainRow = screen.getByRole("button", { name: /gameInfo\.mainStory/ });
    const plusRow = screen.getByRole("button", { name: /gameInfo\.mainExtra/ });
    expect(mainRow).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("48h")).toBeTruthy();

    fireEvent.click(plusRow);
    expect(plusRow).toHaveAttribute("aria-pressed", "true");
    expect(mainRow).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/hltb\.percentOfStyle.*37/)).toBeTruthy();
  });

  it("reveals the exact breakdown table on demand", () => {
    render(<HltbDetailsModal stats={makeStats()} playTime="26h" onClose={vi.fn()} />);

    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "hltb.showNumbers" }));

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("hltb.style")).toBeTruthy();
    expect(screen.getByText("hltb.submissionsShort")).toBeTruthy();
    expect(screen.getByRole("button", { name: "hltb.hideNumbers" })).toBeTruthy();
  });

  it("switches between community, platform and related tabs", () => {
    render(<HltbDetailsModal stats={makeStats()} playTime="26h" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: /hltb\.tabCommunity/ }));
    expect(screen.getByText("hltb.communityScore")).toBeTruthy();
    expect(screen.getByText("hltb.reviewDistribution")).toBeTruthy();
    expect(screen.getAllByText("78").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /hltb\.tabPlatforms/ }));
    expect(screen.getAllByText("PC").length).toBeGreaterThan(0);
    expect(screen.getByText("hltb.rangeColumn")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /hltb\.tabRelated/ }));
    expect(screen.getByText("Enshrouded: Prologue")).toBeTruthy();
    expect(screen.getByText("hltb.dlc")).toBeTruthy();
  });

  it("refreshes stats and closes on Escape", async () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <HltbDetailsModal
        stats={makeStats()}
        playTime="26h"
        onClose={onClose}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "hltb.refresh" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("hltb.refreshed", "success")
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces a refresh failure without leaving the button busy", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("network down"));

    render(
      <HltbDetailsModal
        stats={makeStats()}
        playTime="26h"
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "hltb.refresh" }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("hltb.refreshFailed", "error")
    );
    expect(screen.getByRole("button", { name: "hltb.refresh" })).not.toBeDisabled();
  });

  it("renders every section stacked for Big Screen without tabs", () => {
    render(<HltbDetailsContent stats={makeStats()} playTime="26h" variant="stacked" />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("hltb.playStyles")).toBeTruthy();
    expect(screen.getByText("hltb.speedruns")).toBeTruthy();
    expect(screen.getByText("hltb.coopMp")).toBeTruthy();
    expect(screen.getByText("hltb.byPlatform")).toBeTruthy();
    expect(screen.getByText("Enshrouded: Prologue")).toBeTruthy();
  });

  it("hides the personal gauge when the game has no tracked playtime", () => {
    render(<HltbDetailsModal stats={makeStats()} onClose={vi.fn()} />);

    expect(screen.queryByText("hltb.yourPlaytime")).toBeNull();
    expect(screen.getByRole("button", { name: /gameInfo\.mainStory/ })).toBeTruthy();
  });
});
