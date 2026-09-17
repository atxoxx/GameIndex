import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmModal } from "./ConfirmModal";

// Capture what the modal registers with the Big Screen focus engine so we
// can assert the controller contract (both buttons reachable, Cancel
// registered first, A activates the focused one).
const { registered, registerAction } = vi.hoisted(() => {
  const registered: { element: HTMLElement; onActivate: () => void }[] = [];
  const registerAction = vi.fn((element: HTMLElement, onActivate: () => void) => {
    registered.push({ element, onActivate });
    return () => {
      const index = registered.findIndex((entry) => entry.element === element);
      if (index >= 0) registered.splice(index, 1);
    };
  });
  return { registered, registerAction };
});

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe("ConfirmModal controller support", () => {
  beforeEach(() => {
    registered.length = 0;
    registerAction.mockClear();
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <ConfirmModal open={false} title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("registers both footer actions, Cancel first", () => {
    render(
      <ConfirmModal open title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    const cancel = screen.getByRole("button", { name: "common.cancel" });
    const confirm = screen.getByRole("button", { name: "common.delete" });

    expect(registered.map((entry) => entry.element)).toEqual([cancel, confirm]);
    // The action row is a rail, so Left/Right cycles the two buttons.
    expect(
      document.querySelector('[data-rail-id="confirm-modal-actions"]'),
    ).not.toBeNull();
  });

  it("starts focus on Cancel, never on the destructive action", async () => {
    render(
      <ConfirmModal open title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.cancel" })).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: "common.delete" })).not.toHaveFocus();
  });

  it("activates Confirm through the focus engine's activate callback", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open title="Delete?" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const entry = registered.find(
      (candidate) =>
        candidate.element === screen.getByRole("button", { name: "common.delete" }),
    );
    expect(entry).toBeDefined();

    // This is the A button: the engine calls onActivate on the focused element.
    entry!.onActivate();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape-to-cancel and mouse clicks working", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmModal open title="Delete?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and disables both actions while busy", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        busy
        title="Delete?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common.delete" })).toBeDisabled();
  });

  it("pulls focus back inside when something behind the backdrop takes it", async () => {
    render(
      <ConfirmModal open title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const cancel = screen.getByRole("button", { name: "common.cancel" });
    const behind = document.createElement("button");
    document.body.appendChild(behind);

    await waitFor(() => expect(cancel).toHaveFocus());

    // Simulates a D-pad press landing on a control behind the modal: the
    // engine would then be able to activate it with A.
    behind.focus();

    await waitFor(() => expect(cancel).toHaveFocus());
    behind.remove();
  });

  it("unregisters the buttons when it closes", () => {
    const { rerender } = render(
      <ConfirmModal open title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(registered).toHaveLength(2);

    rerender(
      <ConfirmModal open={false} title="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(registered).toHaveLength(0);
  });
});
