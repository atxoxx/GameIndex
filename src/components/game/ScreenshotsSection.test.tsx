import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Game } from "../../types/game";
import ScreenshotsSection from "./ScreenshotsSection";

let isBigScreen = true;

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));
vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const scrollBy = vi.fn();
beforeAll(() => {
  // jsdom has no layout and no element scrollBy.
  Element.prototype.scrollBy = scrollBy as unknown as Element["scrollBy"];
});

function makeGame(): Game {
  return {
    id: "game-1",
    name: "Portal 2",
    platform: "PC",
    path: "",
    installed: true,
    addedAt: 1,
    screenshots: ["shot-1.png", "shot-2.png"],
  } as Game;
}

describe("ScreenshotsSection arrow affordances", () => {
  it("keeps the arrows out of the tab order and the a11y tree", () => {
    isBigScreen = true;
    const { container } = render(
      <ScreenshotsSection game={makeGame()} onOpen={() => {}} />,
    );

    const arrows = container.querySelectorAll<HTMLButtonElement>(".carousel-arrow");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow.tabIndex).toBe(-1);
      expect(arrow).toHaveAttribute("aria-hidden", "true");
    }

    // Only the screenshots are announced, and the arrows still work with a
    // mouse (they are unregistered with the controller engine).
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(arrows[1]);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("makes each screenshot a button in Big Screen, and keeps that on desktop", () => {
    isBigScreen = true;
    render(<ScreenshotsSection game={makeGame()} onOpen={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);

    isBigScreen = false;
    const { container } = render(
      <ScreenshotsSection game={makeGame()} onOpen={() => {}} />,
    );
    // Desktop items already carried role="button"; the arrows changed there
    // too, which is intentional: the slides are the controls in both modes.
    expect(container.querySelectorAll(".screenshot-item[role='button']")).toHaveLength(2);
    for (const arrow of container.querySelectorAll<HTMLButtonElement>(".carousel-arrow")) {
      expect(arrow.tabIndex).toBe(-1);
    }
  });
});
