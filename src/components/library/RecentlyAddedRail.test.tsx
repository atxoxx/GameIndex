import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Game } from "../../types/game";
import RecentlyAddedRail from "./RecentlyAddedRail";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "lib.rail.recentlyAdded.subtitle") {
        return `${vars?.count} newest games`;
      }
      const dict: Record<string, string> = {
        "lib.rail.recentlyAdded.title": "Recently Added",
        "lib.rail.recentlyAdded.aria": "Recently added games",
        "lib.rail.recentlyAdded.expand": "Expand recently added",
        "lib.rail.recentlyAdded.collapse": "Collapse recently added",
        "store.tab.new": "New",
        "common.expand": "Expand",
        "common.collapse": "Collapse",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ setSelectedGameId: vi.fn() }),
}));

vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: null,
    staticPosterUrl: null,
    animatedPosterUrl: null,
    handleError: vi.fn(),
  }),
}));

const games = [1, 2, 3].map(
  (i) =>
    ({
      id: `game-${i}`,
      name: `Game ${i}`,
      addedAt: i,
      platform: "PC",
      playTime: "2h",
    }) as unknown as Game
);

function renderRail(props: { games?: Game[] } = {}) {
  return render(
    <MemoryRouter>
      <RecentlyAddedRail games={props.games ?? games} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("RecentlyAddedRail", () => {
  it("shows the newest games by default instead of starting collapsed", () => {
    const { container } = renderRail();

    expect(
      screen.getByRole("button", { name: "Collapse recently added" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".lib-rail--collapsed")).toBeNull();
    expect(screen.getByText("Game 1")).toBeInTheDocument();
    expect(screen.getByText("Game 3")).toBeInTheDocument();
  });

  it("still collapses on demand and remembers the choice", () => {
    renderRail();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse recently added" })
    );

    expect(
      screen.getByRole("button", { name: "Expand recently added" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("gamelib:rail:recently-added:collapsed:v2")).toBe(
      "true"
    );
  });

  it("stays open when there is nothing to show", () => {
    renderRail({ games: [] });

    expect(
      screen.getByRole("button", { name: "Collapse recently added" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("0 newest games")).toBeInTheDocument();
  });
});
