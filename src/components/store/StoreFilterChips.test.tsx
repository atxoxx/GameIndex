import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import StoreFilterChips from "./StoreFilterChips";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => {
    const suffix = vars ? ` ${JSON.stringify(vars)}` : "";
    return `${key}${suffix}`;
  } }),
}));

afterEach(cleanup);

const noFilters = {
  genres: [] as string[],
  platforms: [] as string[],
  yearMin: null,
  yearMax: null,
  ratingMin: null,
};

describe("StoreFilterChips", () => {
  it("renders the empty state and opens the drawer from the add button", () => {
    const onOpenFilters = vi.fn();
    const { getByText } = render(
      <StoreFilterChips
        {...noFilters}
        onRemove={() => {}}
        onClearAll={() => {}}
        onOpenFilters={onOpenFilters}
      />
    );

    expect(getByText("store.chips.empty")).toBeInTheDocument();
    fireEvent.click(getByText("store.chips.add"));
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
  });

  it("renders one chip per active filter and removes the clicked one", () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    const { getByText, getAllByLabelText } = render(
      <StoreFilterChips
        genres={["Action", "Indie"]}
        platforms={["PC"]}
        yearMin={2010}
        yearMax={2019}
        ratingMin={80}
        onRemove={onRemove}
        onClearAll={onClearAll}
        onOpenFilters={() => {}}
      />
    );

    expect(getByText("Action")).toBeInTheDocument();
    expect(getByText("Indie")).toBeInTheDocument();
    expect(getByText("PC")).toBeInTheDocument();

    // Each chip carries an accessible remove label.
    expect(getAllByLabelText(/store\.chips\.remove/)).toHaveLength(5);

    fireEvent.click(getAllByLabelText(/store\.chips\.remove/)[0]);
    expect(onRemove).toHaveBeenCalledWith("genre", "Action");

    fireEvent.click(getByText("store.chips.clearAll"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
