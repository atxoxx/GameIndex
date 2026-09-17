import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import LibraryVirtualGrid from "./LibraryVirtualGrid";
import type { Game } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const observedElements: Element[] = [];

class NoopResizeObserver {
  observe(el: Element) {
    observedElements.push(el);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  observedElements.length = 0;
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeGames(count: number, platform: string, prefix = "Game"): Game[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${platform}-${prefix}-${i}`,
    name: `${prefix} ${i}`,
    platform,
  })) as unknown as Game[];
}

function renderItem(game: Game, index: number) {
  return (
    <div className="lib-card" data-testid="card" data-index={index} key={game.id}>
      {game.name}
    </div>
  );
}

describe("LibraryVirtualGrid grouped windowing", () => {
  it("mounts only a bounded number of cards for a large grouped library", () => {
    const games = makeGames(200, "Steam");
    const { container } = render(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    expect(container.querySelector(".lib-grouped-container")).toBeTruthy();
    expect(container.querySelectorAll(".lib-group-header")).toHaveLength(1);
    expect(container.querySelector(".lib-group-count-pill")?.textContent).toBe("200");

    const mounted = container.querySelectorAll(".lib-card");
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(20);
  });

  it("still mounts every card for a small grouped library", () => {
    const games = [...makeGames(4, "Steam"), ...makeGames(3, "GOG")];
    const { container } = render(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    expect(container.querySelectorAll(".lib-group-header")).toHaveLength(2);
    expect(container.querySelectorAll(".lib-card")).toHaveLength(7);
    expect(container.querySelectorAll(".lib-group-row-spacer")).toHaveLength(0);
  });

  it("keeps the window bounded across metadata patches", () => {
    const games = makeGames(200, "Steam");
    const { container, rerender } = render(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );
    const before = container.querySelectorAll(".lib-card").length;

    const patched = games.map((g, i) => (i === 150 ? { ...g, name: "Enriched" } : g));
    rerender(
      <LibraryVirtualGrid
        items={patched}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    const after = container.querySelectorAll(".lib-card").length;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(20);
    expect(after).toBe(before);
  });

  it("drops the cards and spacers when a large group is collapsed", () => {
    const games = makeGames(200, "Steam");
    const { container } = render(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    fireEvent.click(container.querySelector(".lib-group-header") as HTMLElement);

    expect(container.querySelectorAll(".lib-card")).toHaveLength(0);
    expect(container.querySelectorAll(".lib-group-row-spacer")).toHaveLength(0);
    expect(container.querySelector(".lib-group-header")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders an empty grouped container when nothing matches", () => {
    const { container } = render(
      <LibraryVirtualGrid
        items={[]}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    expect(container.querySelector(".lib-grouped-container")).toBeTruthy();
    expect(container.querySelectorAll(".lib-group-header")).toHaveLength(0);
    expect(container.querySelectorAll(".lib-card")).toHaveLength(0);
  });

  it("rebinds windowing to the live container when groupBy swaps branches", () => {
    const games = makeGames(200, "Steam");

    const { container, rerender } = render(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="none"
        renderItem={renderItem}
      />
    );

    const flatScroll = container.querySelector(".lib-grid-scroll") as HTMLElement;
    expect(flatScroll).toBeTruthy();
    expect(observedElements).toContain(flatScroll);
    expect(container.querySelectorAll(".lib-card").length).toBeLessThan(20);

    rerender(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    const grouped = container.querySelector(".lib-grouped-container") as HTMLElement;
    expect(grouped).toBeTruthy();
    expect(container.querySelector(".lib-grid-scroll")).toBeNull();
    // The observer must have rebound to the branch that is actually in the DOM.
    expect(observedElements.filter((el) => el === grouped && el.isConnected).length).toBeGreaterThan(0);
    const groupedCards = container.querySelectorAll(".lib-card");
    expect(groupedCards.length).toBeGreaterThan(0);
    expect(groupedCards.length).toBeLessThan(20);

    rerender(
      <LibraryVirtualGrid
        items={games}
        density="cozy"
        isBigScreen={false}
        groupBy="none"
        renderItem={renderItem}
      />
    );

    const flatAgain = container.querySelector(".lib-grid-scroll") as HTMLElement;
    expect(flatAgain).toBeTruthy();
    expect(observedElements.filter((el) => el === flatAgain && el.isConnected).length).toBeGreaterThan(0);
    const flatCards = container.querySelectorAll(".lib-card");
    expect(flatCards.length).toBeGreaterThan(0);
    expect(flatCards.length).toBeLessThan(20);
  });

  it("reserves height with a spacer instead of mounting the whole group", () => {
    const games = makeGames(500, "Steam");
    const { container } = render(
      <LibraryVirtualGrid
        items={games}
        density="list"
        isBigScreen={false}
        groupBy="platform"
        renderItem={renderItem}
      />
    );

    expect(container.querySelectorAll(".lib-card").length).toBeLessThan(20);
    const spacers = container.querySelectorAll<HTMLElement>(".lib-group-row-spacer");
    expect(spacers.length).toBeGreaterThan(0);
    expect(parseFloat(spacers[0].style.height)).toBeGreaterThan(0);
  });
});
