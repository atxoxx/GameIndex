import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryFilterChips from "./LibraryFilterChips";
import { EMPTY_LIBRARY_FILTERS, type LibraryFilters } from "../../hooks/libraryFilters";
import type { Shelf } from "../../types/shelf";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "library.filtersAria": "Library filters",
        "storage.gamesCount": "games",
        "library.chips.shelf": "Shelf: {name}",
        "library.chips.saveAsShelf": "Save as shelf",
        "library.removeFilter": "Remove filter",
        "page.library.clearFilters": "Clear all filters",
        "library.filter.vrOnly": "VR games only",
        "filter.installed": "Installed",
        "common.local": "Local",
        "game.status.playing": "Playing",
        "shelves.starter.backlog": "Backlog shelf",
      };
      if (key === "storage.gamesCount") return `${vars?.count} games`;
      if (key === "library.chips.shelf") return `Shelf: ${vars?.name}`;
      return dict[key] ?? key;
    },
  }),
}));

const shelf: Shelf = {
  id: "shelf-1",
  name: "shelves.starter.backlog",
  icon: "bookmark",
  color: "accent",
  rules: {},
  sort: "alphabetical",
  pinned: false,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
};

function renderChips({
  filters = EMPTY_LIBRARY_FILTERS,
  activeShelf = null,
  onRemoveGenre = vi.fn(),
  onClearShelf = vi.fn(),
  onSaveAsShelf = vi.fn(),
  onResetAll = vi.fn(),
  onRemoveSearch = vi.fn(),
}: {
  filters?: LibraryFilters;
  activeShelf?: Shelf | null;
  onRemoveGenre?: (genre: string) => void;
  onClearShelf?: () => void;
  onSaveAsShelf?: () => void;
  onResetAll?: () => void;
  onRemoveSearch?: () => void;
} = {}) {
  const view = render(
    <LibraryFilterChips
      filters={filters}
      resultCount={4}
      activeShelf={activeShelf}
      onRemoveSearch={onRemoveSearch}
      onRemoveGenre={onRemoveGenre}
      onRemovePlatform={vi.fn()}
      onRemoveYear={vi.fn()}
      onRemoveRating={vi.fn()}
      onRemoveStatus={vi.fn()}
      onRemovePlayStatus={vi.fn()}
      onRemoveSource={vi.fn()}
      onRemoveVrOnly={vi.fn()}
      onClearShelf={onClearShelf}
      onSaveAsShelf={onSaveAsShelf}
      onResetAll={onResetAll}
    />
  );

  return { ...view, onRemoveGenre, onClearShelf, onSaveAsShelf, onResetAll, onRemoveSearch };
}

afterEach(cleanup);

describe("LibraryFilterChips", () => {
  it("summarises the active facets, the shelf and the result count", () => {
    renderChips({
      filters: {
        ...EMPTY_LIBRARY_FILTERS,
        search: "hades",
        genres: ["Action"],
        playStatus: "playing",
      },
      activeShelf: shelf,
    });

    expect(screen.getByText("4 games")).toBeInTheDocument();
    expect(screen.getByText("Shelf: Backlog shelf")).toBeInTheDocument();
    expect(screen.getByText("“hades”")).toBeInTheDocument();
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("Playing")).toBeInTheDocument();
  });

  it("removes a single facet without clearing the rest", () => {
    const { onRemoveGenre } = renderChips({
      filters: { ...EMPTY_LIBRARY_FILTERS, genres: ["Action", "RPG"] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Action" }));

    expect(onRemoveGenre).toHaveBeenCalledWith("Action");
    expect(screen.getByText("RPG")).toBeInTheDocument();
  });

  it("clears the applied shelf and exposes the save action", () => {
    const { onClearShelf, onSaveAsShelf } = renderChips({ activeShelf: shelf });

    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Shelf: Backlog shelf" }));
    expect(onClearShelf).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save as shelf" }));
    expect(onSaveAsShelf).toHaveBeenCalled();
  });

  it("stays out of the layout when nothing is filtering", () => {
    const { container } = renderChips();

    expect(container).toBeEmptyDOMElement();
  });
});
