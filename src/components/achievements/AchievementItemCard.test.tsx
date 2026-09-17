import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import AchievementItemCard from "./AchievementItemCard";
import type { Achievement } from "../../types/game";

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

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const hidden: Achievement = {
  apiName: "ACH_SECRET",
  displayName: "Secret",
  description: "A hidden achievement",
  icon: "icon.png",
  iconGray: "icon-gray.png",
  achieved: false,
  unlockTime: 0,
  percent: 10,
};

describe("AchievementItemCard controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
  });
  afterEach(cleanup);

  it("registers the reveal-secret button and activates it with the gamepad", () => {
    const { container } = render(<AchievementItemCard achievement={hidden} />);

    const button = container.querySelector<HTMLButtonElement>(
      ".achievement-card-reveal-btn",
    );
    expect(button).not.toBeNull();
    expect(button!.tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === button);
    expect(entry).toBeTruthy();

    act(() => {
      entry!.onActivate();
    });
    expect(screen.getByText("A hidden achievement")).toBeTruthy();
    expect(container.querySelector(".achievement-card-reveal-btn")).toBeNull();
  });
});
