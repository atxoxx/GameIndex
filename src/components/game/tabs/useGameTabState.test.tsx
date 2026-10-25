import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useGameTabState } from "./useGameTabState";

function Probe() {
  const [state, setState] = useGameTabState({
    prefix: "dlc",
    defaults: { view: "gallery", filter: "all" },
    allowed: {
      view: ["gallery", "table"],
      filter: ["all", "owned"],
    },
  });
  const location = useLocation();

  return (
    <div>
      <span data-testid="state">{`${state.view}|${state.filter}`}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => setState({ view: "table" })}>
        table
      </button>
      <button type="button" onClick={() => setState({ filter: "owned" })}>
        owned
      </button>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  );
}

describe("useGameTabState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads and validates URL state", async () => {
    renderAt("/game?dlcView=table&dlcFilter=owned");
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("table|owned"),
    );
  });

  it("falls back to the default for unknown URL values", async () => {
    renderAt("/game?dlcView=broken");
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("gallery|all"),
    );
  });

  it("seeds from localStorage and mirrors changes into the URL", async () => {
    localStorage.setItem(
      "gamelib.gameTab.dlc",
      JSON.stringify({ view: "table", filter: "owned" }),
    );
    renderAt("/game");

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("table|owned"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("search").textContent).toContain("dlcView=table"),
    );

    fireEvent.click(screen.getByRole("button", { name: "table" }));
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("table|owned"),
    );
    expect(screen.getByTestId("search").textContent).toContain("dlcFilter=owned");
  });
});
