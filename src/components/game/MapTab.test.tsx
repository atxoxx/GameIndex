import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MapTab from "./MapTab";
import type { MapSourceResult } from "../../types/game";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/webview", () => ({
  Webview: {
    getAll: vi.fn().mockResolvedValue([]),
    getByLabel: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {},
  LogicalSize: class LogicalSize {},
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useWebviewContentFilterEnabled: () => true,
}));

const initialSource: MapSourceResult = {
  id: "wand",
  label: "Wand",
  title: "Old Match",
  url: "https://wand.com/maps/old-match",
  maps: [{ title: "Old Match", url: "https://wand.com/maps/old-match" }],
};

const searchedSource: MapSourceResult = {
  id: "wand",
  label: "Wand",
  title: "STALKER 2: Heart of Chornobyl",
  url: "https://wand.com/maps/stalker-2-heart-of-chornobyl",
  maps: [
    {
      title: "STALKER 2: Heart of Chornobyl",
      url: "https://wand.com/maps/stalker-2-heart-of-chornobyl",
    },
  ],
};

function openSearch() {
  fireEvent.click(screen.getByLabelText("map.searchOpen"));
}

function submitSearch(value: string) {
  openSearch();
  const input = screen.getByLabelText("map.searchPlaceholder");
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

describe("MapTab lookup search", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("re-runs the provider lookup for a manually searched name", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_game_maps") return [searchedSource];
      return undefined;
    });

    render(<MapTab sources={[initialSource]} gameName="Old Name" />);
    expect(screen.getByText("Old Match")).toBeTruthy();
    expect(screen.queryByLabelText("map.searchPlaceholder")).toBeNull();

    submitSearch("STALKER");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", { gameName: "STALKER" })
    );
    expect(await screen.findByText("STALKER 2: Heart of Chornobyl")).toBeTruthy();
    expect(screen.queryByText("Old Match")).toBeNull();
  });

  it("runs a lookup from a suggestion", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "search_map_games") return ["STALKER 2: Heart of Chornobyl"];
      if (cmd === "fetch_game_maps") return [searchedSource];
      return undefined;
    });

    render(<MapTab sources={[initialSource]} gameName="Old Name" />);
    openSearch();
    const input = screen.getByLabelText("map.searchPlaceholder");
    fireEvent.change(input, { target: { value: "stalk" } });

    const option = await screen.findByRole("option", {
      name: "STALKER 2: Heart of Chornobyl",
    });
    fireEvent.click(option);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", {
        gameName: "STALKER 2: Heart of Chornobyl",
      })
    );
  });

  it("remembers the searched game across remounts", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_game_maps") return [searchedSource];
      return undefined;
    });

    const first = render(
      <MapTab sources={[initialSource]} gameName="Old Name" searchKey="game-1" />
    );
    submitSearch("STALKER");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", { gameName: "STALKER" })
    );
    first.unmount();

    invokeMock.mockClear();
    render(<MapTab sources={[initialSource]} gameName="Old Name" searchKey="game-1" />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", { gameName: "STALKER" })
    );
    expect(await screen.findByText("STALKER 2: Heart of Chornobyl")).toBeTruthy();
  });

  it("restores a saved search even when it matches the game name", async () => {
    localStorage.setItem("gamelib.map_lookup.game-1", "Old Name");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_game_maps") return [searchedSource];
      return undefined;
    });

    // No automatic match: only the saved manual lookup can provide a map.
    render(<MapTab sources={[]} gameName="Old Name" searchKey="game-1" />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", { gameName: "Old Name" })
    );
    expect(await screen.findByText("STALKER 2: Heart of Chornobyl")).toBeTruthy();
  });

  it("shows an error state when the lookup fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_game_maps") throw new Error("offline");
      return undefined;
    });

    render(<MapTab sources={[initialSource]} gameName="Old Name" />);
    submitSearch("Something Obscure");

    const messages = await screen.findAllByText("map.searchError");
    expect(messages.length).toBeGreaterThan(0);
  });

  it("shows a no-results state when no provider matches", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_game_maps") return [];
      return undefined;
    });

    render(<MapTab sources={[initialSource]} gameName="Old Name" />);
    submitSearch("Something Obscure");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", {
        gameName: "Something Obscure",
      })
    );
    expect(
      (await screen.findAllByText("map.noResults")).length
    ).toBeGreaterThan(0);
  });
});
