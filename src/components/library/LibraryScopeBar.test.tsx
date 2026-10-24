import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryScopeBar from "./LibraryScopeBar";
import type { LibraryScope } from "./LibraryScopeBar";
import type { Shelf } from "../../types/shelf";
import type { PlayStatus } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "common.all": "All",
        "game.status.playing": "Playing",
        "game.status.backlog": "Backlog",
        "game.status.completed": "Completed",
        "filter.installed": "Installed",
        "shelves.title": "Shelves",
        "shelves.create": "New shelf",
        "nav.library": "Library",
        "shelves.starter.backlog": "Backlog shelf",
      };
      if (key in dict) return dict[key];
      return vars ? `${key}` : key;
    },
  }),
}));

const shelf = (overrides: Partial<Shelf> = {}): Shelf => ({
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
  ...overrides,
});

const playStatusCounts: Record<PlayStatus, number> = {
  backlog: 180,
  playing: 12,
  completed: 41,
  on_hold: 9,
  abandoned: 14,
};

function renderBar({
  shelves = [shelf()],
  activeShelf = null,
  status = "all" as const,
  playStatus = "all" as const,
  onSelectScope = vi.fn(),
  onSelectShelf = vi.fn(),
  onCreateShelf = vi.fn(),
}: {
  shelves?: Shelf[];
  activeShelf?: Shelf | null;
  status?: "all" | "installed" | "not_installed";
  playStatus?: PlayStatus | "all";
  onSelectScope?: (scope: LibraryScope) => void;
  onSelectShelf?: (id: string) => void;
  onCreateShelf?: () => void;
} = {}) {
  render(
    <LibraryScopeBar
      total={312}
      installed={210}
      playStatusCounts={playStatusCounts}
      status={status}
      playStatus={playStatus}
      shelves={shelves}
      activeShelf={activeShelf}
      shelfCount={() => 42}
      onSelectScope={onSelectScope}
      onSelectShelf={onSelectShelf}
      onCreateShelf={onCreateShelf}
    />
  );
  return { onSelectScope, onSelectShelf, onCreateShelf };
}

afterEach(cleanup);

describe("LibraryScopeBar", () => {
  it("renders live counts and switches scope", () => {
    const { onSelectScope } = renderBar();

    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("312")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Playing/ }));

    expect(onSelectScope).toHaveBeenCalledWith("playing");
  });

  it("marks the active play-status scope", () => {
    renderBar({ playStatus: "backlog" });

    expect(screen.getByRole("tab", { name: /Backlog/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "false");
  });

  it("opens the shelf menu and applies a shelf", () => {
    const { onSelectShelf } = renderBar();

    fireEvent.click(screen.getByRole("button", { name: /Shelves/ }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Backlog shelf/ }));

    expect(onSelectShelf).toHaveBeenCalledWith("shelf-1");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the shelf menu on Escape", () => {
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: /Shelves/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders no shelf control when the user has no shelves", () => {
    renderBar({ shelves: [] });

    expect(screen.queryByRole("button", { name: /Shelves/ })).not.toBeInTheDocument();
    // The scope tabs still work on their own.
    expect(screen.getByRole("tab", { name: /^All/ })).toBeInTheDocument();
  });
});
