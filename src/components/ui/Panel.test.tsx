import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Panel } from "./Panel";

afterEach(cleanup);

describe("Panel", () => {
  it("renders a heading, icon and action slot", () => {
    render(
      <Panel
        heading="About"
        icon={<svg data-testid="panel-icon" />}
        actions={<button type="button">Edit</button>}
      >
        <p>Body copy</p>
      </Panel>,
    );

    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.getByTestId("panel-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Body copy")).toBeInTheDocument();
  });

  it("omits the header row for a bare surface", () => {
    const { container } = render(<Panel>Just content</Panel>);

    expect(container.querySelector(".ui-panel__header")).toBeNull();
    expect(container.querySelector(".ui-panel__body")).not.toBeNull();
  });
});
