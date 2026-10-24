import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryFilterPopover from "./LibraryFilterPopover";
import { EMPTY_LIBRARY_FILTERS, type LibraryFilters } from "../../hooks/libraryFilters";
import type { LibraryFacetCounts } from "../../hooks/useLibraryFacetCounts";
import type { LibrarySource, PlayStatus } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "storage.gamesCount") return `${vars?.count} games`;
      if (key === "library.drawer.showGames") return `Show ${vars?.count} games`;
      const dict: Record<string, string> = {
        "store.filtersTitle": "Filters",
        "store.closeFilters": "Close filters",
        "edit.label.playStatus": "Play Status",
        "edit.label.genres": "Genres",
        "library.filter.status": "Status",
        "library.filter.source": "Source",
        "library.filter.releaseYear": "Release Year",
        "library.filter.minRating": "Minimum Rating",
        "library.filter.vrOnly": "VR games only",
        "library.filter.yearFrom": "From",
        "library.filter.yearTo": "To",
        "library.chips.saveAsShelf": "Save as shelf",
        "wishlist.clearAll": "Clear all",
        "common.all": "All",
        "common.clear": "Clear",
        "common.noResults": "No results",
        "common.local": "Local",
        "filter.installed": "Installed",
        "filter.notInstalled": "Not installed",
        "game.status.playing": "Playing",
        "game.status.backlog": "Backlog",
        "game.status.completed": "Completed",
        "game.status.onHold": "On Hold",
        "game.status.abandoned": "Abandoned",
      };
      return dict[key] ?? key;
    },
  }),
}));

const counts: LibraryFacetCounts = {
  total: 312,
  installed: 210,
  notInstalled: 102,
  playStatus: { backlog: 180, playing: 12, completed: 41, on_hold: 9, abandoned: 14 },
  sources: { Steam: 184, GOG: 52, Epic: 38 },
  genres: { Action: 120, RPG: 88 },
  years: { "2020": 30 },
};

function Harness(props: {
  open?: boolean;
  filters?: LibraryFilters;
  onClose?: () => void;
  onPlayStatusChange?: (playStatus: PlayStatus | "all") => void;
  onSourceChange?: (source: LibrarySource) => void;
  onPlatformsChange?: (platforms: string[]) => void;
  onReset?: () => void;
  onSaveAsShelf?: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={anchorRef} type="button">
        Filters
      </button>
      <LibraryFilterPopover
        open={props.open ?? true}
        onClose={props.onClose ?? vi.fn()}
        anchorRef={anchorRef}
        filters={props.filters ?? EMPTY_LIBRARY_FILTERS}
        availableGenres={["Action", "RPG"]}
        counts={counts}
        resultCount={128}
        onGenresChange={vi.fn()}
        onPlatformsChange={props.onPlatformsChange ?? vi.fn()}
        onYearRangeChange={vi.fn()}
        onRatingMinChange={vi.fn()}
        onStatusChange={vi.fn()}
        onPlayStatusChange={props.onPlayStatusChange ?? vi.fn()}
        onSourceChange={props.onSourceChange ?? vi.fn()}
        onVrOnlyChange={vi.fn()}
        onReset={props.onReset ?? vi.fn()}
        onSaveAsShelf={props.onSaveAsShelf ?? vi.fn()}
      />
    </>
  );
}

afterEach(cleanup);

describe("LibraryFilterPopover", () => {
  it("anchors under the Filters button and shows library-wide counts", () => {
    render(<Harness />);

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain("library-popover");
    expect(screen.getByText("128 games")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Playing\s*12/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Installed\s*210/ })).toBeInTheDocument();
  });

  it("applies a play-status facet and closes from the footer", () => {
    const onPlayStatusChange = vi.fn();
    const onClose = vi.fn();
    render(<Harness onPlayStatusChange={onPlayStatusChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Backlog\s*180/ }));
    expect(onPlayStatusChange).toHaveBeenCalledWith("backlog");

    fireEvent.click(screen.getByRole("button", { name: "Show 128 games" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("folds a legacy single source into the multi-store facet", () => {
    const onSourceChange = vi.fn();
    const onPlatformsChange = vi.fn();
    render(
      <Harness
        filters={{ ...EMPTY_LIBRARY_FILTERS, source: "steam" }}
        onSourceChange={onSourceChange}
        onPlatformsChange={onPlatformsChange}
      />
    );

    const steam = screen.getByRole("button", { name: /^Steam/ });
    expect(steam).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /^GOG/ }));

    expect(onSourceChange).toHaveBeenCalledWith("all");
    expect(onPlatformsChange).toHaveBeenCalledWith(["Steam", "GOG"]);
  });

  it("clears facets, offers a shelf, and closes on an outside click", () => {
    const onReset = vi.fn();
    const onSaveAsShelf = vi.fn();
    const onClose = vi.fn();
    render(<Harness onReset={onReset} onSaveAsShelf={onSaveAsShelf} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onReset).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save as shelf" }));
    expect(onSaveAsShelf).toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays closed and renders nothing", () => {
    const { container } = render(<Harness open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.querySelector(".library-popover")).toBeNull();
  });
});
