import { describe, it, expect } from "vitest";
import { tokenizeSearchQuery, classifyStoreSuggestion } from "./storeSearchQuery";
import StoreHighlightText from "./StoreHighlightText";
import { render } from "@testing-library/react";
import type { StoreGameSummary } from "../../types/game";

function game(overrides: Partial<StoreGameSummary>): StoreGameSummary {
  return { slug: "x", name: "Game", ...overrides } as unknown as StoreGameSummary;
}

describe("tokenizeSearchQuery", () => {
  it("folds case, diacritics, punctuation and ligatures", () => {
    expect(tokenizeSearchQuery("Pokémon & Co")).toEqual(["pokemon", "and", "co"]);
    expect(tokenizeSearchQuery("Assassin's Creed")).toEqual(["assassins", "creed"]);
    expect(tokenizeSearchQuery("   ")).toEqual([]);
  });
});

describe("classifyStoreSuggestion", () => {
  it("classifies title matches across character variations", () => {
    const g = game({ name: "Pokémon Violet", genres: [], platforms: [] });
    expect(classifyStoreSuggestion(g, tokenizeSearchQuery("pokemon"), "pokemon")).toBe("title");
  });

  it("classifies genre and platform matches", () => {
    const g = game({ name: "Some Game", genres: ["Role-Playing"], platforms: ["Nintendo Switch"] });
    expect(classifyStoreSuggestion(g, tokenizeSearchQuery("role playing"), "role playing")).toBe("genre");
    expect(classifyStoreSuggestion(g, tokenizeSearchQuery("switch"), "switch")).toBe("platform");
  });

  it("falls back to title when nothing else matches", () => {
    const g = game({ name: "Some Game", genres: ["RPG"], platforms: ["PC"] });
    expect(classifyStoreSuggestion(g, tokenizeSearchQuery("zzz"), "zzz")).toBe("title");
  });
});

describe("StoreHighlightText", () => {
  it("highlights across diacritics without altering the original casing", () => {
    const { container } = render(<StoreHighlightText text="Pokémon Violet" query="pokemon" />);
    const mark = container.querySelector("mark.store-highlight");
    expect(mark?.textContent).toBe("Pokémon");
    expect(container.textContent).toBe("Pokémon Violet");
  });

  it("renders plain text when there is no match", () => {
    const { container } = render(<StoreHighlightText text="Hades" query="zzz" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Hades");
  });
});
