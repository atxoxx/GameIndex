import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BigScreenSystem from "./BigScreenSystem";
import { getBumperScope } from "./bigscreenLegend";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({
    registerAction: () => () => {},
    registerTabCycler: () => () => {},
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

describe("BigScreenSystem bumper legend scope", () => {
  it("declares the tabs scope while mounted so the footer legend tells the truth", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <BigScreenSystem />
      </MemoryRouter>,
    );

    expect(getBumperScope()).toBe("tabs");

    unmount();
    expect(getBumperScope()).toBe("sections");
  });
});
