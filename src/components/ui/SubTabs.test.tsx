import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SubTabs } from "./SubTabs";

const scrollToMock = vi.fn();

beforeAll(() => {
  Element.prototype.scrollTo = scrollToMock;
});

afterEach(() => {
  cleanup();
  scrollToMock.mockClear();
});

const ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "media", label: "Media" },
  { id: "specs", label: "Specs" },
];

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

  it("renders an empty strip without throwing when there are no tabs", () => {
    render(
      <SubTabs items={[]} value="overview" onChange={() => {}} ariaLabel="Empty" />,
    );

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});
