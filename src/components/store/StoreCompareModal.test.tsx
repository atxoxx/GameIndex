import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import StoreCompareModal from "./StoreCompareModal";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

function game(slug: string, extra: Partial<StoreGameSummary> = {}): StoreGameSummary {
  return {
    id: Math.random(),
    name: slug.toUpperCase(),
    slug,
    summary: `${slug} summary`,
    rating: 80,
    aggregatedRating: 70,
    coverUrl: null,
    logoUrl: null,
    genres: ["Action"],
    platforms: ["PC"],
    firstReleaseDate: "2020-01-02",
    totalRatingCount: 100,
    hypes: 10,
    ...extra,
  };
}

const noop = () => {};

function renderModal(overrides: Partial<ComponentProps<typeof StoreCompareModal>> = {}) {
  const props = {
    games: [game("a")],
    availableGames: [] as StoreGameSummary[],
    onClose: noop,
    onOpenGame: noop,
    onRemove: noop,
    onAdd: noop,
    onClear: noop,
    ...overrides,
  };
  render(<StoreCompareModal {...props} />);
  return props;
}

describe("StoreCompareModal", () => {
  afterEach(cleanup);

  it("renders a column per game and marks the best numeric row (happy path)", () => {
    renderModal({
      games: [game("a", { rating: 92 }), game("b", { rating: 96 }), game("c", { rating: 88 })],
    });

    const best = document.querySelectorAll(".store-compare-cell.is-best");
    expect(best.length).toBe(1);
    expect(best[0].textContent).toContain("96");
    expect(document.querySelectorAll(".store-compare-col-head").length).toBe(3);
  });

  it("removes a game and clears from the footer actions", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const onClose = vi.fn();
    renderModal({
      games: [game("a"), game("b")],
      onRemove,
      onClear,
      onClose,
    });

    fireEvent.click(screen.getByLabelText("store.compare.removeFromCompare:{\"name\":\"A\"}"));
    expect(onRemove).toHaveBeenCalledWith("a");

    fireEvent.click(screen.getByText("store.compare.clearAll"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds a game through the picker (search + suggestion click)", () => {
    const onAdd = vi.fn();
    renderModal({
      games: [game("a")],
      availableGames: [game("b", { name: "Celeste" }), game("c", { name: "Hades" })],
      onAdd,
    });

    fireEvent.click(screen.getAllByText("store.compare.addGame")[0]);
    const input = screen.getByPlaceholderText("store.compare.searchGames");
    fireEvent.change(input, { target: { value: "cel" } });
    fireEvent.click(screen.getByText("Celeste"));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ slug: "b" }));
  });

  it("closes on Escape and shows a hint with a single game (error path)", () => {
    const onClose = vi.fn();
    renderModal({ games: [game("a")], onClose });

    expect(screen.getByText("store.compare.emptyHint")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
