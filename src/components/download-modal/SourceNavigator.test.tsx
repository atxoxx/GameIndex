import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceNavigator } from "./SourceNavigator";
import type { SourceNavEntry } from "./sourceNavigation";

const entries: SourceNavEntry[] = [
  { id: "all", label: "All Sources", count: 12, provider: "all" },
  { id: "fitgirl", label: "FitGirl", count: 5, provider: "source" },
  { id: "plugin", label: "Plugins", count: 7, provider: "plugin" },
];

describe("SourceNavigator", () => {
  it("hides the rail when there is only the aggregate entry", () => {
    const { container } = render(
      <SourceNavigator
        entries={[entries[0]]}
        activeSource="all"
        onSelect={() => {}}
        totalCount={12}
        ariaLabel="Source navigation"
      />,
    );

    expect(container.querySelector(".dlm-sources")).toBeNull();
  });

  it("renders the aggregate count plus every source count", () => {
    render(
      <SourceNavigator
        entries={entries}
        activeSource="all"
        onSelect={() => {}}
        totalCount={12}
        ariaLabel="Source navigation"
      />,
    );

    expect(screen.getByRole("group", { name: "Source navigation" })).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent("All Sources");
    expect(buttons[1]).toHaveTextContent("FitGirl");
    expect(buttons[1]).toHaveTextContent("5");
  });

  it("marks the active source and forwards selections", () => {
    const onSelect = vi.fn();
    render(
      <SourceNavigator
        entries={entries}
        activeSource="fitgirl"
        onSelect={onSelect}
        totalCount={12}
        ariaLabel="Source navigation"
      />,
    );

    const active = screen.getByRole("button", { name: /FitGirl/ });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /All Sources/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: /Plugins/ }));
    expect(onSelect).toHaveBeenCalledWith("plugin");
  });

  it("gives the grouped plugin bucket a distinct class and glyph", () => {
    const { container } = render(
      <SourceNavigator
        entries={entries}
        activeSource="all"
        onSelect={() => {}}
        totalCount={12}
        ariaLabel="Source navigation"
      />,
    );

    expect(container.querySelector(".dlm-sources-tab.is-plugin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /FitGirl/ })).toHaveTextContent("FI");
  });
});
