import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import GameRail from "../GameRail";
import type { Game } from "../../../types/game";
import type { ModsOverviewEntry } from "../../../types/mods";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function makeGame(id: string, name: string): Game {
  return {
    id,
    name,
    path: `C:/games/${id}`,
    platform: "Steam",
    installed: true,
    playTime: "0h",
    addedAt: 0,
  } as Game;
}

const games = [makeGame("a", "Alpha"), makeGame("b", "Beta")];

const overview = new Map<string, ModsOverviewEntry>([
  ["a", { gameId: "a", total: 5, enabled: 4, updates: 2, engines: ["bethesda"] }],
]);

function makeProps(overrides: Partial<React.ComponentProps<typeof GameRail>> = {}) {
  return {
    games,
    totalGames: games.length,
    overview,
    selectedGameId: "a",
    onSelect: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    filter: "all" as const,
    onFilterChange: vi.fn(),
    sort: "mods" as const,
    onSortChange: vi.fn(),
    moddedCount: 1,
    updatesCount: 2,
    refreshing: false,
    onRefresh: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
}

describe("GameRail", () => {
  afterEach(cleanup);

  it("lists games and reports selection", () => {
    const onSelect = vi.fn();
    render(<GameRail {...makeProps({ onSelect })} />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Beta"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("shows the update count for games that have pending updates", () => {
    render(<GameRail {...makeProps()} />);

    expect(screen.getByTitle("mods.updatesAvailable")).toHaveTextContent("2");
  });

  it("hides game names when the rail is collapsed", () => {
    render(<GameRail {...makeProps({ collapsed: true })} />);

    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("surfaces an empty state when no game matches", () => {
    render(<GameRail {...makeProps({ games: [] })} />);

    expect(screen.getByText("mods.noGamesMatch")).toBeInTheDocument();
  });
});
