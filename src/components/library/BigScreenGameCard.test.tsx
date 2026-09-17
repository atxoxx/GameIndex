import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Game } from "../../types/game";
import BigScreenGameCard from "./BigScreenGameCard";

// The card is a non-native container: it must say what it is (a link to the
// game's page), because the focus hook deliberately no longer forces an
// ARIA role onto the elements it registers.
const { registered, registerAction, runningIds } = vi.hoisted(() => {
  const registered: HTMLElement[] = [];
  const registerAction = vi.fn((element: HTMLElement) => {
    registered.push(element);
    return () => {
      const index = registered.indexOf(element);
      if (index >= 0) registered.splice(index, 1);
    };
  });
  const runningIds: string[] = [];
  return { registered, registerAction, runningIds };
});

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ runningGameIds: runningIds }),
}));
vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: "poster.png",
    staticPosterUrl: "poster.png",
    animatedPosterUrl: null,
    handleError: () => {},
  }),
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Portal 2",
    platform: "PC",
    path: "",
    installed: true,
    playTime: "5h",
    addedAt: 1,
    ...overrides,
  } as Game;
}

describe("BigScreenGameCard", () => {
  it("announces itself as a link, since activating it opens the game page", () => {
    render(<BigScreenGameCard game={makeGame()} onClick={() => {}} />);

    const card = screen.getByRole("link", { name: /Portal 2/ });
    expect(card).toHaveAttribute("data-game-id", "game-1");
  });

  it("registers with the focus engine and activates on click", () => {
    const onClick = vi.fn();
    render(<BigScreenGameCard game={makeGame()} onClick={onClick} />);

    const card = screen.getByRole("link", { name: /Portal 2/ });
    expect(registered).toContain(card);

    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("adds the running indicator without creating a second focus target", () => {
    runningIds.push("game-1");
    try {
      const { unmount } = render(
        <BigScreenGameCard game={makeGame()} onClick={() => {}} />,
      );
      expect(screen.getAllByRole("link")).toHaveLength(1);
      // The dot is decorative chrome on the same link, not a nested control.
      expect(
        screen
          .getByRole("link", { name: /Portal 2/ })
          .querySelector(".bigscreen-game-card-running-dot"),
      ).not.toBeNull();
      unmount();
    } finally {
      runningIds.length = 0;
    }
  });
});
