import { describe, it, expect } from "vitest";
import {
  costPerHour,
  formatCost,
  hoursToReachRate,
  libraryValueStats,
  parsePlayTime,
  resolvePurchaseCost,
  valueBenchmark,
  valueHistory,
  valueProjection,
  valueVerdict,
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

describe("valueVerdict", () => {
  it("buckets rates at the documented boundaries", () => {
    expect(valueVerdict(0, "USD")).toBe("great");
    expect(valueVerdict(2, "USD")).toBe("great");
    expect(valueVerdict(2.01, "USD")).toBe("fair");
    expect(valueVerdict(5, "USD")).toBe("fair");
    expect(valueVerdict(5.01, "USD")).toBe("poor");
  });

  it("returns null without a usable rate", () => {
    expect(valueVerdict(null, "USD")).toBeNull();
    expect(valueVerdict(undefined, "USD")).toBeNull();
    expect(valueVerdict(-1, "USD")).toBeNull();
    expect(valueVerdict(NaN, "USD")).toBeNull();
  });

  it("refuses to judge currencies it has no price level for", () => {
    expect(valueVerdict(1, "JPY")).toBeNull();
    expect(valueVerdict(1, "EUR")).toBe("great");
  });
});

describe("valueBenchmark", () => {
  const target = game({ id: "target", purchaseCost: 60, playTime: "20h" }); // 3/h

  it("reports the median and the share of worse-value games", () => {
    const library = [
      target,
      game({ id: "cheap", purchaseCost: 10, playTime: "10h" }), // 1/h
      game({ id: "same", purchaseCost: 30, playTime: "10h" }), // 3/h
      game({ id: "pricey", purchaseCost: 50, playTime: "5h" }), // 10/h
      game({ id: "mid", purchaseCost: 20, playTime: "10h" }), // 2/h
    ];
    const result = valueBenchmark(library, target)!;
    expect(result.count).toBe(5);
    expect(result.medianPerHour).toBeCloseTo(3);
    expect(result.betterThan).toBeCloseTo(0.2);
  });

  it("skips games priced in another currency", () => {
    const library = [
      target,
      game({ id: "eur", purchaseCost: 100, purchaseCurrency: "EUR", playTime: "1h" }),
      game({ id: "free", purchaseCost: 0, playTime: "10h" }),
      game({ id: "priceless" }),
    ];
    const result = valueBenchmark(library, target)!;
    expect(result.count).toBe(2);
    expect(result.currency).toBe("USD");
  });

  it("withholds the percentile until there are at least three rates", () => {
    const library = [target, game({ id: "cheap", purchaseCost: 10, playTime: "10h" })];
    const result = valueBenchmark(library, target)!;
    expect(result.count).toBe(2);
    expect(result.betterThan).toBeNull();
  });

  it("returns null when the game itself has no rate", () => {
    expect(valueBenchmark([target], game({ id: "unpriced" }))).toBeNull();
    expect(valueBenchmark([target], undefined)).toBeNull();
  });
});

describe("hoursToReachRate", () => {
  it("counts the remaining hours to a target rate", () => {
    // 60 USD at 2/hour needs 30h; 10h are already on the clock.
    expect(hoursToReachRate(60, "10h", 2)).toBeCloseTo(20);
  });

  it("returns 0 once the target is already met", () => {
    expect(hoursToReachRate(10, "20h", 1)).toBe(0);
    expect(hoursToReachRate(0, "0h", 1)).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(hoursToReachRate(-1, "10h", 2)).toBeNull();
    expect(hoursToReachRate(60, "10h", 0)).toBeNull();
    expect(hoursToReachRate(60, "10h", NaN)).toBeNull();
    expect(hoursToReachRate(NaN, "10h", 2)).toBeNull();
  });
});

describe("valueProjection", () => {
  it("projects the rate at the story milestone", () => {
    const result = valueProjection(60, "5h", { normally: 20 * 3600 });
    expect(result).toEqual({ hours: 20, perHour: 3, milestone: "story" });
  });

  it("falls through to the completionist milestone", () => {
    const result = valueProjection(60, "25h", { normally: 20 * 3600, completely: 50 * 3600 });
    expect(result?.milestone).toBe("complete");
    expect(result?.perHour).toBeCloseTo(1.2);
  });

  it("returns null when both milestones are already behind the playtime", () => {
    expect(
      valueProjection(60, "60h", { normally: 20 * 3600, completely: 50 * 3600 })
    ).toBeNull();
  });

  it("returns null without time-to-beat data or a valid cost", () => {
    expect(valueProjection(60, "5h", null)).toBeNull();
    expect(valueProjection(60, "5h", {})).toBeNull();
    expect(valueProjection(NaN, "5h", { normally: 20 * 3600 })).toBeNull();
  });
});

describe("valueHistory", () => {
  // Fixed "now" so the 12-month window is deterministic.
  const now = Date.UTC(2026, 5, 15);

  it("walks cumulative hours month by month and drops the rate", () => {
    const points = valueHistory(
      60,
      [
        { date: "2024-12-01T00:00:00.000Z", durationMin: 1200 }, // before the window
        { date: "2026-05-10T00:00:00.000Z", durationMin: 300 },
        { date: "2026-06-10T00:00:00.000Z", durationMin: 600 },
      ],
      12,
      now
    );
    expect(points).toHaveLength(12);
    const may = points[points.length - 2];
    const june = points[points.length - 1];
    // 20h baseline + 5h = 25h → 2.40/h, then 35h → 1.71/h
    expect(may.hours).toBeCloseTo(25);
    expect(may.rate).toBeCloseTo(60 / 25);
    expect(june.hours).toBeCloseTo(35);
    expect(june.rate).toBeCloseTo(60 / 35);
  });

  it("returns nothing without sessions or a valid cost", () => {
    expect(valueHistory(60, [], 12, now)).toEqual([]);
    expect(
      valueHistory(NaN, [{ date: "2026-06-01T00:00:00.000Z", durationMin: 600 }], 12, now)
    ).toEqual([]);
  });
});
