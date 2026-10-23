import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WishlistPage from "./WishlistPage";

const mockState = vi.hoisted(() => {
  const now = Date.now();
  return {
    clear: vi.fn(),
    setNote: vi.fn(),
    toggle: vi.fn(),
    entries: [
      {
        slug: "elden-ring",
        name: "Elden Ring",
        addedAt: now - 1_000,
        firstReleaseDate: new Date(now + 86_400_000).toISOString(),
        note: "Wait for the autumn sale",
      },
      {
        slug: "hollow-knight",
        name: "Hollow Knight",
        addedAt: now - 2_000,
        firstReleaseDate: new Date(now - 86_400_000).toISOString(),
      },
      {
        slug: "silksong",
        name: "Silksong",
        addedAt: now - 3_000,
        note: "Day one",
      },
    ],
  };
});

vi.mock("../components/store/StoreGameCard", () => ({
  default: ({ game }: { game: { name: string } }) => (
    <div data-testid="store-card">{game.name}</div>
  ),
}));

vi.mock("../context/WishlistContext", () => ({
  useWishlistContext: () => ({
    wishlist: mockState.entries,
    hydrated: true,
    isWishlisted: () => true,
    toggle: mockState.toggle,
    remove: vi.fn(),
    setNote: mockState.setNote,
    clear: mockState.clear,
    count: mockState.entries.length,
  }),
}));

vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "wishlist.showing") {
        return `Showing ${vars?.visible} of ${vars?.total}`;
      }
      if (key === "wishlist.addedOn") return `Added ${vars?.date}`;
      if (key === "wishlist.clearBody") return `Removes ${vars?.count} games`;
      if (key === "wishlist.clearTitle") return "Clear your wishlist?";
      const dict: Record<string, string> = {
        "wishlist.eyebrow": "Your Wishlist",
        "wishlist.title": "Saved to play",
        "wishlist.description": "Saved for later",
        "wishlist.clearAll": "Clear all",
        "wishlist.statsAria": "Wishlist summary",
        "wishlist.stats.saved": "Saved",
        "wishlist.stats.outNow": "Out now",
        "wishlist.stats.comingSoon": "Coming soon",
        "wishlist.stats.withNotes": "With notes",
        "wishlist.all": "All",
        "wishlist.outNow": "Out now",
        "wishlist.comingSoon": "Coming soon",
        "wishlist.searchPlaceholder": "Search wishlist",
        "wishlist.filters": "Filters",
        "wishlist.sortAria": "Sort wishlist",
        "wishlist.sortDateAdded": "Date Added",
        "wishlist.sortNameAZ": "Name",
        "wishlist.sortHighestRated": "Rating",
        "wishlist.sortReleaseDate": "Release date",
        "wishlist.shareToFriends": "Share to Friends",
        "wishlist.addNote": "Add note",
        "common.cancel": "Cancel",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../context/SettingsContext", () => ({
  useWidgetVisible: () => true,
  usePageWidgetOrder: () => undefined,
}));

vi.mock("../hooks/useFocusable", () => ({
  useFocusable: (fn: () => void) => ({
    ref: () => {},
    tabIndex: 0,
    onClick: fn,
    onKeyDown: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/wishlist"]}>
      <WishlistPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockState.clear.mockClear();
  mockState.toggle.mockClear();
  mockState.setNote.mockClear();
});

afterEach(cleanup);

describe("WishlistPage", () => {
  it("summarises the saved games in one stat band and group strip", () => {
    renderPage();

    const band = screen.getByRole("group", { name: "Wishlist summary" });
    expect(within(band).getByText("Saved")).toBeInTheDocument();
    expect(within(band).getByText("With notes")).toBeInTheDocument();
    // Three saved, one released, two upcoming, two carrying notes.
    expect(within(band).getAllByText("2")).toHaveLength(2);

    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
    expect(screen.getAllByTestId("store-card")).toHaveLength(3);
    expect(screen.getByText("Elden Ring")).toBeInTheDocument();
  });

  it("filters the grid from the shared group strip", () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: /Out now/ }));

    expect(screen.getByText("Hollow Knight")).toBeInTheDocument();
    expect(screen.queryByText("Elden Ring")).toBeNull();
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
  });

  it("confirms before clearing the whole wishlist", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText("Clear your wishlist?")
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all" }));
    expect(mockState.clear).toHaveBeenCalledTimes(1);
  });
});
