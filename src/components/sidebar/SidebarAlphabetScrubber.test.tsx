import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SidebarAlphabetScrubber, { computeRailRowHeight } from "./SidebarAlphabetScrubber";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

describe("computeRailRowHeight", () => {
  it("caps the row height once a short index has room to spare", () => {
    expect(computeRailRowHeight(500, 10)).toBe(14);
  });

  it("divides the viewport between every letter of a full alphabet", () => {
    // 300px viewport, 12px of inset, 26 letters.
    expect(computeRailRowHeight(300, 26)).toBeCloseTo(288 / 26, 5);
  });

  it("returns 0 for a viewport that cannot fit the letters legibly", () => {
    expect(computeRailRowHeight(80, 26)).toBe(0);
    expect(computeRailRowHeight(0, 26)).toBe(0);
    expect(computeRailRowHeight(-40, 26)).toBe(0);
    expect(computeRailRowHeight(Number.NaN, 26)).toBe(0);
  });

  it("returns 0 when there is nothing to index", () => {
    expect(computeRailRowHeight(500, 0)).toBe(0);
  });
});

describe("SidebarAlphabetScrubber", () => {
  const originalClientHeight =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight") ??
    Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");

  function setViewportHeight(height: number) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => height,
    });
  }

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  function renderRail(onSelectLetter = vi.fn()) {
    render(
      <div className="sidebar-list-region">
        <SidebarAlphabetScrubber
          availableLetters={LETTERS}
          onSelectLetter={onSelectLetter}
        />
      </div>
    );
    return onSelectLetter;
  }

  it("shows every letter when the list viewport has room", () => {
    setViewportHeight(400);
    renderRail();

    const rail = screen.getByLabelText("Alphabetical index");
    expect(rail).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(LETTERS.length);
    expect(rail.style.getPropertyValue("--rail-row")).toBe("14px");
  });

  it("compresses the letters to fit a short list viewport", () => {
    setViewportHeight(272);
    renderRail();

    const rail = screen.getByLabelText("Alphabetical index");
    expect(rail).toBeVisible();
    expect(rail.style.getPropertyValue("--rail-row")).toBe("10px");
  });

  it("jumps to the clicked letter", () => {
    setViewportHeight(400);
    const onSelectLetter = renderRail();

    fireEvent.click(screen.getByLabelText("Jump to B"));

    expect(onSelectLetter).toHaveBeenCalledWith("B");
  });

  it("hides instead of overflowing when the list viewport is too short", () => {
    setViewportHeight(70);
    renderRail();

    expect(screen.getByLabelText("Alphabetical index")).not.toBeVisible();
  });
});
