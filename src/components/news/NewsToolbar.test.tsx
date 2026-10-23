import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ViewDensity } from "../../types/game";
import type { NewsCategory } from "../../hooks/useNewsFeeds";
import NewsToolbar, {
  type NewsReadTimeFilter,
  type NewsSortOption,
  type NewsTimeFilter,
} from "./NewsToolbar";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

const countsByCategory: Record<NewsCategory, number> = {
  all: 10,
  for_you: 2,
  pc: 5,
  console: 1,
  tech: 1,
  indie: 1,
  deals: 1,
  esports: 0,
  saved: 0,
  history: 0,
};

function renderToolbar(overrides: Partial<React.ComponentProps<typeof NewsToolbar>> = {}) {
  const onCategoryChange = vi.fn();
  const onSearchChange = vi.fn();
  const onDensityChange = vi.fn();
  const onToggleUnreadOnly = vi.fn();

  render(
    <NewsToolbar
      activeCategory="all"
      onCategoryChange={onCategoryChange}
      countsByCategory={countsByCategory}
      searchQuery=""
      onSearchChange={onSearchChange}
      timeFilter={"all" as NewsTimeFilter}
      onTimeFilterChange={vi.fn()}
      readTimeFilter={"all" as NewsReadTimeFilter}
      onReadTimeFilterChange={vi.fn()}
      sortBy={"newest" as NewsSortOption}
      onSortByChange={vi.fn()}
      hasImagesOnly={false}
      onToggleHasImagesOnly={vi.fn()}
      unreadOnly={false}
      onToggleUnreadOnly={onToggleUnreadOnly}
      unreadTotal={3}
      density={"cinematic" as ViewDensity}
      onDensityChange={onDensityChange}
      {...overrides}
    />,
  );

  return { onCategoryChange, onSearchChange, onDensityChange, onToggleUnreadOnly };
}

describe("NewsToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("routes category, search and density changes (happy path)", () => {
    const { onCategoryChange, onSearchChange, onDensityChange } = renderToolbar();

    fireEvent.click(screen.getByRole("tab", { name: /news.tabPc/ }));
    expect(onCategoryChange).toHaveBeenCalledWith("pc");

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "silksong" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("silksong");

    fireEvent.click(screen.getByRole("radio", { name: "Compact View" }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("opens the advanced filters and toggles unread only (alternate path)", () => {
    const { onToggleUnreadOnly } = renderToolbar();

    expect(screen.queryByLabelText("news.timeFilterLabel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /news.showFilters/ }));
    expect(screen.getByLabelText("news.timeFilterLabel")).toBeInTheDocument();
    expect(screen.getByLabelText("news.sortByLabel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /news.unreadOnly/ }));
    expect(onToggleUnreadOnly).toHaveBeenCalledTimes(1);
  });
});
