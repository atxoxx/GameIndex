import { describe, it, expect } from "vitest";
import type { DownloadHistory } from "../../types/download";
import {
  computeSourceReliability,
  getSourceReliability,
  hasReliabilitySample,
  MIN_RELIABILITY_SAMPLE,
} from "./reliability";

function row(overrides: Partial<DownloadHistory>): DownloadHistory {
  return {
    id: 0,
    downloadId: "d",
    kind: "torrent",
    name: "n",
    sourceName: "Source",
    savePath: "",
    downloaded: 0,
    totalSize: null,
    status: { kind: "completed" },
    debridCached: null,
    autoExtract: null,
    extracted: null,
    addedAt: 1,
    completedAt: 2,
    peakSpeed: 0,
    ...overrides,
  };
}

describe("computeSourceReliability", () => {
  it("counts completed, failed, and removed attempts", () => {
    const map = computeSourceReliability([
      row({ sourceName: "Alpha", status: { kind: "completed" } }),
      row({ sourceName: "Alpha", status: { kind: "completed" } }),
      row({ sourceName: "Alpha", status: { kind: "error", message: "x" } }),
      row({ sourceName: "Alpha", status: { kind: "removed" } }),
    ]);
    const alpha = getSourceReliability(map, "Alpha")!;
    expect(alpha.total).toBe(4);
    expect(alpha.completed).toBe(2);
    expect(alpha.failed).toBe(1);
    expect(alpha.removed).toBe(1);
    expect(alpha.successRate).toBeCloseTo(0.5);
  });

  it("averages peak speed across completed downloads only", () => {
    const map = computeSourceReliability([
      row({ sourceName: "Beta", status: { kind: "completed" }, peakSpeed: 1000 }),
      row({ sourceName: "Beta", status: { kind: "completed" }, peakSpeed: 3000 }),
      row({ sourceName: "Beta", status: { kind: "error", message: "x" }, peakSpeed: 9999 }),
    ]);
    expect(getSourceReliability(map, "Beta")!.avgPeakSpeed).toBe(2000);
  });

  it("keys sources case- and whitespace-insensitively", () => {
    const map = computeSourceReliability([
      row({ sourceName: "  Gamma  " }),
      row({ sourceName: "gamma" }),
    ]);
    expect(map.size).toBe(1);
    expect(getSourceReliability(map, "GAMMA")!.total).toBe(2);
  });

  it("ignores blank source names", () => {
    const map = computeSourceReliability([row({ sourceName: "   " })]);
    expect(map.size).toBe(0);
  });
});

describe("hasReliabilitySample", () => {
  it("hides rates below the sample threshold", () => {
    const small = computeSourceReliability([
      row({ sourceName: "S", status: { kind: "completed" } }),
    ]);
    expect(hasReliabilitySample(getSourceReliability(small, "S"))).toBe(false);

    const rows = Array.from({ length: MIN_RELIABILITY_SAMPLE }, (_, i) =>
      row({ sourceName: "S", id: i, status: { kind: "completed" } }),
    );
    const enough = computeSourceReliability(rows);
    expect(hasReliabilitySample(getSourceReliability(enough, "S"))).toBe(true);
  });
});
