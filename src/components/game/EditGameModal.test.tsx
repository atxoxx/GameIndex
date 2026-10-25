import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { EditGameModal } from "./EditGameModal";
import type { Game } from "../../types/game";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
const { openMock } = vi.hoisted(() => ({
  openMock: vi.fn(() => Promise.resolve(null as string | null)),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

const gameState = vi.hoisted(() => ({ detailLoaded: true }));
const settingsState = vi.hoisted(() => ({
  showFullLinuxUi: true,
  isWindowsHost: false,
  isLinuxHost: true,
}));
const updateGameMock = vi.fn();
vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    updateGame: updateGameMock,
    getGame: () => undefined,
    loadGameDetail: vi.fn().mockResolvedValue(null),
    isGameDetailLoaded: () => gameState.detailLoaded,
    isGameUntracked: () => false,
    toggleGameTracking: vi.fn(),
  }),
}));
const showToastMock = vi.fn();
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({
    showFullLinuxUi: settingsState.showFullLinuxUi,
    isWindowsHost: settingsState.isWindowsHost,
    isLinuxHost: settingsState.isLinuxHost,
    isSimpleUi: false,
  }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Test Game",
    platform: "PC",
    path: "/games/Test/Test.exe",
    installed: true,
    playTime: "0h",
    addedAt: 1,
    compatibility: undefined,
    ...overrides,
  } as Game;
}

function openArea(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function openSection(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function saveButton() {
  return screen.getByRole("button", { name: "Save Changes" });
}

function save() {
  fireEvent.click(saveButton());
}

function slot(id: string): HTMLElement {
  const element = document.getElementById(id);
  expect(element).toBeTruthy();
  return element as HTMLElement;
}

beforeEach(() => {
  gameState.detailLoaded = true;
  settingsState.showFullLinuxUi = true;
  settingsState.isWindowsHost = false;
  settingsState.isLinuxHost = true;
  updateGameMock.mockClear();
  showToastMock.mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(() => Promise.resolve([]));
});

describe("editor shell", () => {
  it("renders every navigation area and opens on Details / Identity", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Identity" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Media & Images" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Proton / Wine" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveValue("Test Game");
  });

  it("keeps Save disabled until something changes", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("No changes yet")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });

    expect(saveButton()).not.toBeDisabled();
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("hides compatibility on hosts without Wine and keeps it out of search", () => {
    settingsState.showFullLinuxUi = false;
    settingsState.isLinuxHost = false;
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    expect(screen.queryByRole("button", { name: "Proton / Wine" })).toBeNull();

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "dxvk" } });
    expect(screen.queryByRole("option", { name: /DXVK/ })).toBeNull();
  });

  it("opens the requested area and section", () => {
    render(
      <EditGameModal game={makeGame()} initialTab="media" onClose={() => {}} />,
    );

    expect(screen.getByRole("button", { name: "Media & Images" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Artwork" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(document.getElementById("edit-artwork-cover")).toBeTruthy();
  });

  it("supports the compatibility area", () => {
    render(
      <EditGameModal
        game={makeGame()}
        initialTab="compatibility"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Proton / Wine" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Runner & prefix" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens Storage and focuses the cost field from a deep link", async () => {
    render(
      <EditGameModal
        game={makeGame()}
        focusField="purchaseCost"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Storage & playtime" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("edit-purchase-cost"),
    );
  });

  it("jumps to a field from search and focuses it", async () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "purchase cost" } });
    fireEvent.click(screen.getByRole("option", { name: /Purchase Cost/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Storage & playtime" })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("edit-purchase-cost"),
    );
  });

  it("resets one section without touching another", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Changed" },
    });
    fireEvent.change(screen.getByLabelText("Platform"), {
      target: { value: "GOG" },
    });
    expect(screen.getByText("2 unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Test Game");
    expect(screen.getByLabelText("Platform")).toHaveValue("PC");
    expect(saveButton()).toBeDisabled();
  });

  it("shows a skeleton while the full game record loads", async () => {
    gameState.detailLoaded = false;
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toBeInTheDocument(),
    );
  });
});

describe("dirty guard", () => {
  it("asks before discarding and can keep editing", () => {
    const onClose = vi.fn();
    render(<EditGameModal game={makeGame()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Changed" },
    });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText("Discard changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Changed");
  });

  it("closes without saving when changes are discarded", () => {
    const onClose = vi.fn();
    render(<EditGameModal game={makeGame()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Changed" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateGameMock).not.toHaveBeenCalled();
  });

  it("saves with Ctrl+S and closes", () => {
    const onClose = vi.fn();
    render(<EditGameModal game={makeGame()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateGameMock).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ name: "Renamed" }),
    );
  });
});

describe("save payload", () => {
  it("saves a trimmed display name override", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "  My Library Label  " },
    });
    save();

    expect(updateGameMock).toHaveBeenCalledTimes(1);
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.displayName).toBe("My Library Label");
    expect(updates.name).toBe("Test Game");
  });

  it("clears the display name back to undefined when emptied", () => {
    render(
      <EditGameModal
        game={makeGame({ displayName: "Old Label" })}
        onClose={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "" },
    });
    save();

    expect(updateGameMock.mock.calls[0][1].displayName).toBeUndefined();
  });

  it("saving after toggling compatibility keeps path a string", () => {
    render(<EditGameModal game={makeGame({ path: "" })} onClose={() => {}} />);

    openArea("Proton / Wine");
    fireEvent.click(
      screen.getByRole("switch", { name: /Wine \/ Proton Compatibility Layer/ }),
    );
    save();

    expect(updateGameMock).toHaveBeenCalledTimes(1);
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility).toBeTruthy();
    expect(updates.compatibility.enabled).toBe(true);
    expect(updates.path).toBe("");
  });

  it("defaults compatibility on for a Windows executable on Linux", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    openArea("Proton / Wine");
    expect(
      screen.getByRole("switch", { name: /Wine \/ Proton Compatibility Layer/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("respects an explicitly saved enabled=false", () => {
    render(
      <EditGameModal
        game={makeGame({ compatibility: { enabled: false } })}
        onClose={() => {}}
      />,
    );

    openArea("Proton / Wine");
    expect(
      screen.getByRole("switch", { name: /Wine \/ Proton Compatibility Layer/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("saves the specific-GPU override from graphics", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    openArea("Proton / Wine");
    openSection("Graphics & Direct3D");
    const card = slot("compat-specific-gpu");
    fireEvent.click(within(card).getByRole("button", { name: "On" }));
    save();

    expect(updateGameMock.mock.calls[0][1].compatibility.useSpecificGpu).toBe(true);
  });

  it("saves controller and anti-cheat overrides from tools", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    openArea("Proton / Wine");
    openSection("Tools & overlays");

    const controllerCard = screen
      .getByText("Controller Support")
      .closest(".edit-card") as HTMLElement;
    fireEvent.click(within(controllerCard).getByRole("button", { name: "On" }));

    const anticheatCard = screen
      .getByText("Anti-Cheat Support (EAC / BattlEye)")
      .closest(".edit-card") as HTMLElement;
    fireEvent.click(within(anticheatCard).getByRole("button", { name: "On" }));

    save();

    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility.enableControllerSupport).toBe(true);
    expect(updates.compatibility.enableAnticheatSupport).toBe(true);
  });

  it("keeps the specific-GPU override unset when left on Global", () => {
    render(
      <EditGameModal
        game={makeGame({ compatibility: { enabled: true } })}
        onClose={() => {}}
      />,
    );

    openArea("Proton / Wine");
    openSection("Graphics & Direct3D");
    const dxvk = slot("compat-dxvk");
    fireEvent.click(within(dxvk).getByRole("button", { name: "On" }));
    save();

    expect(updateGameMock.mock.calls[0][1].compatibility.useSpecificGpu).toBe(null);
  });

  it("preserves the tracked logo source through save", () => {
    render(
      <EditGameModal
        game={makeGame({
          logoUrl: "asset://localhost/logo.png",
          logoSourceUrl: "https://cdn.example/logo.png",
        })}
        onClose={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Platform"), {
      target: { value: "GOG" },
    });
    save();

    expect(updateGameMock).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ logoSourceUrl: "https://cdn.example/logo.png" }),
    );
  });
});

describe("compatibility", () => {
  const runner = {
    id: "steam-proton-9",
    name: "Steam Proton 9",
    path: "/steam/steamapps/common/Proton 9/proton",
    kind: "proton",
  };

  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string) => Promise<unknown>,
  );

  function runnerCard() {
    openArea("Proton / Wine");
    const card = screen.getByText("Runner Selection").closest(".edit-card");
    expect(card).toBeTruthy();
    return card as HTMLElement;
  }

  it("shows the saved runner in the dropdown", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_compatibility_runners") return Promise.resolve([runner]);
      if (cmd === "get_compatibility_settings") return Promise.resolve({});
      return Promise.resolve([]);
    });

    render(
      <EditGameModal
        game={makeGame({
          compatibility: {
            enabled: true,
            runnerType: "custom",
            customRunnerPath: runner.path,
          },
        })}
        onClose={() => {}}
      />,
    );

    const select = within(runnerCard()).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(runner.path));
    expect(select.options[select.selectedIndex].textContent).toContain(
      "Steam Proton 9",
    );
  });

  it("keeps the custom-path option for an unknown runner", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_compatibility_runners") return Promise.resolve([runner]);
      if (cmd === "get_compatibility_settings") return Promise.resolve({});
      return Promise.resolve([]);
    });

    render(
      <EditGameModal
        game={makeGame({
          compatibility: {
            enabled: true,
            runnerType: "custom",
            customRunnerPath: "/opt/custom-wine/bin/wine",
          },
        })}
        onClose={() => {}}
      />,
    );

    const card = runnerCard();
    const select = within(card).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("custom"));
    expect(
      within(card).getByPlaceholderText("/path/to/wine or /path/to/proton"),
    ).toHaveValue("/opt/custom-wine/bin/wine");
  });

  it("offers the settings prefix as the default option", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({ defaultPrefix: "/shared/pfx" });
      }
      if (cmd === "list_wine_prefixes") {
        return Promise.resolve([{ id: "shared", name: "Shared", path: "/shared/pfx" }]);
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    openArea("Proton / Wine");
    const card = screen
      .getByText("Custom WINEPREFIX Directory")
      .closest(".edit-card") as HTMLElement;
    const select = within(card).getByRole("combobox") as HTMLSelectElement;

    await waitFor(() =>
      expect(select.options[select.selectedIndex].textContent).toContain("/shared/pfx"),
    );
    expect(select.value).toBe("");
  });

  it("saves a specific prefix chosen from the dropdown", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({ defaultPrefix: "/shared/pfx" });
      }
      if (cmd === "list_wine_prefixes") {
        return Promise.resolve([{ id: "shared", name: "Shared", path: "/shared/pfx" }]);
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    openArea("Proton / Wine");
    const card = screen
      .getByText("Custom WINEPREFIX Directory")
      .closest(".edit-card") as HTMLElement;
    const select = within(card).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() =>
      expect(
        Array.from(select.options).some((option) => option.value === "/shared/pfx"),
      ).toBe(true),
    );

    fireEvent.change(select, { target: { value: "/shared/pfx" } });
    save();

    expect(updateGameMock.mock.calls[0][1].compatibility.customWinePrefix).toBe(
      "/shared/pfx",
    );
  });

  it("shows what each compatibility item resolves to in Settings", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({
          defaultRunnerPath: "",
          audioDriver: "pulse",
          wineDebug: "fixme-all",
          enableDxvk: false,
          enableVkd3d: true,
          enableVkd3dDescriptorHeap: false,
        });
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArea("Proton / Wine");

    await waitFor(() =>
      expect(screen.getByText("Settings: Auto-detect")).toBeTruthy(),
    );
    expect(screen.getByText("Settings: PulseAudio")).toBeTruthy();
    expect(screen.getByText("Settings: fixme-all")).toBeTruthy();

    openSection("Graphics & Direct3D");
    expect(within(slot("compat-dxvk")).getByText("Settings: Off")).toBeTruthy();
    expect(within(slot("compat-vkd3d")).getByText("Settings: On")).toBeTruthy();
  });

  it("hides the hints while settings are unavailable", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.reject(new Error("settings unavailable"));
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArea("Proton / Wine");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("get_compatibility_settings"),
    );
    expect(screen.queryByText(/Settings:/)).toBeNull();
  });
});

describe("media", () => {
  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string, args?: unknown) => Promise<unknown>,
  );

  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockImplementation(() => Promise.resolve(null));
  });

  afterEach(() => {
    openMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve([]));
  });

  function openArtwork() {
    openArea("Media & Images");
  }

  it("shows all four artwork slots at once", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArtwork();

    expect(document.getElementById("edit-artwork-icon")).toBeTruthy();
    expect(document.getElementById("edit-artwork-cover")).toBeTruthy();
    expect(document.getElementById("edit-artwork-hero")).toBeTruthy();
    expect(document.getElementById("edit-artwork-logo")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "File" })).toHaveLength(4);
  });

  it("saves a chosen icon immediately", async () => {
    openMock.mockResolvedValueOnce("/pictures/new-icon.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") return Promise.resolve("artwork/game-1/icon.png");
      if (cmd === "artwork_asset_url") {
        return Promise.resolve("file:///tmp/artwork/game-1/icon.png");
      }
      return Promise.resolve(null);
    });

    render(
      <EditGameModal
        game={makeGame({ iconUrl: "asset://localhost/old-icon.png" })}
        onClose={() => {}}
      />,
    );
    openArtwork();
    fireEvent.click(within(slot("edit-artwork-icon")).getByRole("button", { name: "File" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "patch_game",
        expect.objectContaining({
          id: "game-1",
          patch: expect.objectContaining({
            iconUrl: expect.stringContaining("asset://localhost/"),
          }),
        }),
      ),
    );
    expect(updateGameMock).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ iconUrl: expect.stringContaining("asset://localhost/") }),
    );
    // Artwork persists immediately, so it must not count as an unsaved edit.
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("persists a chosen cover and clears the stale source", async () => {
    openMock.mockResolvedValueOnce("/pictures/new-cover.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") return Promise.resolve("artwork/game-1/cover.png");
      if (cmd === "artwork_asset_url") {
        return Promise.resolve("file:///tmp/artwork/game-1/cover.png");
      }
      return Promise.resolve(null);
    });

    render(
      <EditGameModal
        game={makeGame({
          coverArtUrl: "asset://localhost/old-cover.png",
          coverSourceUrl: "https://old.example/cover.png",
        })}
        onClose={() => {}}
      />,
    );
    openArtwork();
    fireEvent.click(within(slot("edit-artwork-cover")).getByRole("button", { name: "File" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "patch_game",
        expect.objectContaining({
          patch: expect.objectContaining({ coverSourceUrl: null }),
        }),
      ),
    );
  });

  it("persists a chosen hero to bannerUrl", async () => {
    openMock.mockResolvedValueOnce("/pictures/new-hero.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") return Promise.resolve("artwork/game-1/hero.png");
      if (cmd === "artwork_asset_url") {
        return Promise.resolve("file:///tmp/artwork/game-1/hero.png");
      }
      return Promise.resolve(null);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArtwork();
    fireEvent.click(within(slot("edit-artwork-hero")).getByRole("button", { name: "File" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "patch_game",
        expect.objectContaining({
          patch: expect.objectContaining({
            bannerUrl: expect.stringContaining("asset://localhost/"),
          }),
        }),
      ),
    );
  });

  it("clears both the logo and its tracked source", async () => {
    render(
      <EditGameModal
        game={makeGame({
          logoUrl: "asset://localhost/old-logo.png",
          logoSourceUrl: "https://cdn.example/old-logo.png",
        })}
        onClose={() => {}}
      />,
    );
    openArtwork();
    fireEvent.click(
      within(slot("edit-artwork-logo")).getByRole("button", { name: "Remove Logo" }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "patch_game",
        expect.objectContaining({
          patch: expect.objectContaining({ logoUrl: null, logoSourceUrl: null }),
        }),
      ),
    );
    expect(updateGameMock).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ logoUrl: undefined, logoSourceUrl: undefined }),
    );
  });

  it("does not touch the game when the artwork file cannot be stored", async () => {
    openMock.mockResolvedValueOnce("/pictures/broken.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") return Promise.reject(new Error("disk full"));
      return Promise.resolve(null);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArtwork();
    fireEvent.click(within(slot("edit-artwork-icon")).getByRole("button", { name: "File" }));

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("Failed to load image", "error"),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("patch_game", expect.anything());
    expect(updateGameMock).not.toHaveBeenCalled();
  });

  it("opens screenshots, videos and links as their own sections", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    openArea("Media & Images");

    openSection("Screenshots");
    expect(document.getElementById("edit-screenshots")).toBeTruthy();

    openSection("Videos");
    expect(document.getElementById("edit-videos")).toBeTruthy();

    openSection("Links");
    expect(document.getElementById("edit-websites")).toBeTruthy();
  });
});

describe("purchase cost", () => {
  const invokeMock = vi.mocked(invoke);

  it("auto-fills from the known store price when no cost is set", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fetch_game_prices_batch") {
        return Promise.resolve({ "Test Game": { salePrice: 19.99, normalPrice: 39.99 } });
      }
      return Promise.resolve([]);
    });

    render(
      <EditGameModal game={makeGame()} focusField="purchaseCost" onClose={() => {}} />,
    );

    await waitFor(() =>
      expect(document.getElementById("edit-purchase-cost")).toHaveValue(19.99),
    );
    expect(screen.getByText(/Auto-filled from the current store price/i)).toBeTruthy();
    // A price suggestion is not a user edit, so Save stays disabled until the
    // user actually changes something.
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("never overrides a cost the user already set", async () => {
    render(
      <EditGameModal
        game={makeGame({ purchaseCost: 12.5, purchaseCurrency: "EUR" })}
        focusField="purchaseCost"
        onClose={() => {}}
      />,
    );

    expect(document.getElementById("edit-purchase-cost")).toHaveValue(12.5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "fetch_game_prices_batch",
      expect.anything(),
    );
  });
});
