import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SidebarOverflowMenu from "./SidebarOverflowMenu";
import type { SidebarViewOptionsBundle } from "./types";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function viewOptions(): SidebarViewOptionsBundle {
  return {
    groupBy: "none",
    onGroupByChange: vi.fn(),
    sort: "alphabetical",
    onSortChange: vi.fn(),
    sortDirection: "asc",
    onToggleSortDirection: vi.fn(),
    density: "standard",
    onDensityChange: vi.fn(),
    options: {
      groupBy: "none",
      density: "standard",
      showPlaytime: true,
      showPlatformBadge: true,
      showAchievements: true,
      showRatings: true,
    },
    onToggleOption: vi.fn(),
    hasGroups: false,
  };
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof SidebarOverflowMenu>> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const props = {
    anchorEl: anchor,
    onClose,
    onImportExe: vi.fn(),
    onImportFolder: vi.fn(),
    onRandomGame: vi.fn(),
    viewOptions: viewOptions(),
    ...overrides,
  };
  render(<SidebarOverflowMenu {...props} />);
  return { ...props, onClose };
}

describe("SidebarOverflowMenu", () => {
  it("offers import, the random roll and view options", () => {
    renderMenu();

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("sidebar.importGameExe")).toBeInTheDocument();
    expect(screen.getByText("sidebar.importFolder")).toBeInTheDocument();
    expect(screen.getByText("sidebar.randomGame")).toBeInTheDocument();
    expect(screen.getByText("sidebar.viewOptionsTitle")).toBeInTheDocument();
  });

  it("closes itself before running an import action", () => {
    const onImportExe = vi.fn();
    const menu = renderMenu({ onImportExe });

    fireEvent.click(screen.getByText("sidebar.importGameExe"));
    expect(menu.onClose).toHaveBeenCalled();
    expect(onImportExe).toHaveBeenCalledTimes(1);
  });

  it("expands the view options inside the same panel", () => {
    const menu = renderMenu();
    const item = screen.getByText("sidebar.viewOptionsTitle").closest("button")!;

    expect(item.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(item);

    expect(item.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(screen.getByRole("menu")).getByRole("group", {
        name: "sidebar.viewOptionsTitle",
      }),
    ).toBeInTheDocument();
    // The menu stays open, which is the whole point of inline controls.
    expect(menu.onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const menu = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu.onClose).toHaveBeenCalled();
  });
});
