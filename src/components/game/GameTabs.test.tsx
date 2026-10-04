import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import GameTabs, { type GameTabItem } from "./GameTabs";

// jsdom implements neither method, and GameTabs now owns `scrollTo` for the
// tab strip while deliberately avoiding `scrollIntoView` (which would also
// scroll `.app-main`). Installing both lets a test assert which one runs.
const scrollIntoViewMock = vi.fn();
const scrollToMock = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  Element.prototype.scrollTo = scrollToMock;
});

afterEach(() => {
  cleanup();
  scrollIntoViewMock.mockClear();
  scrollToMock.mockClear();
});

const TABS: GameTabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "reviews", label: "Reviews" },
];

describe("GameTabs scroll behaviour", () => {
  it("never scrolls ancestor containers when async tab data lands", () => {
    const { rerender } = render(
      <GameTabs tabs={TABS} activeTab="overview" onChange={() => {}} />,
    );
    scrollIntoViewMock.mockClear();
    scrollToMock.mockClear();

    // Async counts (achievements, notes, map status) resolve → `tabs` gets a
    // new identity and the effect re-runs after the user may have scrolled.
    rerender(
      <GameTabs
        tabs={[...TABS, { id: "dlc", label: "DLC" }]}
        activeTab="overview"
        onChange={() => {}}
      />,
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalled();
  });

  it("centers the newly active tab on the strip itself", () => {
    const { rerender } = render(
      <GameTabs tabs={TABS} activeTab="overview" onChange={() => {}} />,
    );
    scrollIntoViewMock.mockClear();
    scrollToMock.mockClear();

    rerender(<GameTabs tabs={TABS} activeTab="reviews" onChange={() => {}} />);

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
