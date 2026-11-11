import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useInfiniteScroll } from "./useInfiniteScroll";

interface FakeObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[];
  disconnected: boolean;
}

let observers: FakeObserver[] = [];

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[] = [];
  disconnected = false;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve(target: Element) {
    this.targets = this.targets.filter((item) => item !== target);
  }

  disconnect() {
    this.disconnected = true;
    this.targets = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function activeObserver(): FakeObserver {
  const observer = [...observers].reverse().find((item) => !item.disconnected);
  if (!observer) throw new Error("no active IntersectionObserver");
  return observer;
}

function intersect(observer: FakeObserver, isIntersecting = true) {
  act(() => {
    observer.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}

function Harness({
  onLoadMore,
  enabled = true,
  resetKey,
}: {
  onLoadMore: () => void;
  enabled?: boolean;
  resetKey?: string | number;
}) {
  const sentinelRef = useInfiniteScroll<HTMLDivElement>(onLoadMore, {
    enabled,
    resetKey,
  });
  return <div data-testid="sentinel" ref={sentinelRef} />;
}

describe("useInfiniteScroll", () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("observes the sentinel with a prefetch margin and fires once on intersect", () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);

    const observer = activeObserver();
    expect(observer.targets).toHaveLength(1);
    expect(observer.options?.rootMargin).toBe("400px");

    intersect(observer);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Still on screen, same page: no second request.
    intersect(observer);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("ignores intersections that are not actually visible", () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);

    intersect(activeObserver(), false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("stays disarmed while a page is in flight and re-arms after it settles", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<Harness onLoadMore={onLoadMore} />);

    intersect(activeObserver());
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Loading: the observer is torn down, nothing observes the sentinel.
    rerender(<Harness onLoadMore={onLoadMore} enabled={false} />);
    expect(observers.every((item) => item.disconnected)).toBe(true);

    // Page resolved: a fresh observer re-arms and fires again.
    rerender(<Harness onLoadMore={onLoadMore} enabled />);
    intersect(activeObserver());
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does not fire when there are no more pages", () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} enabled={false} />);

    expect(observers).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("re-arms when the reset key changes (a new page or filter)", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness onLoadMore={onLoadMore} resetKey={12} />,
    );

    intersect(activeObserver());
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(<Harness onLoadMore={onLoadMore} resetKey={24} />);
    intersect(activeObserver());
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without re-observing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onLoadMore={first} />);

    rerender(<Harness onLoadMore={second} />);
    intersect(activeObserver());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
