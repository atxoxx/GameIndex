import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StoreBulkBar from "./StoreBulkBar";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

function renderBar() {
  const props = {
    selectedCount: 2,
    totalCount: 5,
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    onWishlistAll: vi.fn(),
    onHideAll: vi.fn(),
    onAddAll: vi.fn(),
    onExit: vi.fn(),
  };
  const utils = render(<StoreBulkBar {...props} />);
  return { ...props, ...utils };
}

describe("StoreBulkBar", () => {
  afterEach(cleanup);

  it("renders through a portal and wires the bulk actions", () => {
    const { container, onWishlistAll, onExit } = renderBar();

    expect(container.querySelector(".store-bulk-bar")).toBeNull();
    expect(document.body.querySelector(".store-bulk-bar")).not.toBeNull();

    fireEvent.click(screen.getByText("store.bulk.wishlist"));
    expect(onWishlistAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("storeBulk.exitBulk"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("disables selection actions with an empty selection", () => {
    render(
      <StoreBulkBar
        selectedCount={0}
        totalCount={5}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        onWishlistAll={vi.fn()}
        onHideAll={vi.fn()}
        onAddAll={vi.fn()}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByText("store.bulk.wishlist")).toBeDisabled();
    expect(screen.getByText("store.bulk.hide")).toBeDisabled();
  });
});
