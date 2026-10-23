import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SidebarHeader from "./SidebarHeader";
import type { SidebarHeaderProps } from "./types";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const baseProps: SidebarHeaderProps = {
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

/** Opens the "…" panel and returns it, so queries stay inside the menu. */
function openOverflowMenu() {
  fireEvent.click(screen.getByRole("button", { name: "sidebar.menuTitle" }));
  return screen.getByRole("menu", { name: "sidebar.menuTitle" });
}

describe("SidebarHeader", () => {
  it("shows the library identity and the search row", () => {
    render(<SidebarHeader {...baseProps} />);

    expect(screen.getByText("nav.library")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sidebar.filterGames" })).toBeInTheDocument();
  });

  it("reveals the view options inline, without closing the menu", () => {
    render(<SidebarHeader {...baseProps} />);

    const menu = openOverflowMenu();
    fireEvent.click(within(menu).getByText("sidebar.viewOptionsTitle"));

    expect(
      within(menu).getByRole("group", { name: "sidebar.viewOptionsTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "sidebar.menuTitle" })).toBeInTheDocument();
  });

  it("collapses the inline view options on a second click", () => {
    render(<SidebarHeader {...baseProps} />);

    const menu = openOverflowMenu();
    fireEvent.click(within(menu).getByText("sidebar.viewOptionsTitle"));
    fireEvent.click(within(menu).getByText("sidebar.viewOptionsTitle"));

    expect(
      within(menu).queryByRole("group", { name: "sidebar.viewOptionsTitle" }),
    ).toBeNull();
  });
});
