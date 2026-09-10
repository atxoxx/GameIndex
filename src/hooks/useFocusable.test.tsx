import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFocusable } from "./useFocusable";

const { registerAction } = vi.hoisted(() => ({
  registerAction: vi.fn((el: HTMLElement, onActivate: () => void) => {
    el.addEventListener("click", onActivate);
    return () => el.removeEventListener("click", onActivate);
  }),
}));

vi.mock("./GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));

function Card({ onActivate }: { onActivate: () => void }) {
  const focusable = useFocusable(onActivate);
  return (
    <div data-testid="card" {...focusable}>
      Card
    </div>
  );
}

function NativeButton({ onActivate }: { onActivate: () => void }) {
  const focusable = useFocusable(onActivate);
  return (
    <button type="button" data-testid="native" {...focusable}>
      Native
    </button>
  );
}

describe("useFocusable keyboard activation", () => {
  it("activates a non-native focusable with Enter and Space", () => {
    const onActivate = vi.fn();
    render(<Card onActivate={onActivate} />);
    const card = screen.getByTestId("card");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated keys", () => {
    const onActivate = vi.fn();
    render(<Card onActivate={onActivate} />);
    fireEvent.keyDown(screen.getByTestId("card"), { key: "ArrowRight" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("stands down for native buttons so Enter can't double-fire", () => {
    const onActivate = vi.fn();
    render(<NativeButton onActivate={onActivate} />);
    fireEvent.keyDown(screen.getByTestId("native"), { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });
});
