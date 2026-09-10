import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StoreCompareTray from "./StoreCompareTray";
import type { StoreGameSummary } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

function game(slug: string): StoreGameSummary {
  return { slug, name: slug.toUpperCase(), coverUrl: null } as unknown as StoreGameSummary;
}

function renderTray(games: StoreGameSummary[]) {
  const props = {
    games,
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onOpen: vi.fn(),
  };
  const utils = render(<StoreCompareTray {...props} />);
  return { ...props, ...utils };
}

describe("StoreCompareTray", () => {
  afterEach(cleanup);

  it("renders through a portal so animated page wrappers cannot trap it", () => {
    const { container } = renderTray([game("a"), game("b")]);

    expect(container.querySelector(".store-compare-tray")).toBeNull();
    expect(document.body.querySelector(".store-compare-tray")).not.toBeNull();
  });

  it("shows pinned chips and enables Compare at two games (happy path)", () => {
    const { onOpen } = renderTray([game("a"), game("b")]);

    expect(screen.getByText(game("a").name)).toBeInTheDocument();
    const open = screen.getByText("store.compare.open");
    expect(open).toBeEnabled();
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("disables Compare with a single pinned game and explains why (error path)", () => {
    renderTray([game("a")]);

    const open = screen.getByText("store.compare.open");
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute("title", "store.compare.trayHint");
  });

  it("removes a chip and clears the tray", () => {
    const { onRemove, onClear } = renderTray([game("a"), game("b")]);

    fireEvent.click(screen.getByLabelText('store.compare.removeFromCompare:{"name":"A"}'));
    expect(onRemove).toHaveBeenCalledWith("a");

    fireEvent.click(screen.getByText("store.compare.clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
