import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreFilterPanel from "./StoreFilterPanel";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("./StoreFilterSidebar", () => ({
  default: () => <div data-testid="filter-sidebar" />,
}));

afterEach(cleanup);

function makeCatalogue(overrides: Partial<StoreCatalogue> = {}): StoreCatalogue {
  return {
    filtersOpen: true,
    setFiltersOpen: vi.fn(),
    selectedGenres: [],
    setSelectedGenres: vi.fn(),
    selectedPlatforms: [],
    setSelectedPlatforms: vi.fn(),
    platformNames: [],
    yearMin: null,
    yearMax: null,
    setYearRange: vi.fn(),
    ratingMin: null,
    setRatingMin: vi.fn(),
    selectedSourceIds: [],
    setSelectedSourceIds: vi.fn(),
    sourceCounts: {},
    sourceMatchMode: "any",
    setSourceMatchMode: vi.fn(),
    displayedGames: [{ id: 1 }] as StoreGameSummary[],
    resetFilters: vi.fn(),
    ...overrides,
  } as unknown as StoreCatalogue;
}

function makeAnchor() {
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () =>
    ({ right: 600, bottom: 180, top: 140, left: 500, width: 100, height: 40 }) as DOMRect;
  return { current: anchor };
}

function renderPanel(overrides: Partial<StoreCatalogue> = {}) {
  const catalogue = makeCatalogue(overrides);
  const anchorRef = makeAnchor();
  const utils = render(<StoreFilterPanel catalogue={catalogue} anchorRef={anchorRef} />);
  return { ...utils, catalogue, anchorRef };
}

describe("StoreFilterPanel popover", () => {
  it("renders a floating panel anchored to the filter button", () => {
    const { getByTestId } = renderPanel();

    const panel = document.body.querySelector(".store-filter-popover") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(getByTestId("filter-sidebar")).toBeInTheDocument();
    // Sits under the anchor (bottom 180 + 8px gap).
    expect(panel.style.top).toBe("188px");
    expect(panel.style.left).toBe("180px");
  });

  it("closes on Escape and on an outside pointer press", () => {
    const { catalogue } = renderPanel();
    const setOpen = catalogue.setFiltersOpen as ReturnType<typeof vi.fn>;

    fireEvent.keyDown(document, { key: "Escape" });
    expect(setOpen).toHaveBeenCalledWith(false);

    setOpen.mockClear();
    fireEvent.pointerDown(document.body);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("stays open when the pointer press lands inside the panel", () => {
    const { catalogue, getByTestId } = renderPanel();
    const setOpen = catalogue.setFiltersOpen as ReturnType<typeof vi.fn>;

    fireEvent.pointerDown(getByTestId("filter-sidebar"));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("wires clear-all and show-results in the footer", () => {
    const { catalogue, getByText } = renderPanel();
    const setOpen = catalogue.setFiltersOpen as ReturnType<typeof vi.fn>;
    const resetFilters = catalogue.resetFilters as ReturnType<typeof vi.fn>;

    fireEvent.click(getByText("store.chips.clearAll"));
    expect(resetFilters).toHaveBeenCalledTimes(1);

    fireEvent.click(getByText("store.drawer.showResults"));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("renders nothing while closed", () => {
    renderPanel({ filtersOpen: false });
    expect(document.body.querySelector(".store-filter-popover")).toBeNull();
  });
});
