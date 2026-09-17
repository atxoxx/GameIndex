import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ManualLinkModal from "./ManualLinkModal";

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

const { searchManualSteam, createManualLink, syncManualAchievements } = vi.hoisted(() => ({
  searchManualSteam: vi.fn(),
  createManualLink: vi.fn().mockResolvedValue(undefined),
  syncManualAchievements: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../../context/AchievementContext", () => ({
  useAchievements: () => ({
    searchManualSteam,
    createManualLink,
    syncManualAchievements,
  }),
}));

function entryFor(el: Element | null) {
  return registered.find((e) => e.element === el);
}

describe("ManualLinkModal controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
    searchManualSteam.mockReset();
    createManualLink.mockClear();
    syncManualAchievements.mockClear();
  });
  afterEach(cleanup);

  it("registers the close and cancel controls and activates cancel", () => {
    const onClose = vi.fn();
    render(<ManualLinkModal gameId="game-1" onClose={onClose} />);

    const close = screen.getByLabelText("common.close");
    expect((close as HTMLButtonElement).tabIndex).toBe(0);
    expect(entryFor(close)).toBeTruthy();

    const cancel = screen.getByRole("button", { name: "common.cancel" });
    expect((cancel as HTMLButtonElement).tabIndex).toBe(0);
    const entry = entryFor(cancel);
    expect(entry).toBeTruthy();

    act(() => {
      entry!.onActivate();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("registers each search-result link control for gamepad activation", async () => {
    searchManualSteam.mockResolvedValue([{ appid: 620, name: "Portal 2" }]);
    render(<ManualLinkModal gameId="game-1" onClose={vi.fn()} />);

    fireEvent.change(document.querySelector(".ach-modal-search-input")!, {
      target: { value: "portal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.search" }));

    const link = await waitFor(() => {
      const el = screen.getByRole("button", {
        name: "achievements.manualLink.link",
      });
      expect(el).toBeTruthy();
      return el;
    });

    expect((link as HTMLButtonElement).tabIndex).toBe(0);
    const entry = entryFor(link);
    expect(entry).toBeTruthy();

    act(() => {
      entry!.onActivate();
    });
    await waitFor(() =>
      expect(createManualLink).toHaveBeenCalledWith("game-1", 620, "Portal 2"),
    );
  });
});
