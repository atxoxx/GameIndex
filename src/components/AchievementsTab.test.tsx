import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import AchievementsTab from "./AchievementsTab";
import type { Game } from "../types/game";

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

const {
  syncGameAchievements,
  getGameAchievements,
  fetchManualSchema,
  linksHolder,
} = vi.hoisted(() => ({
  syncGameAchievements: vi.fn().mockResolvedValue(undefined),
  getGameAchievements: vi.fn(),
  fetchManualSchema: vi.fn().mockResolvedValue([]),
  linksHolder: {
    links: {} as Record<
      string,
      { source: string; providerId?: string; displayName?: string }[]
    >,
  },
}));

vi.mock("../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));

vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: false }),
}));
vi.mock("../context/GameContext", () => ({
  useGames: () => ({ updateGame: vi.fn() }),
}));
vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../context/AchievementContext", () => ({
  useAchievements: () => ({
    getGameAchievements,
    syncGameAchievements,
    syncLocalAchievements: vi.fn(),
    syncRetroAchievements: vi.fn(),
    syncManualAchievements: vi.fn().mockResolvedValue(undefined),
    syncGogAchievements: vi.fn(),
    syncEpicAchievements: vi.fn(),
    removeManualLink: vi.fn(),
    getRetroSettings: vi.fn().mockResolvedValue({ consoleMap: [] }),
    fetchManualSchema,
    links: linksHolder.links,
    isSyncing: false,
  }),
}));

const POPULATED = {
  achievements: [
    {
      apiName: "ACH_1",
      displayName: "First",
      description: "Do a thing",
      achieved: true,
      unlockTime: 1_700_000_000,
      percent: 50,
    },
  ],
  total: 1,
  unlocked: 1,
  source: "steam",
  lastSynced: null,
};

const MANUAL_LINK = [{ source: "manual", providerId: "620", displayName: "Portal 2" }];

const game = {
  id: "game-1",
  name: "Portal 2",
  platform: "Steam",
  path: "",
  installed: true,
  playTime: "5h",
  addedAt: 1,
  steamAppId: 620,
  gogGameId: "1207658930",
} as Game;

describe("AchievementsTab controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
    syncGameAchievements.mockClear();
    linksHolder.links = {};
    getGameAchievements.mockReset();
    getGameAchievements.mockReturnValue(POPULATED);
  });

  afterEach(cleanup);

  it("registers the refresh control and activates it through the gamepad handler", async () => {
    const { container } = render(<AchievementsTab game={game} />);

    const refresh = container.querySelector<HTMLButtonElement>(".ach-tab-refresh");
    expect(refresh).not.toBeNull();
    expect(refresh!.tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === refresh);
    expect(entry).toBeTruthy();

    entry!.onActivate();
    await vi.waitFor(() =>
      expect(syncGameAchievements).toHaveBeenCalledWith("game-1", 620),
    );
  });

  it("registers the source switcher and view-mode controls", () => {
    const { container } = render(<AchievementsTab game={game} />);

    const source = container.querySelector<HTMLButtonElement>(".ach-source-picker-btn");
    const view = container.querySelector<HTMLButtonElement>(".ach-view-btn");
    expect(source).not.toBeNull();
    expect(view).not.toBeNull();
    expect(source!.tabIndex).toBe(0);
    expect(view!.tabIndex).toBe(0);
    expect(registered.some((e) => e.element === source)).toBe(true);
    expect(registered.some((e) => e.element === view)).toBe(true);
  });

  it("registers the empty-state manual-link controls with their own focus instances", async () => {
    getGameAchievements.mockReturnValue(null);
    linksHolder.links = { "game-1": MANUAL_LINK };

    const { container } = render(<AchievementsTab game={game} />);

    // Wait out the transient auto-load state so the manual-link empty state
    // (and its buttons) is the branch actually mounted.
    await waitFor(() => expect(screen.getByText("achievements.noData")).toBeTruthy());
    expect(container.querySelector(".ach-tab-refresh")).toBeNull();

    const editor = screen.getByRole("button", {
      name: "achievements.editManualUnlocks",
    }) as HTMLButtonElement;
    const unlink = screen.getByRole("button", {
      name: "achievements.unlink",
    }) as HTMLButtonElement;
    expect(editor.tabIndex).toBe(0);
    expect(unlink.tabIndex).toBe(0);

    const editorEntry = registered.find((e) => e.element === editor);
    const unlinkEntry = registered.find((e) => e.element === unlink);
    expect(editorEntry).toBeTruthy();
    expect(unlinkEntry).toBeTruthy();

    // Two separate `useFocusable` instances — sharing one ref would let a
    // single cleanup pair orphan one of these registrations.
    expect(editorEntry!.onActivate).not.toBe(unlinkEntry!.onActivate);
  });

  it("keeps a distinct focus instance for the populated toolbar editor button", async () => {
    linksHolder.links = { "game-1": MANUAL_LINK };
    getGameAchievements.mockReturnValue({
      ...POPULATED,
      source: "manual",
      lastSynced: null,
    });

    render(<AchievementsTab game={game} />);

    const editor = (await screen.findByRole("button", {
      name: "achievements.editManualUnlocks",
    })) as HTMLButtonElement;
    expect(editor.tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === editor);
    expect(entry).toBeTruthy();

    act(() => {
      entry!.onActivate();
    });
    expect(await screen.findByText("achievements.manualEditor.title")).toBeTruthy();
  });
});
