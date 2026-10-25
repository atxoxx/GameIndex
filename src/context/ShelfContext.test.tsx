import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShelfProvider, useShelves } from "./ShelfContext";
import type { Shelf } from "../types/shelf";

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

describe("ShelfProvider — active shelf persistence", () => {
  const aShelf: Shelf = {
    id: "s1",
    name: "S1",
    icon: "layers",
    color: "accent",
    rules: {},
    sort: "alphabetical",
    pinned: false,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("gameindex:shelves-seeded-v1", "1");
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a persisted active shelf that still exists (happy path)", async () => {
    invokeMock.mockResolvedValueOnce([aShelf]);
    localStorage.setItem("gameindex:active-shelf:v1", "s1");
    renderProvider();
    await waitReady();
    expect(screen.getByTestId("active")).toHaveTextContent("s1");
  });

  it("does not restore a persisted shelf that was deleted (error path)", async () => {
    invokeMock.mockResolvedValueOnce([]);
    localStorage.setItem("gameindex:active-shelf:v1", "s1");
    renderProvider();
    await waitReady();
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });

  it("persists the active shelf when applied (happy path)", async () => {
    invokeMock.mockResolvedValueOnce([aShelf]);
    renderProvider();
    await waitReady();
    fireEvent.click(screen.getByText("apply"));
    expect(screen.getByTestId("active")).toHaveTextContent("s1");
    expect(localStorage.getItem("gameindex:active-shelf:v1")).toBe("s1");
  });
});

describe("ShelfProvider - hydration", () => {
  const SEEDED_KEY = "gameindex:shelves-seeded-v1";

  const storedShelf: Shelf = {
    id: "s1",
    name: "Backlog",
    icon: "layers",
    color: "accent",
    rules: {},
    sort: "alphabetical",
    pinned: false,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  function ShelfCountProbe() {
    const { shelves, loading } = useShelves();
    return (
      <div>
        <span data-testid="loading">{String(loading)}</span>
        <span data-testid="shelf-count">{shelves.length}</span>
      </div>
    );
  }

  function renderIn(ui: ReactNode) {
    return render(ui);
  }

  /** Commands issued by hydration, in call order. */
  function invokedCommands(): string[] {
    return invokeMock.mock.calls.map(([cmd]) => String(cmd));
  }

  async function waitLoaded() {
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SEEDED_KEY, "1");
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("loads stored shelves under StrictMode's remounted effects (happy path)", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "shelves_list" ? [storedShelf] : []
    );

    renderIn(
      <StrictMode>
        <ShelfProvider>
          <ShelfCountProbe />
        </ShelfProvider>
      </StrictMode>
    );

    await waitLoaded();
    expect(screen.getByTestId("shelf-count")).toHaveTextContent("1");
    // One shared read, not one per StrictMode effect run.
    expect(invokedCommands().filter((cmd) => cmd === "shelves_list")).toHaveLength(1);
  });

  it("never seeds over a failed list read (error path)", async () => {
    localStorage.removeItem(SEEDED_KEY);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "shelves_list") throw new Error("shelves pool unavailable");
      return [];
    });

    renderIn(
      <ShelfProvider>
        <ShelfCountProbe />
      </ShelfProvider>
    );

    await waitLoaded();
    expect(screen.getByTestId("shelf-count")).toHaveTextContent("0");
    expect(invokedCommands()).not.toContain("shelves_save");
    // A retry on the next launch must still be possible.
    expect(localStorage.getItem(SEEDED_KEY)).toBeNull();
  });

  it("retries a transient list failure while the app starts (error path)", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    let listCalls = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd !== "shelves_list") return [];
      listCalls += 1;
      if (listCalls === 1) throw new Error("database is locked");
      return [storedShelf];
    });

    renderIn(
      <ShelfProvider>
        <ShelfCountProbe />
      </ShelfProvider>
    );

    await waitLoaded();
    expect(screen.getByTestId("shelf-count")).toHaveTextContent("1");
    expect(listCalls).toBe(2);
  });

  it("seeds the starter set on a first run and records it (happy path)", async () => {
    localStorage.removeItem(SEEDED_KEY);
    let saved = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { shelf: Shelf }) => {
      if (cmd === "shelves_list") return [];
      if (cmd === "shelves_save" && args) {
        saved += 1;
        return { ...args.shelf, id: `shelf-${saved}` };
      }
      return [];
    });

    renderIn(
      <ShelfProvider>
        <ShelfCountProbe />
      </ShelfProvider>
    );

    await waitLoaded();
    expect(saved).toBeGreaterThan(0);
    expect(screen.getByTestId("shelf-count")).toHaveTextContent(String(saved));
    expect(localStorage.getItem(SEEDED_KEY)).toBe("1");
  });

  it("leaves the seed flag unset when saving a starter shelf fails (error path)", async () => {
    localStorage.removeItem(SEEDED_KEY);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "shelves_list") return [];
      if (cmd === "shelves_save") throw new Error("disk full");
      return [];
    });

    renderIn(
      <ShelfProvider>
        <ShelfCountProbe />
      </ShelfProvider>
    );

    await waitLoaded();
    expect(screen.getByTestId("shelf-count")).toHaveTextContent("0");
    expect(localStorage.getItem(SEEDED_KEY)).toBeNull();
  });
});

