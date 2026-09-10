import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import StoreGameCard, { ANIMATED_PREVIEW_DELAY_MS } from "./StoreGameCard";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: "cover.jpg",
    staticPosterUrl: "cover.jpg",
    animatedPosterUrl: "animated.webp",
    isIcon: false,
    handleError: () => {},
  }),
}));

vi.mock("../../context/CrackWatchContext", () => ({
  useCrackWatch: () => null,
}));

vi.mock("../../context/PriceContext", () => ({
  usePrice: () => null,
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const game = {
  id: "hades",
  slug: "hades",
  name: "Hades",
  coverUrl: "cover.jpg",
  rating: 93,
  genres: ["Action"],
  platforms: ["PC"],
} as unknown as StoreGameSummary;

function renderCard(onHoverChange = vi.fn()) {
  const utils = render(
    <StoreGameCard game={game} onClick={() => {}} onHoverChange={onHoverChange} />
  );
  return {
    ...utils,
    card: utils.container.querySelector(".store-game-card") as HTMLElement,
    animated: () => utils.container.querySelector(".store-card-cover-animated"),
    onHoverChange,
  };
}

describe("StoreGameCard compare action", () => {
  afterEach(() => {
    cleanup();
  });

  it("calls onCompare with the game when the compare button is pressed", () => {
    const onCompare = vi.fn();
    const { container } = render(
      <StoreGameCard game={game} onClick={() => {}} onCompare={onCompare} />
    );
    const button = container.querySelector(".store-card-compare") as HTMLElement;
    expect(button).not.toBeNull();
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(onCompare).toHaveBeenCalledWith(game, expect.anything());
  });

  it("renders the pinned state and toggles back off", () => {
    const onCompare = vi.fn();
    const { container } = render(
      <StoreGameCard game={game} onClick={() => {}} onCompare={onCompare} inCompare />
    );
    const button = container.querySelector(".store-card-compare") as HTMLElement;
    expect(button.classList.contains("active")).toBe(true);
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(onCompare).toHaveBeenCalledTimes(1);
  });
});

describe("StoreGameCard animated preview hover intent", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("defers the animated poster until the pointer settles (happy path)", () => {
    vi.useFakeTimers();
    const { card, animated, onHoverChange } = renderCard();
    expect(animated()).toBeNull();

    fireEvent.mouseEnter(card);
    // The hero pause signal is immediate even though the preview is deferred.
    expect(onHoverChange).toHaveBeenCalledWith(true);
    expect(animated()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ANIMATED_PREVIEW_DELAY_MS);
    });
    expect(animated()).not.toBeNull();
  });

  it("never loads animated art when the pointer only sweeps past (error path)", () => {
    vi.useFakeTimers();
    const { card, animated } = renderCard();

    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(ANIMATED_PREVIEW_DELAY_MS - 20);
    });
    fireEvent.mouseLeave(card);

    act(() => {
      vi.advanceTimersByTime(ANIMATED_PREVIEW_DELAY_MS * 5);
    });
    expect(animated()).toBeNull();
  });

  it("unmounts the animated poster on leave", () => {
    vi.useFakeTimers();
    const { card, animated } = renderCard();

    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(ANIMATED_PREVIEW_DELAY_MS);
    });
    expect(animated()).not.toBeNull();

    fireEvent.mouseLeave(card);
    expect(animated()).toBeNull();
  });

  it("cancels the pending preview on unmount", () => {
    vi.useFakeTimers();
    const { card, unmount } = renderCard();

    fireEvent.mouseEnter(card);
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(ANIMATED_PREVIEW_DELAY_MS * 2);
      });
    }).not.toThrow();
  });
});
