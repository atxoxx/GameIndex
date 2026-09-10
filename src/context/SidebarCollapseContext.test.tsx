import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  SidebarCollapseProvider,
  useSidebarCollapse,
} from "./SidebarCollapseContext";

type MqlListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MqlListener>();
  const mql = {
    matches: initialMatches,
    media: "(max-width: 1100px)",
    onchange: null,
    addEventListener: (_: string, cb: MqlListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: MqlListener) => listeners.delete(cb),
    addListener: (cb: MqlListener) => listeners.add(cb),
    removeListener: (cb: MqlListener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return {
    emit(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
  };
}

function Probe() {
  const { isIconRail, toggle, sidebarWidth, setSidebarWidth, resetSidebarWidth } =
    useSidebarCollapse();
  return (
    <div>
      <span data-testid="rail">{String(isIconRail)}</span>
      <span data-testid="width">{sidebarWidth}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={() => setSidebarWidth(520)}>wide</button>
      <button onClick={resetSidebarWidth}>reset</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <SidebarCollapseProvider>
      <Probe />
    </SidebarCollapseProvider>
  );
}

describe("SidebarCollapseProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--sidebar-width");
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("toggles between the full sidebar and the icon rail and persists the choice (happy path)", () => {
    renderProvider();
    expect(screen.getByTestId("rail")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("rail")).toHaveTextContent("true");
    expect(localStorage.getItem("gamelib.sidebar.icon_rail:v1")).toBe("true");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("rail")).toHaveTextContent("false");
    expect(localStorage.getItem("gamelib.sidebar.icon_rail:v1")).toBe("false");
  });

  it("forces the icon rail on a narrow viewport and restores the preference when widened (happy path)", () => {
    const media = installMatchMedia(true);
    renderProvider();
    expect(screen.getByTestId("rail")).toHaveTextContent("true");

    act(() => media.emit(false));
    expect(screen.getByTestId("rail")).toHaveTextContent("false");

    act(() => media.emit(true));
    expect(screen.getByTestId("rail")).toHaveTextContent("true");
  });

  it("clamps a custom sidebar width to the window and resets cleanly (error path)", () => {
    renderProvider();

    fireEvent.click(screen.getByText("wide"));
    expect(screen.getByTestId("width")).toHaveTextContent("520");
    // jsdom viewport is 1024px wide: 1024 - 640 = 384px maximum.
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("384px");

    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("width")).toHaveTextContent("280");
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("");
  });

  it("degrades gracefully when matchMedia is unavailable (error path)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    renderProvider();
    expect(screen.getByTestId("rail")).toHaveTextContent("false");
  });
});
