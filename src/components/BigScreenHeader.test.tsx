import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BigScreenHeader from "./BigScreenHeader";

// The header only needs the language strings, the gamepad bridge and the
// Big Screen setter; the real providers pull in app-wide state.
vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../context/BigScreenContext", () => ({
  useBigScreen: () => ({ setBigScreen: vi.fn() }),
}));
vi.mock("../hooks/GamepadProvider", () => ({
  useGamepad: () => ({
    connected: false,
    virtualMouse: { visible: false },
    toggleVirtualMouse: vi.fn(),
    registerTabCycler: () => () => {},
    registerAction: () => () => {},
  }),
}));

beforeAll(() => {
  // jsdom has no layout, so the strip's scroll effect has nothing to call.
  Element.prototype.scrollIntoView = vi.fn();
});

function activeSection(path: string): Element | null {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <BigScreenHeader />
    </MemoryRouter>,
  );
  const active = container.querySelectorAll(".bigscreen-v3-sections .is-active");
  expect(active).toHaveLength(1);
  return active[0] ?? null;
}

describe("BigScreenHeader active strip entry", () => {
  // Regression: on a System subpage `getActiveTabPath` falls back to "/home",
  // so Home and the System entry were both active and the first match in DOM
  // order (Home) was scrolled into view, pushing the System entry off-screen.
  it("highlights only the System entry on a System subpage", () => {
    expect(activeSection("/downloads")?.getAttribute("aria-label")).toBe(
      "bigscreen.shell.system",
    );
  });

  it("highlights the matching primary section elsewhere", () => {
    expect(activeSection("/library")?.getAttribute("aria-label")).toBe("nav.library");
    expect(activeSection("/community")?.getAttribute("aria-label")).toBe("nav.stats");
  });
});
