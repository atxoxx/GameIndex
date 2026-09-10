import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFocusMemory,
  focusKeyFor,
  focusSelectorForKey,
  parseFocusGameKey,
  recallFocus,
  rememberFocus,
} from "./focusMemory";

beforeEach(() => {
  clearFocusMemory();
  document.body.innerHTML = "";
});

describe("focusKeyFor", () => {
  it("prefers an explicit data-focus-key", () => {
    const card = document.createElement("div");
    card.setAttribute("data-focus-key", "action:play");
    card.setAttribute("data-game-id", "42");
    document.body.appendChild(card);

    const inner = document.createElement("span");
    card.appendChild(inner);

    expect(focusKeyFor(inner)).toBe("action:play");
  });

  it("falls back to data-game-id", () => {
    const card = document.createElement("div");
    card.setAttribute("data-game-id", "halo");
    document.body.appendChild(card);

    const inner = document.createElement("span");
    card.appendChild(inner);

    expect(focusKeyFor(inner)).toBe("game:halo");
  });

  it("scopes a card to its owning rail when present", () => {
    const rail = document.createElement("section");
    rail.setAttribute("data-rail-id", "continue-playing");
    document.body.appendChild(rail);
    const card = document.createElement("div");
    card.setAttribute("data-game-id", "doom");
    rail.appendChild(card);

    expect(focusKeyFor(card)).toBe("game:doom@continue-playing");
  });

  it("returns null for untracked elements", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    expect(focusKeyFor(el)).toBeNull();
    expect(focusKeyFor(null)).toBeNull();
  });
});

describe("rememberFocus / recallFocus", () => {
  it("round-trips the focused element per route", () => {
    const card = document.createElement("div");
    card.setAttribute("data-game-id", "doom");
    document.body.appendChild(card);

    rememberFocus("/library", card);
    expect(recallFocus("/library")).toBe("game:doom");
    expect(recallFocus("/store")).toBeNull();
  });

  it("keeps routes independent and overwrites on newer focus", () => {
    const first = document.createElement("div");
    first.setAttribute("data-game-id", "a");
    const second = document.createElement("div");
    second.setAttribute("data-game-id", "b");
    document.body.appendChild(first);
    document.body.appendChild(second);

    rememberFocus("/library", first);
    rememberFocus("/store", second);

    expect(recallFocus("/library")).toBe("game:a");
    expect(recallFocus("/store")).toBe("game:b");

    rememberFocus("/library", second);
    expect(recallFocus("/library")).toBe("game:b");
    expect(recallFocus("/store")).toBe("game:b");
  });

  it("ignores untracked elements and empty paths", () => {
    const plain = document.createElement("button");
    document.body.appendChild(plain);

    rememberFocus("/library", plain);
    expect(recallFocus("/library")).toBeNull();
    rememberFocus(null, plain);
    expect(recallFocus(null)).toBeNull();
  });
});

describe("parseFocusGameKey", () => {
  it("parses bare and rail-scoped game keys", () => {
    expect(parseFocusGameKey("game:doom")).toEqual({
      gameId: "doom",
      railId: null,
    });
    expect(parseFocusGameKey("game:doom@trending")).toEqual({
      gameId: "doom",
      railId: "trending",
    });
  });

  it("rejects non-game keys", () => {
    expect(parseFocusGameKey("settings:theme")).toBeNull();
    expect(parseFocusGameKey(null)).toBeNull();
    expect(parseFocusGameKey(undefined)).toBeNull();
  });
});

describe("focusSelectorForKey", () => {
  it("matches cards by game id", () => {
    const card = document.createElement("div");
    card.setAttribute("data-game-id", "halflife-2");
    document.body.appendChild(card);

    expect(document.querySelector(focusSelectorForKey("game:halflife-2"))).toBe(card);
  });

  it("matches explicit focus keys", () => {
    const el = document.createElement("button");
    el.setAttribute("data-focus-key", "settings:theme");
    document.body.appendChild(el);

    expect(document.querySelector(focusSelectorForKey("settings:theme"))).toBe(el);
  });
});
