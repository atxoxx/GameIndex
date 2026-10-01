import { describe, it, expect } from "vitest";
import type { DownloadSearchResult } from "../../types/plugins";
import { recommendationScore, rankByRecommendation } from "./ranking";

function match(overrides: Partial<DownloadSearchResult>): DownloadSearchResult {
  return {
    sourceName: "Source",
    sourceId: "s",
    title: "Game",
    fileSize: "10 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0.8,
    isNew: false,
    provider: "source",
    ...overrides,
  };
}

describe("recommendationScore", () => {
  it("prefers the higher match score when no other signals exist", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const high = recommendationScore(match({ matchScore: 0.9 }), { now });
    const low = recommendationScore(match({ matchScore: 0.5 }), { now });
    expect(high).toBeGreaterThan(low);
  });

  it("does not penalise results lacking reliability data versus a good source", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const unknown = recommendationScore(match({}), { now, reliability: null });
    const good = recommendationScore(match({}), { now, reliability: 1 });
    expect(unknown).toBeLessThan(good);
    expect(unknown).toBeCloseTo(0.8, 5);
  });

  it("penalises a known-bad source below an unknown one", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const unknown = recommendationScore(match({}), { now, reliability: null });
    const bad = recommendationScore(match({}), { now, reliability: 0 });
    expect(bad).toBeLessThan(unknown);
  });

  it("rewards healthy swarms and recent uploads", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    const plain = recommendationScore(match({}), { now });
    const healthy = recommendationScore(
      match({ seeds: 40, peers: 10, uploadDate: "2026-05-30T00:00:00Z" }),
      { now },
    );
    expect(healthy).toBeGreaterThan(plain);
  });

  it("applies a small bonus for verified results", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const base = recommendationScore(match({}), { now });
    const verified = recommendationScore(match({ verified: true }), { now });
    expect(verified).toBeGreaterThan(base);
  });
});

describe("rankByRecommendation", () => {
  it("orders best-first and keeps ties stable by match score", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const a = match({ title: "A", matchScore: 0.4 });
    const b = match({ title: "B", matchScore: 0.9 });
    const c = match({ title: "C", matchScore: 0.9, seeds: 30 });
    const ranked = rankByRecommendation([a, b, c], () => ({ now }));
    expect(ranked.map((m) => m.title)).toEqual(["C", "B", "A"]);
  });
});
