import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ArtworkImage } from "./ArtworkImage";

/** Minimal IntersectionObserver mock that lets a test drive visibility. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  elements = new Set<Element>();
  root = null;
  rootMargin = "";
  thresholds = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.elements.add(el);
  }

  unobserve(el: Element) {
    this.elements.delete(el);
  }

  disconnect() {
    this.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting: boolean) {
    const entries = [...this.elements].map(
      (target) => ({ target, isIntersecting }) as unknown as IntersectionObserverEntry
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ArtworkImage", () => {
  it("loads immediately when IntersectionObserver is unavailable", () => {
    const { container } = render(<ArtworkImage src="cover.png" alt="Cover" />);
    const img = container.querySelector("img")!;
    // Without an observer to gate on, the image must not be left blank.
    expect(img.getAttribute("src")).toBe("cover.png");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("releases the decoded bitmap after the image leaves the viewport", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { container } = render(
      <ArtworkImage src="cover.png" alt="Cover" unloadDelay={1000} />
    );
    const img = container.querySelector("img")!;
    // Visibility is not known until the observer reports it.
    expect(img.getAttribute("src")).toBeNull();

    const observer = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
    act(() => observer.trigger(true));
    expect(img.getAttribute("src")).toBe("cover.png");

    act(() => observer.trigger(false));
    // Still held during the grace period so scrolling back does not thrash.
    expect(img.getAttribute("src")).toBe("cover.png");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(img.getAttribute("src")).toBeNull();
  });

  it("never unloads when keepLoaded is set", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { container } = render(
      <ArtworkImage src="cover.png" alt="Cover" keepLoaded unloadDelay={1000} />
    );
    const img = container.querySelector("img")!;
    act(() =>
      MockIntersectionObserver.instances[
        MockIntersectionObserver.instances.length - 1
      ].trigger(false)
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(img.getAttribute("src")).toBe("cover.png");
  });
});
