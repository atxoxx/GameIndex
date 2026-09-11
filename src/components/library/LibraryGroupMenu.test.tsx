import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryGroupMenu from "./LibraryGroupMenu";

const LABELS: Record<string, string> = {
  "library.groupBy.none": "No Grouping",
  "library.groupBy.platform": "Platform",
  "library.groupBy.playStatus": "Play Status",
  "library.groupBy.genre": "Genre",
  "library.groupBy.releaseYear": "Release Year",
  "library.groupBy.alphabetical": "Alphabetical (A–Z)",
  "library.groupBy.label": "Group by:",
};

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => LABELS[key] ?? key }),
}));

function renderMenu(value: "none" | "platform" = "none") {
  const onChange = vi.fn();
  const utils = render(<LibraryGroupMenu value={value} onChange={onChange} />);
  return { ...utils, onChange, trigger: () => utils.container.querySelector(".lib-groupby-trigger") as HTMLElement };
}

describe("LibraryGroupMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("selects a grouping mode and closes the menu", () => {
    const { onChange, trigger } = renderMenu();

    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Platform"));
    expect(onChange).toHaveBeenCalledWith("platform");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("reflects the active mode and flags the trigger as set", () => {
    const { trigger } = renderMenu("platform");

    expect(trigger()).toHaveClass("has-value");
    expect(trigger()).toHaveTextContent("Platform");
  });

  it("closes on Escape and on an outside click without changing the value", () => {
    const { onChange, trigger } = renderMenu();

    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
