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
