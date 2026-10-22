import { describe, it, expect } from "vitest";
import {
  costPerHour,
  formatCost,
  libraryValueStats,
  parsePlayTime,
  resolvePurchaseCost,
  type Game,
} from "./game";

function game(patch: Partial<Game>): Game {
  return {
    id: "g1",
    name: "Test Game",
    path: "",
    platform: "GOG",
    installed: true,
    playTime: "5h",
    addedAt: 0,
    ...patch,
  } as Game;
}

describe("costPerHour", () => {
  it("divides a set cost by the tracked playtime", () => {
    // 60 USD over 5h = 12 USD/h
    expect(costPerHour(game({ purchaseCost: 60, purchaseCurrency: "USD" }))).toBeCloseTo(12);
  });

  it("treats a free game as 0, not missing data", () => {
    expect(costPerHour(game({ purchaseCost: 0, purchaseCurrency: "USD" }))).toBe(0);
  });

  it("returns null when no cost is set", () => {
    expect(costPerHour(game({}))).toBeNull();
    expect(costPerHour(undefined)).toBeNull();
  });

  it("returns null for invalid costs", () => {
    expect(costPerHour(game({ purchaseCost: -5 }))).toBeNull();
    expect(costPerHour(game({ purchaseCost: NaN }))).toBeNull();
    expect(costPerHour(game({ purchaseCost: Infinity }))).toBeNull();
  });

  it("returns null below the minimum-playtime threshold", () => {
    expect(costPerHour(game({ purchaseCost: 20, playTime: "20m" }))).toBeNull();
    expect(costPerHour(game({ purchaseCost: 20, playTime: "30m" }))).not.toBeNull();
  });
});

describe("formatCost", () => {
  it("renders cost with two decimals and the currency code", () => {
    expect(formatCost(9.99, "USD")).toBe("9.99 USD");
    expect(formatCost(60, "USD")).toBe("60.00 USD");
  });

  it("defaults to USD when the row has no currency", () => {
    expect(formatCost(29.5)).toBe("29.50 USD");
  });
  it("uppercases the stored currency code", () => {
    expect(formatCost(10, "eur")).toBe("10.00 EUR");
  });
});

describe("libraryValueStats", () => {
  it("groups per currency without mixing them", () => {
    const stats = libraryValueStats([
      game({ id: "a", purchaseCost: 60, purchaseCurrency: "USD" }),
      game({ id: "b", purchaseCost: 30, purchaseCurrency: "USD", playTime: "15h" }),
      game({ id: "c", purchaseCost: 40, purchaseCurrency: "EUR" }),
      game({ id: "d" }), // no cost — skipped
    ]);
    expect(stats).not.toBeNull();
    expect(stats!.byCurrency).toHaveLength(2);
    expect(stats!.byCurrency[0].currency).toBe("USD");
    expect(stats!.byCurrency[0].spent).toBe(90);
    expect(stats!.byCurrency[0].priced).toBe(2);
    expect(stats!.byCurrency[0].minutes).toBe(parsePlayTime("5h") + parsePlayTime("15h"));
    expect(stats!.byCurrency[1].currency).toBe("EUR");
  });

  it("ranks best and worst value across currencies", () => {
    const stats = libraryValueStats([
      game({ id: "cheap", purchaseCost: 10, playTime: "100h" }), // 0.1/h
      game({ id: "pricey", purchaseCost: 70, purchaseCurrency: "USD", playTime: "1h" }), // 70/h
    ]);
    expect(stats!.bestValue!.game.id).toBe("cheap");
    expect(stats!.worstValue!.game.id).toBe("pricey");
  });

  it("returns null for an unpriced library", () => {
    expect(libraryValueStats([game({}), game({ id: "x" })])).toBeNull();
    expect(libraryValueStats([])).toBeNull();
  });
});

describe("resolvePurchaseCost", () => {
  it("prefers the saved purchase cost over a known store price", () => {
    expect(
      resolvePurchaseCost({ purchaseCost: 40, purchaseCurrency: "eur" }, 19.99)
    ).toEqual({ cost: 40, currency: "EUR", source: "stored" });
  });

  it("falls back to the already-known store price (USD)", () => {
    expect(resolvePurchaseCost({}, 2.99)).toEqual({
      cost: 2.99,
      currency: "USD",
      source: "price",
    });
  });

  it("returns null when neither is known or values are invalid", () => {
    expect(resolvePurchaseCost({}, null)).toBeNull();
    expect(resolvePurchaseCost(undefined, undefined)).toBeNull();
    expect(resolvePurchaseCost({ purchaseCost: -1 }, -5)).toBeNull();
    expect(resolvePurchaseCost({ purchaseCost: NaN }, NaN)).toBeNull();
  });

  it("treats a free (0) known price as usable", () => {
    expect(resolvePurchaseCost({}, 0)).toEqual({
      cost: 0,
      currency: "USD",
      source: "price",
    });
  });
});
