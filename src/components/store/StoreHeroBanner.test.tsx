import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreHeroBanner from "./StoreHeroBanner";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useProgressiveImages", () => ({
  useProgressiveImage: () => ["cover.jpg"],
}));

afterEach(cleanup);

const game = {
  id: "hades",
  slug: "hades",
  name: "Hades",
  coverUrl: "cover.jpg",
  rating: 93,
  firstReleaseDate: "2020-09-17",
  genres: ["Action"],
} as unknown as StoreGameSummary;

describe("StoreHeroBanner", () => {
  it("stays empty while the hero is in view", () => {
    const { container } = render(
      <StoreHeroBanner
        game={game}
        visible={false}
        onExpand={() => {}}
        onPickGame={() => {}}
      />
    );

    expect(container.querySelector(".store-hero-banner")).toBeNull();
  });

  it("shows the active pick and wires expand / explore / cycle", () => {
    const onExpand = vi.fn();
    const onPickGame = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { getByText, getByLabelText } = render(
      <StoreHeroBanner
        game={game}
        visible
        canCycle
        onPrev={onPrev}
        onNext={onNext}
        onExpand={onExpand}
        onPickGame={onPickGame}
      />
    );

    expect(getByText("Hades")).toBeInTheDocument();
    expect(getByText("93%")).toBeInTheDocument();

    fireEvent.click(getByLabelText("store.hero.bannerExpand"));
    expect(onExpand).toHaveBeenCalledTimes(1);

    fireEvent.click(getByText("store.spotlight.explore"));
    expect(onPickGame).toHaveBeenCalledWith(game);

    fireEvent.click(getByLabelText("store.spotlight.prev"));
    fireEvent.click(getByLabelText("store.spotlight.next"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
