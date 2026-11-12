import { describe, expect, it } from "vitest";
import { clampFileProgress } from "../../../electron/main/features/downloads/progress";

describe("clampFileProgress", () => {
  it("maps negative byte counts (shared-piece subtraction) to 0 %", () => {
    const result = clampFileProgress(-4464, 222);
    expect(result.downloaded).toBe(0);
    expect(result.progress).toBe(0);
  });

  it("never reports more than the file length", () => {
    const result = clampFileProgress(2_048, 1_024);
    expect(result.downloaded).toBe(1_024);
    expect(result.progress).toBe(1);
  });

  it("keeps a real partial fraction intact", () => {
    const result = clampFileProgress(512, 2_048);
    expect(result.progress).toBeCloseTo(0.25, 5);
  });

  it("handles zero-length and non-finite inputs", () => {
    expect(clampFileProgress(10, 0)).toEqual({ length: 0, downloaded: 0, progress: 0 });
    expect(clampFileProgress(Number.NaN, 100).progress).toBe(0);
    expect(clampFileProgress(50, Number.NaN).progress).toBe(0);
    expect(clampFileProgress("50", "100").progress).toBe(0.5);
  });
});
