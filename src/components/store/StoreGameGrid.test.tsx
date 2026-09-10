import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreGameGrid from "./StoreGameGrid";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../hooks/useGameCardArt", () => ({
  useGameCardArt: () => ({
    displayUrl: "cover.jpg",
    staticPosterUrl: "cover.jpg",
    animatedPosterUrl: null,
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

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const games = [
  { id: 1, slug: "hades", name: "Hades", genres: [], platforms: [] },
  { id: 2, slug: "celeste", name: "Celeste", genres: [], platforms: [] },
] as unknown as StoreGameSummary[];

function renderGrid(compareSlugs = new Set<string>()) {
  const onCompare = vi.fn();
  const { container } = render(
    <StoreGameGrid
      games={games}
      loading={false}
      error={null}
      hasMore={false}
      onLoadMore={() => {}}
      onCardClick={() => {}}
      onCompare={onCompare}
      compareSlugs={compareSlugs}
    />
  );
  return { container, onCompare };
}

describe("StoreGameGrid compare wiring", () => {
  it("marks pinned cards active and forwards compare clicks", () => {
    const { container, onCompare } = renderGrid(new Set(["hades"]));

    const buttons = container.querySelectorAll(".store-card-compare");
    expect(buttons.length).toBe(2);
    expect(buttons[0].classList.contains("active")).toBe(true);
    expect(buttons[1].classList.contains("active")).toBe(false);

    fireEvent.click(buttons[1]);
    expect(onCompare).toHaveBeenCalledWith(games[1], expect.anything());
  });
});
