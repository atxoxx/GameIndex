import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import AboutSection from "./AboutSection";
import type { AboutBundle, Game } from "../../types/game";

const { registerAction, registered } = vi.hoisted(() => {
  const registered: { element: HTMLElement; onActivate: () => void }[] = [];
  return {
    registered,
    registerAction: (element: HTMLElement, onActivate: () => void) => {
      registered.push({ element, onActivate });
      return () => {
        const i = registered.findIndex((e) => e.element === element);
        if (i >= 0) registered.splice(i, 1);
      };
    },
  };
});

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: true }),
}));

const BUNDLE: AboutBundle = {
  defaultLanguage: "english",
  byLanguage: {
    english: {
      source: "steam",
      sourceName: "Steam",
      sourceUrl: "https://store.steampowered.com/app/620",
      aboutHtml: "<p>About the game</p>",
      movies: [],
      fetchedAt: 1,
    },
    german: {
      source: "steam",
      sourceName: "Steam",
      sourceUrl: "https://store.steampowered.com/app/620",
      aboutHtml: "<p>Uber das Spiel</p>",
      movies: [],
      fetchedAt: 1,
    },
  },
};

const game = {
  id: "game-1",
  name: "Portal 2",
  platform: "Steam",
  path: "",
  installed: true,
  playTime: "5h",
  addedAt: 1,
  steamAppId: 620,
} as Game;

function entryFor(el: Element | null) {
  return registered.find((e) => e.element === el);
}

describe("AboutSection controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(BUNDLE);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("exposes the language flags as a wrapping rail and activates one", async () => {
    const { container } = render(<AboutSection game={game} />);

    await waitFor(() =>
      expect(container.querySelector(".about-lang-btn")).not.toBeNull(),
    );

    const rail = container.querySelector('[data-rail-id="about-language-flags"]');
    expect(rail).not.toBeNull();

    const flags = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".about-lang-btn"),
    );
    expect(flags).toHaveLength(2);
    for (const flag of flags) {
      expect(flag.tabIndex).toBe(0);
      expect(rail!.contains(flag)).toBe(true);
      expect(entryFor(flag)).toBeTruthy();
    }

    const german = flags.find((f) => f.getAttribute("aria-pressed") === "false");
    expect(german).toBeTruthy();
    act(() => {
      entryFor(german!)!.onActivate();
    });
    expect(german!.getAttribute("aria-pressed")).toBe("true");
  });

  it("registers the 'View on source' link and forwards A to a real click", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { container } = render(<AboutSection game={game} />);

    const link = await waitFor(() => {
      const el = container.querySelector<HTMLAnchorElement>(
        ".metadata-source-link",
      );
      expect(el).not.toBeNull();
      return el!;
    });

    expect(link.tabIndex).toBe(0);
    const entry = entryFor(link);
    expect(entry).toBeTruthy();

    entry!.onActivate();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("about.viewOn")).toBeTruthy();
  });
});
