import { describe, expect, it, vi } from "vitest";
import { normalizeQrColor } from "./friendsUtils";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe("normalizeQrColor", () => {
  it("accepts hex values unchanged", () => {
    expect(normalizeQrColor("#050508", "#ffffff")).toBe("#050508");
    expect(normalizeQrColor("  #F3F5FA  ", "#000000")).toBe("#F3F5FA");
  });

  it("converts the rgb() form the theme writes onto the root element", () => {
    expect(normalizeQrColor("rgb(5, 5, 8)", "#ffffff")).toBe("#050508");
    expect(normalizeQrColor("rgba(243, 245, 250, 0.9)", "#000000")).toBe("#f3f5fa");
    expect(normalizeQrColor("rgb(15 20 30)", "#000000")).toBe("#0f141e");
  });

  it("falls back when the color is empty or unparseable", () => {
    // jsdom has no canvas, so unparseable values exercise the fallback path.
    expect(normalizeQrColor("", "black")).toBe("black");
    expect(normalizeQrColor("not-a-color", "white")).toBe("white");
  });
});
