import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NewsTab } from "../../types/news";
import { emptyFilterState } from "../../utils/news/filters";
import NewsToolbar, { type NewsToolbarProps } from "./NewsToolbar";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const counts: Record<NewsTab, number> = {
  overview: 9,
  feed: 24,
  saved: 3,
  history: 1,
};

function renderToolbar(overrides: Partial<NewsToolbarProps> = {}) {
  const onTabChange = vi.fn();
  const onFiltersChange = vi.fn();
  const onResetFilters = vi.fn();
  const onDensityChange = vi.fn();

  const props: NewsToolbarProps = {
    tab: "feed",
    onTabChange,
    counts,
    filters: emptyFilterState(),
    onFiltersChange,
    onResetFilters,
    topics: [
      { id: "pc", count: 8 },
      { id: "deals", count: 4 },
    ],
    followedTopics: new Set(["deals"]),
    mutedTopics: new Set(),
    onToggleFollowTopic: vi.fn(),
    onToggleMuteTopic: vi.fn(),
    sourceNames: ["PC Gamer", "IGN"],
    density: "cozy",
    onDensityChange,
    ...overrides,
  };

  render(<NewsToolbar {...props} />);
  return { onTabChange, onFiltersChange, onResetFilters, onDensityChange };
}

describe("NewsToolbar", () => {
  afterEach(() => cleanup());

  it("switches destination, searches and changes density", () => {
    const { onTabChange, onFiltersChange, onDensityChange } = renderToolbar();

    fireEvent.click(screen.getByRole("tab", { name: /news.tabSaved/ }));
    expect(onTabChange).toHaveBeenCalledWith("saved");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "silksong" } });
    expect(onFiltersChange).toHaveBeenCalledWith({ query: "silksong" });

    fireEvent.click(screen.getByRole("radio", { name: "news.densityCompact" }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("filters by topic and reports the active filter count", () => {
    const { onFiltersChange } = renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: /news.tabPc/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ topics: ["pc"] });

    cleanup();
    renderToolbar({ filters: emptyFilterState({ unreadOnly: true, topics: ["deals"] }) });
    expect(screen.getByRole("button", { name: /news.filtersTitle/ })).toHaveTextContent("2");
  });

  it("opens the filter panel and exposes source and sort controls", () => {
    const { onFiltersChange } = renderToolbar();

    expect(screen.queryByLabelText("news.sourceLabel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /news.filtersTitle/ }));

    fireEvent.change(screen.getByLabelText("news.sourceLabel"), {
      target: { value: "IGN" },
    });
    expect(onFiltersChange).toHaveBeenCalledWith({ source: "IGN" });

    fireEvent.click(screen.getByRole("button", { name: "news.sortNewest" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ sort: "newest" });
  });

  it("hides topic chips outside the feed and density on the briefing", () => {
    renderToolbar({ tab: "overview" });

    expect(screen.queryByRole("button", { name: /news.tabPc/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "news.densityCozy" })).not.toBeInTheDocument();
  });
});
