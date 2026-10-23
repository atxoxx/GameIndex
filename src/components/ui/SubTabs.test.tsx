import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubTabs } from "./SubTabs";

const scrollToMock = vi.fn();

beforeAll(() => {
  Element.prototype.scrollTo = scrollToMock;
});

afterEach(() => {
  cleanup();
  scrollToMock.mockClear();
  vi.restoreAllMocks();
});

const ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "media", label: "Media" },
  { id: "specs", label: "Specs" },
];

/** jsdom rects are all-zero; the stuck detector only reads `top`. */
function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 10,
    left: 0,
    right: 100,
    width: 100,
    height: 10,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("SubTabs", () => {
  it("marks the active tab and moves with the arrow keys", () => {
    const onChange = vi.fn();
    render(
      <SubTabs
        items={ITEMS}
        value="overview"
        onChange={onChange}
        ariaLabel="Detail sections"
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("media");
  });

  it("marks a sticky strip stuck against its scrollport edge, not the viewport", async () => {
    const { container } = render(
      <div style={{ overflowY: "auto" }}>
        <SubTabs sticky items={ITEMS} value="overview" onChange={() => {}} ariaLabel="Scrolled sections" />
      </div>,
    );

    const scroller = container.firstElementChild as HTMLElement;
    const nav = container.querySelector("nav") as HTMLElement;
    // The scroll container starts 60px down (below the top nav); the strip's
    // CSS top offset resolves to 0 in jsdom, so "stuck" means rect.top <= 60.
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(60));

    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(rect(240));
    fireEvent.scroll(scroller);
    await waitFor(() => expect(nav.className).not.toContain("is-stuck"));

    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(rect(60));
    fireEvent.scroll(scroller);
    await waitFor(() => expect(nav.className).toContain("is-stuck"));
  });

  it("renders an empty strip without throwing when there are no tabs", () => {
    render(
      <SubTabs items={[]} value="overview" onChange={() => {}} ariaLabel="Empty" />,
    );

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});
