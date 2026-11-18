import { beforeEach, describe, expect, it, vi } from "vitest";
import { preloadOnce, resetPreloadCache } from "./preload";

beforeEach(() => {
  resetPreloadCache();
});

describe("preloadOnce", () => {
  it("runs a loader once per key and shares the promise", () => {
    const load = vi.fn(async () => "chunk");
    preloadOnce("feature", load);
    preloadOnce("feature", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a failed load", async () => {
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("stale chunk"))
      .mockResolvedValueOnce("ok");

    preloadOnce("feature", load);
    await Promise.resolve();
    await Promise.resolve();

    preloadOnce("feature", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps independent keys independent", () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    preloadOnce("first", first);
    preloadOnce("second", second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores a loader that throws synchronously", () => {
    const load = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => preloadOnce("bad", load)).not.toThrow();
  });
});
