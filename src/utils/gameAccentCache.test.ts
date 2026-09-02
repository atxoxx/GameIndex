import { describe, it, expect, beforeEach } from "vitest";
import {
  readCachedGameAccent,
  writeCachedGameAccent,
} from "./gameAccentCache";

const LS_KEY = "gamelib.accent_palette_cache";

const SAMPLE = { primary: "rgb(200, 40, 30)", secondary: "#3a66ff", deep: "#221a3a" };

beforeEach(() => {
  localStorage.clear();
});

describe("readCachedGameAccent", () => {
  it("returns null when nothing is stored", () => {
    expect(readCachedGameAccent("https://cover/a.jpg")).toBeNull();
  });

  it("round-trips a palette written earlier", () => {
    writeCachedGameAccent("https://cover/a.jpg", SAMPLE);
    expect(readCachedGameAccent("https://cover/a.jpg")).toEqual(SAMPLE);
  });

  it("returns null for an unknown URL", () => {
    writeCachedGameAccent("https://cover/a.jpg", SAMPLE);
    expect(readCachedGameAccent("https://cover/b.jpg")).toBeNull();
  });

  it("survives corrupt stored JSON", () => {
    localStorage.setItem(LS_KEY, "{not json");
    expect(readCachedGameAccent("https://cover/a.jpg")).toBeNull();
  });

  it("rejects malformed entries instead of leaking garbage", () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ "https://cover/a.jpg": { primary: 123, nope: true } })
    );
    expect(readCachedGameAccent("https://cover/a.jpg")).toBeNull();
  });
});

describe("writeCachedGameAccent", () => {
  it("evicts the oldest entries when the cache exceeds its cap", () => {
    // Seed a full cache with sequential timestamps (1 = oldest).
    const seed: Record<string, unknown> = {};
    for (let i = 1; i <= 100; i++) {
      seed[`https://cover/${i}.jpg`] = { ...SAMPLE, ts: i };
    }
    localStorage.setItem(LS_KEY, JSON.stringify(seed));

    writeCachedGameAccent("https://cover/new.jpg", SAMPLE);

    const stored = JSON.parse(localStorage.getItem(LS_KEY)!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored)).toHaveLength(100);
    expect(stored["https://cover/1.jpg"]).toBeUndefined(); // oldest dropped
    expect(stored["https://cover/new.jpg"]).toBeDefined();
    expect(stored["https://cover/100.jpg"]).toBeDefined();
  });
});