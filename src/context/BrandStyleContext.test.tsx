import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  BrandStyleProvider,
  isBrandStyleId,
  BRAND_STYLES,
  useBrandStyle,
} from "./BrandStyleContext";

const STORAGE_KEY = "gamelib-brand-style";

function Probe() {
  const { currentStyle, setStyle } = useBrandStyle();
  return (
    <div>
      <span data-testid="style">{currentStyle}</span>
      <button onClick={() => setStyle("steam")}>use steam</button>
      <button onClick={() => setStyle("material")}>use material</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <BrandStyleProvider>
      <Probe />
    </BrandStyleProvider>
  );
}

describe("isBrandStyleId", () => {
  it("accepts known style ids", () => {
    for (const style of BRAND_STYLES) {
      expect(isBrandStyleId(style.id)).toBe(true);
    }
  });

  it("rejects unknown ids", () => {
    expect(isBrandStyleId("neon")).toBe(false);
    expect(isBrandStyleId("classic2")).toBe(false);
    expect(isBrandStyleId("")).toBe(false);
  });
});

describe("BrandStyleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-ui-style");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-ui-style");
  });

  it("defaults to classic, applies it to <html>, and switches + persists (happy path)", () => {
    renderProvider();
    expect(screen.getByTestId("style")).toHaveTextContent("classic");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("classic");

    fireEvent.click(screen.getByText("use steam"));
    expect(screen.getByTestId("style")).toHaveTextContent("steam");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("steam");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("steam");

    fireEvent.click(screen.getByText("use material"));
    expect(screen.getByTestId("style")).toHaveTextContent("material");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("material");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("material");
  });

  it("restores a previously persisted style on mount", () => {
    localStorage.setItem(STORAGE_KEY, "glass");
    renderProvider();
    expect(screen.getByTestId("style")).toHaveTextContent("glass");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("glass");
  });

  it("falls back to classic for an invalid persisted id (error path)", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-style");
    renderProvider();
    expect(screen.getByTestId("style")).toHaveTextContent("classic");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("classic");
  });
});