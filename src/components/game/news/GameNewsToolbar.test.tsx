import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../../context/LanguageContext";
import GameNewsToolbar from "./GameNewsToolbar";

afterEach(() => {
  cleanup();
});

function renderToolbar(overrides: Partial<React.ComponentProps<typeof GameNewsToolbar>> = {}) {
  const props: React.ComponentProps<typeof GameNewsToolbar> = {
    view: "feed",
    onViewChange: vi.fn(),
    density: "grid",
    onDensityChange: vi.fn(),
    activeCategory: "all",
    onSelectCategory: vi.fn(),
    counts: { all: 12, unread: 2, patch_notes: 5, official: 3, press: 2, saved: 0 },
    searchQuery: "",
    onSearchChange: vi.fn(),
    sortOption: "newest",
    onSortChange: vi.fn(),
    onMarkAllRead: vi.fn(),
    onOpenCustomFeeds: vi.fn(),
    onRefresh: vi.fn(),
    onOpenNewsHub: vi.fn(),
    ...overrides,
  };

  render(
    <LanguageProvider>
      <GameNewsToolbar {...props} />
    </LanguageProvider>,
  );

  return props;
}

describe("GameNewsToolbar category strip", () => {
  it("marks the active category and reports a new selection", () => {
    const props = renderToolbar();

    const all = screen.getByRole("button", { name: /All News/ });
    const patchNotes = screen.getByRole("button", { name: /Patch Notes/ });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(patchNotes).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(patchNotes);
    expect(props.onSelectCategory).toHaveBeenCalledWith("patch_notes");
  });

  it("prints counts only for categories that have articles", () => {
    renderToolbar();

    expect(screen.getByRole("button", { name: /All News/ })).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: /Saved/ })).not.toHaveTextContent("0");
  });
});
