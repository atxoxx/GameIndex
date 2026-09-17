import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { StoreGameSummary } from "../../types/game";
import BigScreenStoreGameCard from "./BigScreenStoreGameCard";

// Non-native container: it must say what it is, because the focus hook no
// longer forces an ARIA role onto the elements it registers.
const { registered, registerAction } = vi.hoisted(() => {
  const registered: HTMLElement[] = [];
  const registerAction = vi.fn((element: HTMLElement) => {
    registered.push(element);
    return () => {
      const index = registered.indexOf(element);
      if (index >= 0) registered.splice(index, 1);
    };
  });
  return { registered, registerAction };
});

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: "poster.png",
    staticPosterUrl: "poster.png",
    animatedPosterUrl: null,
    handleError: () => {},
  }),
}));

function makeGame(overrides: Partial<StoreGameSummary> = {}): StoreGameSummary {
  return {
    id: 7,
    name: "Portal 2",
    slug: "portal-2",
    summary: null,
    rating: 95,
    aggregatedRating: null,
    coverUrl: "cover.png",
    logoUrl: null,
    genres: ["Puzzle"],
    platforms: ["PC"],
    firstReleaseDate: null,
    totalRatingCount: 0,
    hypes: 0,
    ...overrides,
  } as StoreGameSummary;
}

describe("BigScreenStoreGameCard", () => {
  it("announces itself as a link, since activating it opens the store page", () => {
    render(<BigScreenStoreGameCard game={makeGame()} onClick={() => {}} />);

    const card = screen.getByRole("link", { name: /Portal 2/ });
    expect(card).toHaveAttribute("data-game-slug", "portal-2");
  });

  it("registers with the focus engine and activates with the game", () => {
    const onClick = vi.fn();
    render(<BigScreenStoreGameCard game={makeGame()} onClick={onClick} />);

    const card = screen.getByRole("link", { name: /Portal 2/ });
    expect(registered).toContain(card);

    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toMatchObject({ slug: "portal-2" });
  });

  it("keeps the rating badge and cover inside the same single link", () => {
    render(<BigScreenStoreGameCard game={makeGame()} onClick={() => {}} />);

    // The cover art and the rating are chrome on the link, not extra
    // controls competing with it for focus.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /Portal 2/ }).querySelector(".bigscreen-store-card-rating"),
    ).not.toBeNull();
  });
});
