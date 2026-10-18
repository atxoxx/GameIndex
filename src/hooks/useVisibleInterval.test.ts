import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useVisibleInterval } from "./useVisibleInterval";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useVisibleInterval", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setHidden(false);
    vi.restoreAllMocks();
  });

  it("ticks immediately and on the interval while visible", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000));

    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops ticking while hidden and resumes with a fresh tick", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000));

    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      setHidden(true);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => {
      setHidden(false);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not start an interval while hidden from mount", () => {
    vi.useFakeTimers();
    setHidden(true);
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useVisibleInterval(fn, 1000, false));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
