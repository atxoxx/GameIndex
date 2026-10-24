import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WorkspaceHeader from "./WorkspaceHeader";
import type { Game } from "../../../types/game";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const game = {
  id: "g1",
  name: "Skyrim",
  path: "C:/games/skyrim",
  platform: "Steam",
  installed: true,
  playTime: "0h",
  addedAt: 0,
  modsFolder: "C:/games/skyrim/Data",
} as Game;

function props(overrides: Partial<React.ComponentProps<typeof WorkspaceHeader>> = {}) {
  return {
    game,
    variant: "page" as const,
    tab: "installed" as const,
    onTabChange: vi.fn(),
    stats: { total: 12, enabled: 9, updates: 3, sizeBytes: 1024 },
    presetCount: 2,
    conflictCount: 1,
    healthCount: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("WorkspaceHeader", () => {
  it("renders every workspace tab on the Mods page", () => {
    render(<WorkspaceHeader {...props()} />);
    for (const key of [
      "mods.tab.installedMods",
      "mods.discover.cta",
      "mods.tab.updates",
      "mods.tab.conflicts",
      "mods.tab.profiles",
      "mods.tab.mo2",
    ]) {
      expect(screen.getByRole("tab", { name: new RegExp(key) })).toBeTruthy();
    }
  });

  it("keeps the game-detail subtab to the manager and discover views", () => {
    render(<WorkspaceHeader {...props({ variant: "subtab" })} />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: /mods.tab.profiles/ })).toBeNull();
  });

  it("reports the chosen tab", () => {
    const onTabChange = vi.fn();
    render(<WorkspaceHeader {...props({ onTabChange })} />);
    fireEvent.click(screen.getByRole("tab", { name: /mods.tab.conflicts/ }));
    expect(onTabChange).toHaveBeenCalledWith("conflicts");
  });
});
