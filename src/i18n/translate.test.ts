import { beforeAll, describe, expect, it } from "vitest";
import { ensureLocaleLoaded, translate } from "./index";

describe("translate", () => {
  beforeAll(async () => {
    await ensureLocaleLoaded("de");
  });

  it("keeps the English plural suffix for English", () => {
    expect(
      translate("community.screenshotCount", "en", { count: 3, plural: "s" }),
    ).toBe("3 screenshots");
  });

  it("drops the English suffix once a real translation is used", () => {
    expect(
      translate("community.screenshotCount", "de", { count: 3, plural: "s" }),
    ).toBe("3 Screenshot(s)");
  });

  it("still interpolates non-suffix variables in a translated string", () => {
    expect(translate("sidebar.markedCount", "de", {
      count: 2,
      status: "Spielend",
    })).toBe("2 als Spielend markiert");
  });
});
