import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CommandPaletteItemRow from "./CommandPaletteItemRow";
import type { PaletteItem } from "./commandPaletteTypes";

function item(overrides: Partial<PaletteItem> = {}): PaletteItem {
  return {
    id: "item-1",
    category: "games",
    title: "Elden Ring",
    subtitle: "PC · 96h",
    onSelect: vi.fn(),
    ...overrides,
  } as PaletteItem;
}

function renderRow(overrides: Partial<React.ComponentProps<typeof CommandPaletteItemRow>> = {}) {
  return render(
    <CommandPaletteItemRow
      item={item()}
      isSelected={false}
      cleanQuery=""
      optionId="opt-1"
      onSelect={() => {}}
      onMouseEnter={() => {}}
      {...overrides}
    />,
  );
}

describe("CommandPaletteItemRow", () => {
  it("renders the title, subtitle and badges on one line", () => {
    const { container } = renderRow({
      item: item({ badge: "Running", badgeType: "success" }),
    });

    const body = container.querySelector(".command-palette-item-body");
    expect(body).toBeInTheDocument();
    expect(body?.querySelector(".command-palette-item-title")?.textContent).toBe("Elden Ring");
    expect(body?.querySelector(".command-palette-item-subtitle")?.textContent).toBe("PC · 96h");
    expect(body?.querySelector(".command-palette-badge")?.textContent).toContain("Running");
    // The compact layout has no separate title row block.
    expect(container.querySelector(".cmd-item-title-row")).toBeNull();
  });

  it("marks the selected row and exposes its action hint", () => {
    const { container } = renderRow({
      isSelected: true,
      item: item({ actionText: "Launch", shortcut: "↵" }),
    });

    const row = container.querySelector(".command-palette-item");
    expect(row?.className).toContain("is-selected");
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("↵")).toBeInTheDocument();
  });

  it("highlights the matched query", () => {
    const { container } = renderRow({ cleanQuery: "elden" });
    expect(container.querySelector("mark.cmd-match-highlight")?.textContent).toBe("Elden");
  });
});
