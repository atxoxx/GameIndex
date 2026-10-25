import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dices } from "lucide-react";
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
  it("renders the title, badge and subtitle on one line", () => {
    const { container } = renderRow({
      item: item({ badge: "Running", badgeType: "success" }),
    });

    expect(container.querySelector(".cp-row-title")?.textContent).toBe("Elden Ring");
    expect(container.querySelector(".cp-row-sub")?.textContent).toBe("PC · 96h");
    expect(container.querySelector(".cp-badge")?.textContent).toContain("Running");
    expect(container.querySelector(".cp-row-text")).toBeInTheDocument();
  });

  it("marks the selected row and exposes its action hint", () => {
    const { container } = renderRow({
      isSelected: true,
      item: item({ actionText: "Launch", shortcut: "↵" }),
    });

    const row = container.querySelector(".cp-row");
    expect(row?.className).toContain("is-selected");
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("↵")).toBeInTheDocument();
  });

  it("only renders quick actions for the selected row", () => {
    const onClick = vi.fn();
    const quickActions = [
      { id: "roll", icon: <Dices size={12} />, title: "Roll", onClick },
    ];

    const { container, rerender } = renderRow({ item: item({ quickActions }) });
    expect(container.querySelectorAll(".cp-row-action")).toHaveLength(0);

    rerender(
      <CommandPaletteItemRow
        item={item({ quickActions })}
        isSelected
        cleanQuery=""
        optionId="opt-1"
        onSelect={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    const action = container.querySelector<HTMLButtonElement>(".cp-row-action");
    expect(action).not.toBeNull();
    action?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("highlights the matched query", () => {
    const { container } = renderRow({ cleanQuery: "elden" });
    expect(container.querySelector("mark.cp-match")?.textContent).toBe("Elden");
  });
});
