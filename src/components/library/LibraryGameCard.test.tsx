import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryGameCard from "./LibraryGameCard";
import type { Game } from "../../types/game";

const launchGame = vi.fn();

vi.mock("../../context/GameContext", () => ({
  NO_IGDB_MATCH_SOURCE: "none",
  useGameCardActions: () => ({
    enqueueEnrich: vi.fn(),
    launchGame,
  }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "game.play": "Play",
        "game.resume": "Resume",
        "game.playAria": "Play {name}",
        "game.resumeAria": "Resume {name}",
        "library.running": "Running",
        "library.moreActions": "More actions",
        "library.vrBadge": "VR",
        "library.romBadge": "ROM",
        "game.status.playing": "Playing",
        "game.status.backlog": "Backlog",
        "game.status.completed": "Completed",
        "game.status.onHold": "On Hold",
        "game.status.abandoned": "Abandoned",
        "lib.rail.continue.never": "Never played",
        "lib.rail.continue.justNow": "Just now",
        "gameInfo.igdbRating": "IGDB rating",
        "gameInfo.criticRating": "Critic rating",
      };
      if (key === "game.playAria") return `Play ${vars?.name}`;
      if (key === "game.resumeAria") return `Resume ${vars?.name}`;
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useCardDisplaySettings: () => ({
    showCardBadges: true,
    isSimpleUi: false,
    badgePlatform: true,
    badgeInstall: true,
    badgePlaytime: true,
    badgeRating: true,
  }),
}));

vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: null,
    staticPosterUrl: null,
    animatedPosterUrl: null,
    isIcon: false,
    handleError: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSharedViewportVisibility", () => ({
  useSharedViewportVisibility: () => undefined,
}));

vi.mock("../../utils/soundEffects", () => ({
  playLaunchSound: vi.fn(),
}));

const game: Game = {
  id: "game-1",
  name: "Hades II",
  platform: "Steam",
  playTime: "42h",
  playStatus: "playing",
  igdbRating: 96,
  addedAt: 1,
} as Game;

function renderCard(props: Partial<React.ComponentProps<typeof LibraryGameCard>> = {}) {
  const onClick = props.onClick ?? vi.fn();
  const onContextMenu = props.onContextMenu ?? vi.fn();
  const onLaunch = props.onLaunch ?? vi.fn();
  const onToggleSelect = props.onToggleSelect ?? vi.fn();

  render(
    <LibraryGameCard
      game={game}
      density="cozy"
      isRunning={false}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onLaunch={onLaunch}
      onToggleSelect={onToggleSelect}
      {...props}
    />
  );

  return { onClick, onContextMenu, onLaunch, onToggleSelect };
}

afterEach(() => {
  cleanup();
  launchGame.mockClear();
});

describe("LibraryGameCard", () => {
  it("shows the poster metadata as chips and launches from the hover action", () => {
    const { onLaunch, onClick } = renderCard();

    expect(screen.getByText("Hades II")).toBeInTheDocument();
    expect(screen.getByText("Steam")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(screen.getByText("Playing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play Hades II" }));

    expect(onLaunch).toHaveBeenCalledWith(game);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("falls back to a lettered placeholder when a game has no artwork", () => {
    renderCard();

    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("opens the details view when the card itself is clicked", () => {
    const { onClick } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Hades II" }));

    expect(onClick).toHaveBeenCalled();
  });

  it("opens the actions menu from the overflow button", () => {
    const { onContextMenu } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "More actions: Hades II" }));

    expect(onContextMenu).toHaveBeenCalled();
  });

  it("toggles selection instead of navigating in bulk mode", () => {
    const { onClick, onToggleSelect } = renderCard({ selectable: true });

    fireEvent.click(screen.getByRole("button", { name: "Hades II" }));

    expect(onToggleSelect).toHaveBeenCalledWith(game);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a compact card without chips", () => {
    renderCard({ density: "compact" });

    expect(screen.getByText("Hades II")).toBeInTheDocument();
    expect(screen.getByText("42h")).toBeInTheDocument();
    expect(screen.queryByText("96%")).not.toBeInTheDocument();
  });

  it("renders the list row with status, playtime and rating columns", () => {
    const { onLaunch } = renderCard({ density: "list" });

    expect(screen.getByText("Steam")).toBeInTheDocument();
    expect(screen.getByText("Playing")).toBeInTheDocument();
    expect(screen.getByText("42h")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play Hades II" }));
    expect(onLaunch).toHaveBeenCalledWith(game);
  });
});
