import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MediaFetchBrowser } from "./MediaFetchBrowser";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
  convertFileSrc: (p: string) => p,
}));

const invokeMock = vi.mocked(invoke);

describe("MediaFetchBrowser title search", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sgdb_get_all_assets") return Promise.resolve(null);
      return Promise.resolve([]);
    });
  });

  it("prefills the search box with the game name", async () => {
    render(
      <MediaFetchBrowser
        slot="cover"
        gameName="Halo: Combat Evolved"
        steamAppId={123}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByLabelText("Search game title") as HTMLInputElement;
    expect(input.value).toBe("Halo: Combat Evolved");
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    // Let the initial auto-search settle so no state update escapes the test.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "search_game_metadata",
        expect.objectContaining({ gameName: "Halo: Combat Evolved" })
      )
    );
  });

  it("re-searches with the edited title and drops the game's Steam AppID", async () => {
    render(
      <MediaFetchBrowser
        slot="icon"
        gameName="Halo"
        steamAppId={123}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByLabelText("Search game title");
    fireEvent.change(input, { target: { value: "  Halo 3  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "search_game_metadata",
        expect.objectContaining({
          gameName: "Halo 3",
          steamAppId: undefined,
        })
      )
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("search_launchbox_images", {
        gameName: "Halo 3",
      })
    );
  });

  it("keeps the game's Steam AppID when the title is unchanged", async () => {
    render(
      <MediaFetchBrowser
        slot="logo"
        gameName="Halo"
        steamAppId={123}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "search_game_metadata",
        expect.objectContaining({ gameName: "Halo", steamAppId: 123 })
      )
    );
  });
});

describe("MediaFetchBrowser SteamGridDB suggestions", () => {
  const gamma = {
    id: 5518013,
    name: "S.T.A.L.K.E.R.: GAMMA",
    releaseDate: 1638576000,
    verified: true,
  };

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sgdb_search_games") return Promise.resolve([gamma]);
      if (cmd === "sgdb_get_all_assets") return Promise.resolve(null);
      return Promise.resolve([]);
    });
  });

  async function typeTitle(title: string) {
    const input = screen.getByLabelText("Search game title");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: title } });
    return input;
  }

  it("offers matching games for the typed title", async () => {
    render(
      <MediaFetchBrowser slot="cover" gameName="GAMMA" onApply={vi.fn()} onClose={vi.fn()} />
    );

    await typeTitle("S.T.A.L.K.E.R.: GAMMA");

    expect(await screen.findByRole("option", { name: /GAMMA/ })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("sgdb_search_games", {
      query: "S.T.A.L.K.E.R.: GAMMA",
    });
  });

  it("loads the picked entry's gallery by its SteamGridDB id", async () => {
    render(
      <MediaFetchBrowser slot="cover" gameName="GAMMA" onApply={vi.fn()} onClose={vi.fn()} />
    );

    await typeTitle("S.T.A.L.K.E.R.: GAMMA");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /GAMMA/ }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("sgdb_get_all_assets", {
        steamAppId: null,
        gameName: "S.T.A.L.K.E.R.: GAMMA",
        sgdbGameId: 5518013,
      })
    );
  });

  it("picks the highlighted entry with the keyboard", async () => {
    render(
      <MediaFetchBrowser slot="cover" gameName="GAMMA" onApply={vi.fn()} onClose={vi.fn()} />
    );

    const input = await typeTitle("S.T.A.L.K.E.R.: GAMMA");
    await screen.findByRole("option", { name: /GAMMA/ });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "sgdb_get_all_assets",
        expect.objectContaining({ sgdbGameId: 5518013 })
      )
    );
  });

  it("drops the picked entry once the title is edited again", async () => {
    render(
      <MediaFetchBrowser slot="cover" gameName="GAMMA" onApply={vi.fn()} onClose={vi.fn()} />
    );

    const input = await typeTitle("S.T.A.L.K.E.R.: GAMMA");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /GAMMA/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "sgdb_get_all_assets",
        expect.objectContaining({ sgdbGameId: 5518013 })
      )
    );

    invokeMock.mockClear();
    fireEvent.change(input, { target: { value: "S.T.A.L.K.E.R.: Anomaly" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "sgdb_get_all_assets",
        expect.objectContaining({ gameName: "S.T.A.L.K.E.R.: Anomaly", sgdbGameId: null })
      )
    );
  });
});
