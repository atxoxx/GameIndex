import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

describe("storeCardHover signal", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes hover immediately and clears after the release grace period", async () => {
    const { setStoreCardHover, useStoreCardHover } = await import("./storeCardHover");
    const { result } = renderHook(() => useStoreCardHover());

    expect(result.current).toBe(false);

    act(() => setStoreCardHover(true));
    expect(result.current).toBe(true);

    act(() => setStoreCardHover(false));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(false);
  });

  it("bridges grid gaps so a sweep between cards stays one hover (error path)", async () => {
    const { setStoreCardHover, useStoreCardHover } = await import("./storeCardHover");
    const { result } = renderHook(() => useStoreCardHover());

    act(() => setStoreCardHover(true));
    act(() => setStoreCardHover(false));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => setStoreCardHover(true));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(true);
  });

  it("does not notify when the requested state is unchanged", async () => {
    const { setStoreCardHover, useStoreCardHover } = await import("./storeCardHover");
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useStoreCardHover();
    });

    act(() => setStoreCardHover(true));
    act(() => setStoreCardHover(true));
    act(() => setStoreCardHover(true));

    expect(result.current).toBe(true);
    expect(renders).toBe(2);
  });
});
