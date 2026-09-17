import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Game } from "../../types/game";
import VideosSection from "./VideosSection";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve({ byLanguage: {}, defaultLanguage: "en" }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));
vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: true }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));

const scrollBy = vi.fn();
beforeAll(() => {
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
    videos: [
      "https://www.youtube.com/watch?v=abc123",
      "https://example.com/clip.mp4",
    ],
  } as Game;
}

describe("VideosSection arrow affordances", () => {
  it("leaves the trailer buttons as the controls and demotes the arrows", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<VideosSection game={makeGame()} />));
    });

    const arrows = container.querySelectorAll<HTMLButtonElement>(".carousel-arrow");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow.tabIndex).toBe(-1);
      expect(arrow).toHaveAttribute("aria-hidden", "true");
    }

    // The two trailer selector buttons are announced; the arrows are not.
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(arrows[0]);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});
