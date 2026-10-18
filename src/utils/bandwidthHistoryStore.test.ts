import { describe, expect, it } from "vitest";
import {
  appendBandwidthSample,
  parseStoredBandwidthSamples,
  type BandwidthPoint,
} from "./bandwidthHistoryStore";

function point(ts: number, down: number, up = 0): BandwidthPoint {
  return { ts, time: "12:00:00", down, up };
}

describe("parseStoredBandwidthSamples", () => {
  it("returns an empty list for missing or malformed payloads", () => {
    expect(parseStoredBandwidthSamples(null)).toEqual([]);
    expect(parseStoredBandwidthSamples("not json")).toEqual([]);
    expect(parseStoredBandwidthSamples('{"down":5}')).toEqual([]);
    expect(parseStoredBandwidthSamples('[{"ts":1}]')).toEqual([]);
  });

  it("keeps well-formed samples and drops bad entries", () => {
    const raw = JSON.stringify([point(1, 10), { ts: "x" }, null]);
    expect(parseStoredBandwidthSamples(raw)).toEqual([point(1, 10)]);
  });
});

describe("appendBandwidthSample", () => {
  it("appends active traffic and trims to the cap", () => {
    const samples = [point(1, 1), point(2, 2)];
    expect(appendBandwidthSample(samples, point(3, 3), 3).map((s) => s.ts)).toEqual([1, 2, 3]);
    expect(appendBandwidthSample(samples, point(3, 3), 2).map((s) => s.ts)).toEqual([2, 3]);
  });

  it("skips a repeated idle sample but keeps the first zero", () => {
    const idle = point(1, 0);
    const afterZero = appendBandwidthSample([idle], point(2, 0));
    expect(afterZero).toEqual([idle]);
    expect(appendBandwidthSample([], idle)).toEqual([idle]);
    expect(appendBandwidthSample([idle], point(2, 5))).toHaveLength(2);
  });
});
