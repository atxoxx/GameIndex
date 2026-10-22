import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatBand } from "./StatBand";

afterEach(cleanup);

describe("StatBand", () => {
  it("renders every metric with its label and figure", () => {
    render(
      <StatBand
        ariaLabel="Game overview"
        items={[
          { id: "score", label: "Reception", value: 87 },
          { id: "playtime", label: "Playtime", value: "42h", detail: "Story" },
        ]}
      />,
    );

    expect(screen.getByRole("group", { name: "Game overview" })).toBeInTheDocument();
    expect(screen.getByText("Reception")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.getByText("42h")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
  });

  it("renders nothing when there is no data to show", () => {
    const { container } = render(<StatBand ariaLabel="Empty" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a figure with its caption-sized unit", () => {
    render(
      <StatBand
        ariaLabel="Game overview"
        items={[{ id: "size", label: "Storage", value: "50.5", unit: "GiB" }]}
      />,
    );

    expect(screen.getByText("50.5")).toBeInTheDocument();
    expect(screen.getByText("GiB")).toHaveClass("ui-statband__unit");
  });

  it("turns a metric with an action into a button", () => {
    const onClick = vi.fn();
    render(
      <StatBand
        ariaLabel="Game overview"
        items={[{ id: "cost", label: "Value", value: "Set cost", onClick }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set cost/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
