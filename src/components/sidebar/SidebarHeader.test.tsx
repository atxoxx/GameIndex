import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SidebarHeader from "./SidebarHeader";
import type { SidebarHeaderProps } from "./types";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const baseProps: Omit<
  SidebarHeaderProps,
  "showViewOptionsMenu" | "onOpenViewOptionsMenu" | "onCloseViewOptionsMenu"
> = {
  isIconRail: false,
  onToggleIconRail: () => {},
  gameCount: 12,
  searchQuery: "",
  onSearchChange: () => {},
  onClearSearch: () => {},
  advancedFilterCount: 0,
  showFilterPopover: false,
  onToggleFilterPopover: () => {},
  filterButtonRef: { current: null } as React.RefObject<HTMLButtonElement | null>,
  onImportExe: () => {},
  onImportFolder: () => {},
  onRandomGame: () => {},
  groupBy: "none",
  onGroupByChange: () => {},
  sort: "alphabetical",
  onSortChange: () => {},
  sortDirection: "asc",
  onToggleSortDirection: () => {},
  density: "standard",
  onDensityChange: () => {},
  viewOptions: {
    groupBy: "none",
    density: "standard",
    showPlaytime: true,
    showPlatformBadge: true,
    showAchievements: true,
    showRatings: true,
  },
  onToggleViewOption: () => {},
  hasGroups: false,
};

function Harness() {
  const [showViewOptionsMenu, setShowViewOptionsMenu] = useState(false);
  return (
    <SidebarHeader
      {...baseProps}
      showViewOptionsMenu={showViewOptionsMenu}
      onOpenViewOptionsMenu={() => setShowViewOptionsMenu(true)}
      onCloseViewOptionsMenu={() => setShowViewOptionsMenu(false)}
    />
  );
}

/** Opens the "…" panel and returns it, so queries stay inside the menu. */
function openOverflowMenu() {
  fireEvent.click(screen.getByRole("button", { name: "sidebar.menuTitle" }));
  return screen.getByRole("menu", { name: "sidebar.menuTitle" });
}

describe("SidebarHeader", () => {
  it("opens the view options panel from the overflow menu", () => {
    render(<Harness />);

    const menu = openOverflowMenu();
    fireEvent.click(within(menu).getByText("sidebar.viewOptionsTitle"));

    expect(document.querySelector(".sidebar-view-options-menu")).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "sidebar.menuTitle" })).toBeNull();
  });

  it("still shows the panel when the action is used again", () => {
    render(<Harness />);

    fireEvent.click(
      within(openOverflowMenu()).getByText("sidebar.viewOptionsTitle"),
    );
    fireEvent.click(
      within(openOverflowMenu()).getByText("sidebar.viewOptionsTitle"),
    );

    expect(document.querySelector(".sidebar-view-options-menu")).toBeInTheDocument();
  });
});
