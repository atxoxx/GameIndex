import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import BigScreenSystem from "./BigScreenSystem";
import { getBumperScope } from "./bigscreenLegend";

const pads = vi.hoisted(() => ({
  tabCycler: null as ((direction: "forward" | "back") => void) | null,
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({
    registerAction: () => () => {},
    registerTabCycler: (fn: (direction: "forward" | "back") => void) => {
      pads.tabCycler = fn;
      return () => {
        pads.tabCycler = null;
      };
    },
  }),
}));
vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    currentTheme: "dark",
    setTheme: vi.fn(),
    themes: [{ id: "dark" }],
  }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ landingPage: "library", setLandingPage: vi.fn() }),
}));
// The in-hub views pull their own data providers; the landing/cycler tests
// only care that the hub swaps to the right view.
vi.mock("./system/DownloadsView", () => ({ default: () => null }));
vi.mock("./system/StorageView", () => ({ default: () => null }));
vi.mock("./system/AchievementsView", () => ({ default: () => null }));
vi.mock("./system/SettingsView", () => ({ default: () => null }));

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function renderHub(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BigScreenSystem />
      <PathProbe />
    </MemoryRouter>,
  );
}

const tiles = () =>
  screen
    .getAllByRole("button")
    .filter((el) => el.classList.contains("bigscreen-system-tile"));

describe("BigScreenSystem bumper legend scope", () => {
  it("declares the tabs scope while mounted so the footer legend tells the truth", () => {
    const { unmount } = renderHub("/settings");

    expect(getBumperScope()).toBe("tabs");

    unmount();
    expect(getBumperScope()).toBe("sections");
  });
});

describe("BigScreenSystem tile landing", () => {
  it("lists every System entry as a focusable tile and opens its route", () => {
    pads.tabCycler = null;
    renderHub("/settings");

    expect(tiles()).toHaveLength(8);

    fireEvent.click(tiles()[0]);
    expect(screen.getByTestId("path").textContent).toBe("/downloads");
  });

  it("cycles from the landing instead of ignoring LB/RB", () => {
    pads.tabCycler = null;
    renderHub("/settings");

    expect(pads.tabCycler).not.toBeNull();
    act(() => pads.tabCycler!("forward"));

    expect(screen.getByTestId("path").textContent).toBe("/downloads");
  });

  it("keeps the landing for a System route the hub does not own", () => {
    renderHub("/saves");

    expect(tiles()).toHaveLength(8);
  });
});
