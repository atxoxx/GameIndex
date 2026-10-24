import { describe, expect, it } from "vitest";
import type { DealItem } from "../../types/deals";
import {
  calculateSavings,
  formatCountdown,
  formatPrice,
  groupDealsByTitle,
  steamAppIdFromUrl,
} from "./dealsConstants";

function deal(overrides: Partial<DealItem>): DealItem {
  return {
    id: "deal-1",
    gameTitle: "Hades",
    storeName: "Steam",
    storeUrl: "https://store.steampowered.com/app/1145360/",
    dealPrice: 10,
    discountPercent: 50,
    expiration: null,
    platform: "Windows",
    thumbnail: null,
    ...overrides,
  };
}

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("groupDealsByTitle", () => {
  it("collapses the same game across stores and keeps the cheapest first", () => {
    const groups = groupDealsByTitle([
      deal({ id: "a", storeName: "Steam", dealPrice: 12, discountPercent: 40 }),
      deal({ id: "b", storeName: "GOG", dealPrice: 8, discountPercent: 60 }),
      deal({ id: "c", storeName: "Humble", dealPrice: 10, discountPercent: 50 }),
    ]);

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.best.storeName).toBe("GOG");
    expect(group.bestPrice).toBe(8);
    expect(group.worstPrice).toBe(12);
    expect(group.maxDiscount).toBe(60);
    expect(group.storeCount).toBe(3);
    expect(group.savings).toBeCloseTo(4);
    expect(group.offers.map((offer) => offer.storeName)).toEqual([
      "GOG",
      "Humble",
      "Steam",
    ]);
  });

  it("treats titles that differ only by punctuation or case as one game", () => {
    const groups = groupDealsByTitle([
      deal({ id: "a", gameTitle: "Hollow Knight: Silksong" }),
      deal({ id: "b", gameTitle: "hollow knight silksong", storeName: "GOG" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].storeCount).toBe(2);
  });

  it("drops rows with no usable title and ignores unparseable expiries", () => {
    const groups = groupDealsByTitle([
      deal({ id: "a", gameTitle: "   " }),
      deal({ id: "b", gameTitle: "Celeste", expiration: "not-a-date" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Celeste");
    expect(groups[0].expiresAt).toBeNull();
  });
});

describe("formatCountdown", () => {
  const now = new Date("2026-10-24T12:00:00Z").getTime();

  it("formats a multi-day window and flags urgency only under six hours", () => {
    expect(
      formatCountdown("2026-10-27T12:00:00Z", t, now),
    ).toMatchObject({ isExpired: false, isUrgent: false });
    expect(
      formatCountdown("2026-10-24T15:30:00Z", t, now),
    ).toMatchObject({ isUrgent: true, isExpired: false });
  });

  it("reports an expired giveaway instead of a negative timer", () => {
    const result = formatCountdown("2026-10-24T11:00:00Z", t, now);
    expect(result).toMatchObject({ isExpired: true, msLeft: 0 });
    expect(result?.label).toBe("deals.expired");
  });

  it("returns null for a missing timestamp", () => {
    expect(formatCountdown(null, t, now)).toBeNull();
  });
});

describe("price helpers", () => {
  it("localises the zero-price label and reconstructs savings", () => {
    expect(formatPrice(0, "EUR", "Kostenlos")).toBe("Kostenlos");
    expect(formatPrice(19.99)).toBe("€19.99");

    const full = calculateSavings(10, 50);
    expect(full.originalPrice).toBeCloseTo(20);
    expect(full.savings).toBeCloseTo(10);

    // A free or already-100%-off row must not divide by zero.
    expect(calculateSavings(0, 100)).toEqual({ originalPrice: 0, savings: 0 });
  });
});

describe("steamAppIdFromUrl", () => {
  it("extracts the app id from Steam store links only", () => {
    expect(
      steamAppIdFromUrl("https://store.steampowered.com/app/1145360/Hades/"),
    ).toBe(1145360);
    expect(steamAppIdFromUrl("https://www.gog.com/game/hades")).toBeNull();
    expect(steamAppIdFromUrl(null)).toBeNull();
  });
});
