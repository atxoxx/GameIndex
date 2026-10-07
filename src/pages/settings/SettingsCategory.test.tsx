import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsCategory from "./SettingsCategory";

describe("SettingsCategory", () => {
  it("reports toggle clicks and reflects the open state on the header", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <SettingsCategory title="Game Stores" open={false} onToggle={onToggle}>
        <p>Steam</p>
      </SettingsCategory>,
    );

    const header = screen.getByRole("button", { name: /Game Stores/ });
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsCategory title="Game Stores" open onToggle={onToggle}>
        <p>Steam</p>
      </SettingsCategory>,
    );
    expect(screen.getByRole("button", { name: /Game Stores/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders the anchor id so deep links can target the category", () => {
    render(
      <SettingsCategory
        id="section-mods"
        title="Nexus Mods"
        open={false}
        onToggle={() => {}}
      >
        <p>Nexus</p>
      </SettingsCategory>,
    );

    expect(document.getElementById("section-mods")).not.toBeNull();
  });
});
