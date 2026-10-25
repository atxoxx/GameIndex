import { describe, expect, it } from "vitest";
import type { SteamDlcItem } from "../../../types/steam";
import {
  cleanDescription,
  dlcCounts,
  filterDlcList,
  isOnSale,
  ownershipPercent,
} from "./dlcData";

function dlc(overrides: Partial<SteamDlcItem> & { appId: number }): SteamDlcItem {
  return {
    name: `DLC ${overrides.appId}`,
    isFree: false,
    isOwned: false,
    isInstalled: false,
    ...overrides,
  };
}

const catalog: SteamDlcItem[] = [
  dlc({ appId: 1, name: "Zeta Expansion", isOwned: true, priceFormatted: "$9.99" }),
  dlc({
    appId: 2,
    name: "Alpha Pack",
    discountPercent: 50,
    finalPriceCents: 499,
    initialPriceCents: 999,
    priceFormatted: "$4.99",
    initialPriceFormatted: "$9.99",
    isWatched: true,
  }),
  dlc({ appId: 3, name: "Freebie", isFree: true, priceFormatted: "Free" }),
  dlc({ appId: 4, name: "Beta Skin", finalPriceCents: 199, priceFormatted: "$1.99" }),
];

describe("dlcData", () => {
  it("derives counts and collection progress", () => {
    expect(dlcCounts(catalog)).toEqual({
      all: 4,
      owned: 1,
      unowned: 3,
      onSale: 1,
      free: 1,
      watched: 1,
    });
    expect(ownershipPercent(4, 1)).toBe(25);
    expect(ownershipPercent(0, 0)).toBe(0);
  });

  it("filters by ownership, sale, free and watchlist", () => {
    expect(filterDlcList(catalog, { filter: "owned" }).map((d) => d.appId)).toEqual([1]);
    expect(filterDlcList(catalog, { filter: "onSale" }).map((d) => d.appId)).toEqual([2]);
    expect(filterDlcList(catalog, { filter: "free" }).map((d) => d.appId)).toEqual([3]);
    expect(filterDlcList(catalog, { filter: "watched" }).map((d) => d.appId)).toEqual([2]);
    expect(isOnSale(catalog[0])).toBe(false);
  });

  it("sorts by price and discount, with free first on ascending price", () => {
    expect(
      filterDlcList(catalog, { filter: "all", sort: "priceAsc" }).map((d) => d.appId)
    ).toEqual([3, 4, 2, 1]);
    expect(
      filterDlcList(catalog, { filter: "all", sort: "discount" }).map((d) => d.appId)[0]
    ).toBe(2);
  });

  it("searches names and cleans Steam store copy", () => {
    expect(
      filterDlcList(catalog, { filter: "all", query: "alpha" }).map((d) => d.appId)
    ).toEqual([2]);
    expect(cleanDescription("<p>Hello<br>world &amp; friends</p>")).toBe(
      "Hello\nworld & friends"
    );
  });
});
