import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StoreActionBar from "./StoreActionBar";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useSteamGameStats", () => ({
  useSteamGameStats: (appId: number | undefined) => ({
    data: appId
      ? {
          appId,
          details: {
            name: "Portal 2",
            developer: "Valve",
            publisher: "Valve",
            releaseDate: "Apr 19, 2011",
            isFree: false,
            priceCents: 999,
            currency: "USD",
            genres: ["Puzzle"],
          },
          reviews: null,
          detailsError: null,
          reviewsError: null,
        }
      : null,
    isLoading: false,
    error: null,
  }),
  formatSteamPrice: (cents: number | null, _currency: string | null, isFree: boolean) =>
    isFree ? "Free" : cents == null ? "—" : `$${(cents / 100).toFixed(2)}`,
}));

vi.mock("../DownloadButton", () => ({
  default: ({ label }: { label?: string }) => (
    <button type="button">download:{label}</button>
  ),
}));

function props(overrides: Partial<Parameters<typeof StoreActionBar>[0]> = {}) {
  return {
    visible: true,
    title: "Portal 2",
    coverUrl: "https://example.test/cover.jpg",
    steamAppId: 620,
    isInLibrary: false,
    wishlisted: false,
    onToggleWishlist: vi.fn(),
    onAdd: vi.fn(),
    adding: false,
    onOpenLibrary: vi.fn(),
    ...overrides,
  };
}

describe("StoreActionBar", () => {
  it("stays out of the way while the hero is on screen", () => {
    const { container } = render(<StoreActionBar {...props({ visible: false })} />);
    expect(container.querySelector(".store-action-bar")).toBeNull();
    expect(screen.queryByText("Portal 2")).toBeNull();
  });

  it("offers wishlist, add and download with the Steam price", () => {
    const onAdd = vi.fn();
    const onToggleWishlist = vi.fn();
    render(<StoreActionBar {...props({ onAdd, onToggleWishlist })} />);

    expect(screen.getByText("Portal 2")).toBeTruthy();
    expect(screen.getByText("$9.99")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /addWishlistAria/ }));
    expect(onToggleWishlist).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /store\.addToLibrary/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: /download:/ })).toBeTruthy();
  });

  it("swaps to a library link and hides the price for owned games", () => {
    const onOpenLibrary = vi.fn();
    render(
      <StoreActionBar
        {...props({
          isInLibrary: true,
          libraryGameId: "game-1",
          onOpenLibrary,
        })}
      />,
    );

    expect(screen.queryByText("$9.99")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /store\.viewInLibrary/ }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});
