import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioInspector, type StudioInspectorProps } from "./StudioInspector";
import { STUDIO_HERO_ELEMENT_ICON } from "./studioIcons";
import { WIDGET_ICON } from "./widgetIcons";
import type { OrderListItem } from "./types";

vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));

const noop = () => {};

function pageBlocks(): OrderListItem[] {
  return [
    { id: "hero", label: "Hero banner", icon: WIDGET_ICON.hero, hidden: false },
    { id: "homeQuickStats", label: "Quick stats", icon: WIDGET_ICON.homeQuickStats, hidden: false },
    { id: "homeShelves", label: "Shelves", icon: WIDGET_ICON.homeShelves, hidden: true },
  ];
}

function heroElements(): OrderListItem[] {
  return [
    { id: "background", label: "Backdrop", icon: STUDIO_HERO_ELEMENT_ICON.background, hidden: false },
    { id: "poster", label: "Poster", icon: STUDIO_HERO_ELEMENT_ICON.poster, hidden: false },
  ];
}

function props(overrides: Partial<StudioInspectorProps> = {}): StudioInspectorProps {
  return {
    page: "game",
    scopeLabel: "Game Page",
    navTabItems: [],
    navButtonItems: [],
    showNowPlaying: true,
    onToggleNowPlaying: noop,
    sidebarPosition: "left",
    onSetSidebarPosition: noop,
    sidebarSectionVisible: {},
    onToggleSidebarSection: noop,
    showSmartShelves: true,
    onToggleSmartShelves: noop,
    globalVisibility: {},
    showCardBadges: true,
    onToggleCardBadgesMaster: noop,
    onToggleGlobalItem: noop,
    showHeroTilt: true,
    onToggleHeroTilt: noop,
    showHeroBackdropControls: true,
    onToggleHeroBackdropControls: noop,
    showHeroInteractiveControls: true,
    onToggleHeroInteractiveControls: noop,
    pageItems: pageBlocks(),
    onTogglePageItem: noop,
    onMovePageItem: noop,
    detailTabItems: [],
    onToggleDetailTab: noop,
    onMoveDetailTab: noop,
    heroElementItems: heroElements(),
    onToggleHeroElement: noop,
    onMoveHeroElement: noop,
    detailTopBarItems: [],
    onToggleDetailTopBar: noop,
    onMoveDetailTopBar: noop,
    ...overrides,
  };
}

describe("StudioInspector", () => {
  it("renders one switch and one reorder control per page block", () => {
    render(<StudioInspector {...props()} />);

    expect(screen.getByText("Hero banner")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getAllByLabelText("settings.studio.rowMoveUp")).toHaveLength(3);
  });

  it("marks the first and last block's move button as unavailable", () => {
    render(<StudioInspector {...props()} />);

    const up = screen.getAllByLabelText("settings.studio.rowMoveUp");
    const down = screen.getAllByLabelText("settings.studio.rowMoveDown");
    expect(up[0]).toBeDisabled();
    expect(down[down.length - 1]).toBeDisabled();
    expect(up[1]).toBeEnabled();
  });

  it("reports the block a switch belongs to", () => {
    const onTogglePageItem = vi.fn();
    render(<StudioInspector {...props({ onTogglePageItem })} />);

    screen.getAllByRole("switch")[1].click();
    expect(onTogglePageItem).toHaveBeenCalledWith("homeQuickStats");
  });

  it("keeps an advanced group closed until it is pointed at", () => {
    const { rerender } = render(<StudioInspector {...props()} />);
    expect(screen.queryByText("Poster")).toBeNull();

    rerender(<StudioInspector {...props({ highlightedId: "poster" })} />);
    expect(screen.getByText("Poster")).toBeInTheDocument();
  });

  it("marks a focused row and keeps its group open", () => {
    const { rerender } = render(<StudioInspector {...props({ highlightedId: "poster" })} />);
    expect(document.getElementById("studio-row-poster")).toHaveClass("is-preview-lit");

    // A later rerender that drops the focus must not close the group and hide
    // the row the user was just sent to.
    rerender(<StudioInspector {...props()} />);
    expect(screen.getByText("Poster")).toBeInTheDocument();
  });

  it("shows an empty state for a page with no configurable blocks", () => {
    render(<StudioInspector {...props({ pageItems: [], heroElementItems: [] })} />);
    expect(screen.getByText("settings.studio.inspectorEmpty")).toBeInTheDocument();
  });
});
