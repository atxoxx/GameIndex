import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Segmented } from "./Segmented";

const { registerAction, registered } = vi.hoisted(() => {
  const registered: { element: HTMLElement; onActivate: () => void }[] = [];
  return {
    registered,
    registerAction: (element: HTMLElement, onActivate: () => void) => {
      registered.push({ element, onActivate });
      return () => {
        const i = registered.findIndex((e) => e.element === element);
        if (i >= 0) registered.splice(i, 1);
      };
    },
  };
});

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));

describe("Segmented controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
  });

  it("registers each segmented option for gamepad activation", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        ariaLabel="view"
        value="playtime"
        onChange={onChange}
        options={[
          { value: "playtime", label: "Playtime" },
          { value: "performance", label: "Performance" },
        ]}
      />,
    );

    const performanceButton = screen.getByText("Performance");
    expect(performanceButton.tagName).toBe("BUTTON");
    expect((performanceButton as HTMLButtonElement).tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === performanceButton);
    expect(entry).toBeTruthy();

    entry!.onActivate();
    expect(onChange).toHaveBeenCalledWith("performance");
  });
});
