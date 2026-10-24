import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModsCockpit from "./ModsCockpit";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join("/")}` : key,
  }),
}));

function props(overrides: Partial<React.ComponentProps<typeof ModsCockpit>> = {}) {
  return {
    moddedGames: 4,
    totalGames: 74,
    totalMods: 209,
    enabledMods: 209,
    activeRatio: 100,
    updates: 0,
    storageLabel: "109.35 GB",
    onToggleModded: vi.fn(),
    onOpenUpdates: vi.fn(),
    onFilterAll: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ModsCockpit", () => {
  it("leads with modded coverage and shows the four metrics", () => {
    render(<ModsCockpit {...props()} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("/74")).toBeTruthy();
    expect(screen.getByText("209")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("109.35 GB")).toBeTruthy();
  });

  it("routes the lead and updates metrics to their actions", () => {
    const onToggleModded = vi.fn();
    const onOpenUpdates = vi.fn();
    render(<ModsCockpit {...props({ updates: 3, onToggleModded, onOpenUpdates })} />);
    fireEvent.click(screen.getByText("4"));
    expect(onToggleModded).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /mods.global.pendingUpdates/ }));
    expect(onOpenUpdates).toHaveBeenCalled();
  });

  it("shows a clean update state when nothing is pending", () => {
    render(<ModsCockpit {...props()} />);
    expect(screen.getByText("mods.updates.noneFound")).toBeTruthy();
  });
});
