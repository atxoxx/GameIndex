import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  // Mirror the real hook's contract closely enough that a click works like
  // the A button: activation is the registered callback.
  useGamepad: () => ({
    registerAction: (el: HTMLElement, onActivate: () => void) => {
      el.addEventListener("click", onActivate);
      return () => el.removeEventListener("click", onActivate);
    },
  }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

type Tab = "overview" | "media" | "specs";

const TABS: TabDef<Tab>[] = [
  { id: "overview", label: "Overview" },
  { id: "media", label: "Media" },
  { id: "specs", label: "Specs" },
];

function TabBarHarness({
  activeTab = "overview",
  onActivate = () => {},
  onEnterContent,
}: {
  activeTab?: Tab;
  onActivate?: (id: Tab) => void;
  onEnterContent?: (id: Tab) => void;
}) {
  return (
    <BigScreenTabBar
      tabs={TABS}
      activeTab={activeTab}
      onActivate={onActivate}
      onEnterContent={onEnterContent}
      railId="game-hub-tabs"
      ariaLabel="tabs"
    />
  );
}

describe("BigScreenTabBar focus contract", () => {
  it("selects a tab and hands focus to its body on activation (A / click)", () => {
    const onActivate = vi.fn();
    const onEnterContent = vi.fn();
    render(<TabBarHarness onActivate={onActivate} onEnterContent={onEnterContent} />);

    fireEvent.click(screen.getByRole("tab", { name: "Media" }));

    expect(onActivate).toHaveBeenCalledWith("media");
    expect(onEnterContent).toHaveBeenCalledWith("media");
  });

  it("only selects when a bumper changes the active tab — focus stays on the strip", () => {
    const onActivate = vi.fn();
    const onEnterContent = vi.fn();
    const { rerender } = render(
      <TabBarHarness onActivate={onActivate} onEnterContent={onEnterContent} />,
    );

    // LB/RB is owned by the page's tab cycler; all this bar sees is the
    // resulting activeTab prop change.
    rerender(
      <TabBarHarness
        activeTab="specs"
        onActivate={onActivate}
        onEnterContent={onEnterContent}
      />,
    );

    expect(onActivate).not.toHaveBeenCalled();
    expect(onEnterContent).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Specs" })).toHaveFocus();
  });

  it("exposes the strip as a spatial rail", () => {
    const { container } = render(<TabBarHarness />);
    expect(
      container.querySelector('[data-rail-id="game-hub-tabs"]'),
    ).not.toBeNull();
  });

  it("omits the rail attribute when no rail id is given", () => {
    const { container } = render(
      <BigScreenTabBar tabs={TABS} activeTab="overview" onActivate={() => {}} />,
    );
    expect(container.querySelector("[data-rail-id]")).toBeNull();
  });

  it("exposes an optional count as part of the tab's label", () => {
    render(
      <BigScreenTabBar
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "achievements", label: "Achievements", count: 7 },
        ]}
        activeTab="overview"
        onActivate={() => {}}
      />,
    );
    // Screen readers hear the count too — it is real information, not
    // decoration, so it is part of the tab's content.
    const tab = screen.getByRole("tab", { name: /Achievements/ });
    expect(tab).toHaveTextContent("7");
  });
});
