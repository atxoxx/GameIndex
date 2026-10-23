import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import StoreGameLoadingSkeleton from "./StoreGameLoadingSkeleton";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe("StoreGameLoadingSkeleton", () => {
  it("mirrors the immersive store-detail shell instead of a boxed card", () => {
    const { container } = render(<StoreGameLoadingSkeleton />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.classList.contains("game-page")).toBe(true);
    expect(root.classList.contains("game-page--immersive")).toBe(true);
    expect(container.querySelector(".store-skeleton-hero")).toBeTruthy();
    expect(container.querySelector(".store-skeleton-tabs")).toBeTruthy();
    expect(container.querySelector(".game-content-grid > .game-main-col")).toBeTruthy();
    expect(container.querySelector(".game-content-grid > .game-side-col")).toBeTruthy();
  });

  it("announces the loading state to assistive tech", () => {
    const { container } = render(<StoreGameLoadingSkeleton />);
    const root = container.querySelector("[aria-busy='true']");

    expect(root).toBeTruthy();
    expect(root?.getAttribute("aria-label")).toBe("store.loadingGameDetails");
  });
});
