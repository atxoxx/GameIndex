import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreHeader from "./StoreHeader";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("./StoreSurpriseModal", () => ({
  default: () => <div data-testid="surprise-modal" />,
}));

afterEach(cleanup);

function makeCatalogue(overrides: Partial<StoreCatalogue> = {}): StoreCatalogue {
  return {
    resultsTitle: "All games",
    displayedGames: [{ id: 1 }],
    compareGames: [],
    hiddenCount: 0,
    showHidden: false,
    bulkMode: false,
    compareOpen: false,
    onCardClick: () => {},
    setBulkMode: vi.fn(),
    clearSelection: vi.fn(),
    setCompareOpen: vi.fn(),
    setShowHidden: vi.fn(),
    ...overrides,
  } as unknown as StoreCatalogue;
}

describe("StoreHeader", () => {
  it("toggles bulk selection and opens the surprise drawer", () => {
    const setBulkMode = vi.fn();
    const clearSelection = vi.fn();
    const catalogue = makeCatalogue({ setBulkMode, clearSelection });

    const { getByText, queryByTestId } = render(
      <StoreHeader catalogue={catalogue} onPickGame={() => {}} />
    );

    fireEvent.click(getByText("store.header.bulk"));
    expect(setBulkMode).toHaveBeenCalledWith(true);
    expect(clearSelection).toHaveBeenCalled();

    expect(queryByTestId("surprise-modal")).toBeNull();
    fireEvent.click(getByText("store.header.surprise"));
    expect(queryByTestId("surprise-modal")).not.toBeNull();
  });

  it("disables compare with an empty tray and enables it with picks", () => {
    const empty = render(
      <StoreHeader catalogue={makeCatalogue()} onPickGame={() => {}} />
    );
    const emptyButton = empty.getByText("store.header.compare").closest("button");
    expect(emptyButton).toBeDisabled();
    empty.unmount();

    const setCompareOpen = vi.fn();
    const withPicks = render(
      <StoreHeader
        catalogue={makeCatalogue({
          compareGames: [{ id: 1 }, { id: 2 }] as StoreCatalogue["compareGames"],
          setCompareOpen,
        })}
        onPickGame={() => {}}
      />
    );
    const compareButton = withPicks.getByText("store.header.compareCount").closest("button");
    expect(compareButton).not.toBeDisabled();
    fireEvent.click(compareButton!);
    expect(setCompareOpen).toHaveBeenCalledWith(true);
  });
});
