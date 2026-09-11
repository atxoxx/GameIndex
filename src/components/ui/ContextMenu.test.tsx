import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

function makeItems(overrides: { first?: () => void; sub?: () => void } = {}): ContextMenuItem[] {
  return [
    { id: "first", label: "First Action", onSelect: overrides.first ?? vi.fn() },
    { id: "disabled", label: "Disabled Action", disabled: true, onSelect: vi.fn() },
    { id: "sep", separator: true },
    {
      id: "more",
      label: "More",
      submenu: [
        { id: "sub-one", label: "Sub One", onSelect: overrides.sub ?? vi.fn() },
        { id: "sub-two", label: "Sub Two", onSelect: vi.fn() },
      ],
    },
  ];
}

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()) {
  render(<ContextMenu x={20} y={20} items={items} onClose={onClose} ariaLabel="Test menu" />);
  return { onClose };
}

function menuItem(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[role="menuitem"]');
  if (!el) throw new Error(`No menuitem found for "${label}"`);
  return el as HTMLElement;
}

describe("ContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches the selected item action", () => {
    const onSelect = vi.fn();
    renderMenu(makeItems({ first: onSelect }));

    fireEvent.click(menuItem("First Action"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("opens a submenu and dispatches its entry", async () => {
    const onSubSelect = vi.fn();
    renderMenu(makeItems({ sub: onSubSelect }));

    fireEvent.click(menuItem("More"));
    fireEvent.click(await screen.findByText("Sub One"));
    expect(onSubSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on disabled items and closes on Escape", () => {
    const onSelect = vi.fn();
    const items = makeItems();
    items[1] = { id: "disabled", label: "Disabled Action", disabled: true, onSelect };
    const { onClose } = renderMenu(items);

    const disabled = menuItem("Disabled Action");
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside pointer down but not on an inside one", () => {
    const { onClose } = renderMenu(makeItems());

    fireEvent.mouseDown(menuItem("First Action"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
