import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SidebarOverflowMenu from "./SidebarOverflowMenu";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

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
    onOpenViewOptions: vi.fn(),
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

  it("closes itself before running an action", () => {
    const onImportExe = vi.fn();
    const menu = renderMenu({ onImportExe });

    fireEvent.click(screen.getByText("sidebar.importGameExe"));
    expect(menu.onClose).toHaveBeenCalled();
    expect(onImportExe).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const menu = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu.onClose).toHaveBeenCalled();
  });
});
