import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShelfProvider, useShelves } from "./ShelfContext";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string) => [] as unknown),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./GameContext", () => ({ useGames: () => ({ games: [] }) }));

/** localStorage key holding the Smart Shelves master switch. */
const ENABLED_KEY = "gamelib.smart_shelves_enabled";

function Probe() {
  const { enabled, setEnabled, activeShelfId, setActiveShelf, loading } = useShelves();
  return (
    <div>
      <span data-testid="enabled">{String(enabled)}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="active">{activeShelfId ?? "none"}</span>
      <button onClick={() => setEnabled(true)}>on</button>
      <button onClick={() => setEnabled(false)}>off</button>
      <button onClick={() => setActiveShelf("s1")}>apply</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ShelfProvider>
      <Probe />
    </ShelfProvider>
  );
}

async function waitReady() {
  await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
}

describe("ShelfProvider — Smart Shelves master switch", () => {
  beforeEach(() => {
    localStorage.clear();
    // Skip starter seeding so hydration stays deterministic.
    localStorage.setItem("gameindex:shelves-seeded-v1", "1");
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to enabled and persists both toggles (happy path)", async () => {
    renderProvider();
    await waitReady();
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");

    fireEvent.click(screen.getByText("off"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    expect(localStorage.getItem(ENABLED_KEY)).toBe("false");

    fireEvent.click(screen.getByText("on"));
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");
    expect(localStorage.getItem(ENABLED_KEY)).toBe("true");
  });

  it("clears the active shelf when switched off", async () => {
    renderProvider();
    await waitReady();

    fireEvent.click(screen.getByText("apply"));
    expect(screen.getByTestId("active")).toHaveTextContent("s1");

    fireEvent.click(screen.getByText("off"));
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });

  it("restores a persisted off state on mount (happy path)", async () => {
    localStorage.setItem(ENABLED_KEY, "false");
    renderProvider();
    await waitReady();
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });

  it("degrades to enabled when localStorage is unavailable (error path)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderProvider();
    await waitReady();
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");
  });
});
