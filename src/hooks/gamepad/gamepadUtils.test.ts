import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HORIZONTAL_TRACK_SELECTOR,
  nearestInDirection,
  scrollElementIntoViewControlled,
  type FocusableCandidate,
} from "./gamepadUtils";

/** Stamp a deterministic viewport rect onto a jsdom element. */
function place(
  el: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function makeButton(
  parent: HTMLElement,
  left: number,
  top: number,
  width = 200,
  height = 300,
): HTMLButtonElement {
  const el = document.createElement("button");
  parent.appendChild(el);
  place(el, left, top, width, height);
  return el;
}

function candidatesFor(elements: HTMLElement[]): FocusableCandidate[] {
  return elements.map((element) => ({ element, onActivate: () => {} }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("nearestInDirection — content-rail wrap", () => {
  it("cycles to the first card when pushing right past the last card", () => {
    const rail = document.createElement("div");
    rail.setAttribute("data-rail-id", "test-rail");
    document.body.appendChild(rail);

    const cards = [
      makeButton(rail, 100, 100),
      makeButton(rail, 400, 100),
      makeButton(rail, 700, 100),
    ];

    expect(
      nearestInDirection(cards[2], candidatesFor(cards), 0),
    ).toBe(cards[0]);
  });

  it("cycles to the last card when pushing left past the first card", () => {
    const rail = document.createElement("div");
    rail.setAttribute("data-rail-id", "test-rail");
    document.body.appendChild(rail);

    const cards = [
      makeButton(rail, 100, 100),
      makeButton(rail, 400, 100),
      makeButton(rail, 700, 100),
    ];

    expect(
      nearestInDirection(cards[0], candidatesFor(cards), Math.PI),
    ).toBe(cards[2]);
  });

  it("still steps normally between cards", () => {
    const rail = document.createElement("div");
    rail.setAttribute("data-rail-id", "test-rail");
    document.body.appendChild(rail);

    const cards = [
      makeButton(rail, 100, 100),
      makeButton(rail, 400, 100),
      makeButton(rail, 700, 100),
    ];

    expect(nearestInDirection(cards[0], candidatesFor(cards), 0)).toBe(cards[1]);
    expect(nearestInDirection(cards[2], candidatesFor(cards), Math.PI)).toBe(cards[1]);
  });

  it("does not wrap a rail that is not marked data-rail-id", () => {
    const strip = document.createElement("div");
    strip.className = "bigscreen-cards";
    document.body.appendChild(strip);

    const cards = [
      makeButton(strip, 100, 100),
      makeButton(strip, 400, 100),
    ];

    expect(nearestInDirection(cards[1], candidatesFor(cards), 0)).toBeNull();
  });
});

describe("nearestInDirection — header strip rail lock", () => {
  it("keeps horizontal focus inside the v3 section strip", () => {
    const nav = document.createElement("nav");
    nav.className = "bigscreen-v3-sections";
    document.body.appendChild(nav);

    const s0 = makeButton(nav, 100, 20, 200, 60);
    const s1 = makeButton(nav, 400, 20, 200, 60);

    // A page card sits almost directly to the right of s0 but outside
    // the strip — without the lock it would win the geometry contest.
    const pageCard = makeButton(document.body, 330, 10, 200, 100);

    expect(nearestInDirection(s0, candidatesFor([s0, s1, pageCard]), 0)).toBe(s1);
  });

  it("does not wrap the header strip at its right edge", () => {
    const nav = document.createElement("nav");
    nav.className = "bigscreen-v3-sections";
    document.body.appendChild(nav);

    const s0 = makeButton(nav, 100, 20, 200, 60);
    const s1 = makeButton(nav, 400, 20, 200, 60);

    // Nothing to the right of s1 and the header must not cycle back to
    // s0, so focus is free to fall through to the utility buttons.
    expect(nearestInDirection(s1, candidatesFor([s0, s1]), 0)).toBeNull();
  });
});

describe("nearestInDirection — grid row wrap", () => {
  function makeGrid() {
    const grid = document.createElement("div");
    grid.className = "bigscreen-library-grid";
    document.body.appendChild(grid);
    const a = makeButton(grid, 100, 100, 170, 255);
    const b = makeButton(grid, 300, 100, 170, 255);
    const c = makeButton(grid, 100, 400, 170, 255);
    const d = makeButton(grid, 300, 400, 170, 255);
    return { a, b, c, d };
  }

  it("steps from the last card of a row to the first card below", () => {
    const { a, b, c, d } = makeGrid();
    expect(nearestInDirection(b, candidatesFor([a, b, c, d]), 0)).toBe(c);
  });

  it("steps from the first card of a row to the last card above", () => {
    const { a, b, c, d } = makeGrid();
    expect(nearestInDirection(c, candidatesFor([a, b, c, d]), Math.PI)).toBe(b);
  });

  it("stops at the grid's outer edges", () => {
    const { a, b, c, d } = makeGrid();
    expect(nearestInDirection(d, candidatesFor([a, b, c, d]), 0)).toBeNull();
    expect(nearestInDirection(a, candidatesFor([a, b, c, d]), Math.PI)).toBeNull();
  });

  it("does not jump rows when a normal step is available", () => {
    const { a, b, c, d } = makeGrid();
    expect(nearestInDirection(a, candidatesFor([a, b, c, d]), 0)).toBe(b);
  });
});

describe("scrollElementIntoViewControlled — header track", () => {
  it("scrolls the v3 section strip toward the focused section", () => {
    const nav = document.createElement("nav");
    nav.className = "bigscreen-v3-sections";
    document.body.appendChild(nav);
    const section = document.createElement("button");
    nav.appendChild(section);

    place(nav, 0, 0, 1000, 80);
    place(section, 600, 0, 200, 80);

    Object.defineProperty(nav, "scrollLeft", { value: 0, writable: true });
    Object.defineProperty(nav, "scrollWidth", { value: 1600, writable: true });
    const scrollTo = vi.fn();
    nav.scrollTo = scrollTo;
    (document.documentElement as unknown as { scrollTo: () => void }).scrollTo = vi.fn();

    scrollElementIntoViewControlled(section);

    expect(scrollTo).toHaveBeenCalledWith({
      left: 350,
      behavior: "smooth",
    });
  });
});

describe("HORIZONTAL_TRACK_SELECTOR", () => {
  it("includes the v3 header strip alongside the content rails", () => {
    expect(HORIZONTAL_TRACK_SELECTOR).toContain(".bigscreen-v3-sections");
    expect(HORIZONTAL_TRACK_SELECTOR).toContain("[data-rail-id]");
  });
});
