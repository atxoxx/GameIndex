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

const updateGameMock = vi.fn();
vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    updateGame: updateGameMock,
    getGame: () => undefined,
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
    showFullLinuxUi: true,
    isWindowsHost: false,
    isLinuxHost: true,
  }),
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

describe("EditGameModal save", () => {
  beforeEach(() => {
    updateGameMock.mockClear();
  });

  it("saving after toggling a proton/wine feature does not throw and keeps path a string", () => {
    const game = makeGame({ path: "" });
    render(<EditGameModal game={game} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle compatibility layer" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateGameMock).toHaveBeenCalledTimes(1);
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility).toBeTruthy();
    expect(updates.compatibility.enabled).toBe(true);
    // Regression: an empty executable path must be saved as a plain empty
    // string, never `undefined` — the sidebar's `g.path.toLowerCase()`
    // runs outside the error boundary and blanks the whole app on
    // `undefined` (the "app goes blank after clicking save" bug).
    expect(updates.path).toBe("");
  });

  it("defaults the compatibility toggle on for a Windows .exe on a Linux host", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    const toggle = screen.getByRole("button", {
      name: "Toggle compatibility layer",
    });
    expect(toggle.className).toContain("active");
  });

  it("respects an explicitly saved enabled=false over the Linux default", () => {
    render(
      <EditGameModal
        game={makeGame({ compatibility: { enabled: false } })}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    const toggle = screen.getByRole("button", {
      name: "Toggle compatibility layer",
    });
    expect(toggle.className).not.toContain("active");
  });

  it("saves the specific-GPU override from the graphics subtab", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Graphics & Direct3D" })
    );

    const card = screen
      .getByText("Use Specific GPU (MESA_VK_DEVICE_SELECT)")
      .closest(".edit-launch-card");
    expect(card).toBeTruthy();
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "On" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateGameMock).toHaveBeenCalledTimes(1);
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility.useSpecificGpu).toBe(true);
  });

  it("saves the controller and anti-cheat overrides from the tools subtab", () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools & Overlays" }));

    const controllerCard = screen
      .getByText("Controller Support")
      .closest(".edit-launch-card");
    expect(controllerCard).toBeTruthy();
    fireEvent.click(within(controllerCard as HTMLElement).getByRole("button", { name: "On" }));

    const anticheatCard = screen
      .getByText("Anti-Cheat Support (EAC / BattlEye)")
      .closest(".edit-launch-card");
    expect(anticheatCard).toBeTruthy();
    fireEvent.click(within(anticheatCard as HTMLElement).getByRole("button", { name: "On" }));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateGameMock).toHaveBeenCalledTimes(1);
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility.enableControllerSupport).toBe(true);
    expect(updates.compatibility.enableAnticheatSupport).toBe(true);
  });

  it("keeps the specific-GPU override unset when left on Global", () => {
    render(
      <EditGameModal
        game={makeGame({ compatibility: { enabled: true } })}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    // `null` is the tri-state "inherit from Settings" value and is what the
    // backend reads as "fall back to the global toggle".
    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility.useSpecificGpu).toBe(null);
  });
});

describe("EditGameModal initial tab", () => {
  it("opens directly on the requested section", () => {
    render(
      <EditGameModal game={makeGame()} initialTab="media" onClose={() => {}} />
    );

    expect(screen.getByRole("tab", { name: "Media & Images" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("supports the proton/wine section too", () => {
    render(
      <EditGameModal game={makeGame()} initialTab="compatibility" onClose={() => {}} />
    );

    expect(screen.getByRole("tab", { name: "Proton / Wine" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});

describe("EditGameModal runner selection", () => {
  const runner = {
    id: "steam-proton-9",
    name: "Steam Proton 9",
    path: "/steam/steamapps/common/Proton 9/proton",
    kind: "proton",
  };

  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string) => Promise<unknown>
  );

  beforeEach(() => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_compatibility_runners") {
        return Promise.resolve([runner]);
      }
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({});
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    invokeMock.mockImplementation(() => Promise.resolve([]));
  });

  function runnerCard() {
    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    const card = screen
      .getByText("Runner Selection")
      .closest(".edit-launch-card");
    expect(card).toBeTruthy();
    return card as HTMLElement;
  }

  it("shows the saved runner in the dropdown instead of the custom-path option", async () => {
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
      />
    );

    const select = within(runnerCard()).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(runner.path));
    expect(select.options[select.selectedIndex].textContent).toContain(
      "Steam Proton 9"
    );
  });

  it("keeps the custom-path option for an unrecognized runner path", async () => {
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
      />
    );

    const card = runnerCard();
    const select = within(card).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("custom"));

    const pathInput = within(card).getByPlaceholderText(
      "/path/to/wine or /path/to/proton"
    ) as HTMLInputElement;
    expect(pathInput.value).toBe("/opt/custom-wine/bin/wine");
  });
});

describe("EditGameModal prefix selection", () => {
  const sharedPrefix = {
    id: "prefix-shared",
    name: "Shared",
    path: "/shared/pfx",
  };

  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string) => Promise<unknown>
  );

  beforeEach(() => {
    updateGameMock.mockClear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({ defaultPrefix: sharedPrefix.path });
      }
      if (cmd === "list_wine_prefixes") {
        return Promise.resolve([sharedPrefix]);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    invokeMock.mockImplementation(() => Promise.resolve([]));
  });

  function prefixCard() {
    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));
    const card = screen
      .getByText("Custom WINEPREFIX Directory")
      .closest(".edit-launch-card");
    expect(card).toBeTruthy();
    return card as HTMLElement;
  }

  it("shows the prefix selected in settings as the default option", async () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    const select = within(prefixCard()).getByRole(
      "combobox"
    ) as HTMLSelectElement;

    await waitFor(() =>
      expect(select.options[select.selectedIndex].textContent).toContain(
        "/shared/pfx"
      )
    );
    expect(select.value).toBe("");
  });

  it("saves a specific prefix chosen from the dropdown", async () => {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    const select = within(prefixCard()).getByRole(
      "combobox"
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        Array.from(select.options).some((o) => o.value === sharedPrefix.path)
      ).toBe(true)
    );

    fireEvent.change(select, { target: { value: sharedPrefix.path } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    const updates = updateGameMock.mock.calls[0][1];
    expect(updates.compatibility.customWinePrefix).toBe(sharedPrefix.path);
  });

  it("still offers the settings default when the prefix scan fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.resolve({ defaultPrefix: sharedPrefix.path });
      }
      if (cmd === "list_wine_prefixes") {
        return Promise.reject(new Error("scan failed"));
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);

    const select = within(prefixCard()).getByRole(
      "combobox"
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(select.options[select.selectedIndex].textContent).toContain(
        "/shared/pfx"
      )
    );
  });
});

describe("EditGameModal global setting hints", () => {
  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string) => Promise<unknown>
  );

  afterEach(() => {
    invokeMock.mockImplementation(() => Promise.resolve([]));
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
    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));

    await waitFor(() =>
      expect(screen.getByText("Settings: Auto-detect")).toBeTruthy()
    );
    expect(screen.getByText("Settings: PulseAudio")).toBeTruthy();
    expect(screen.getByText("Settings: fixme-all")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Graphics & Direct3D" })
    );

    const dxvkCard = screen
      .getByText("DXVK (Direct3D 9, 10, 11 to Vulkan)")
      .closest(".edit-launch-card") as HTMLElement;
    expect(within(dxvkCard).getByText("Settings: Off")).toBeTruthy();

    const vkd3dCard = screen
      .getByText("VKD3D-Proton (Direct3D 12 to Vulkan)")
      .closest(".edit-launch-card") as HTMLElement;
    expect(within(vkd3dCard).getByText("Settings: On")).toBeTruthy();

    const descriptorHeapCard = screen
      .getByText("VKD3D Descriptor Heap")
      .closest(".edit-launch-card") as HTMLElement;
    expect(within(descriptorHeapCard).getByText("Settings: Off")).toBeTruthy();
  });

  it("hides the hints while settings are unavailable", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_compatibility_settings") {
        return Promise.reject(new Error("settings unavailable"));
      }
      return Promise.resolve([]);
    });

    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Proton / Wine" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("get_compatibility_settings")
    );
    expect(screen.queryByText(/Settings:/)).toBeNull();
  });
});

describe("EditGameModal instant artwork save", () => {
  const invokeMock = vi.mocked(
    invoke as unknown as (cmd: string, args?: unknown) => Promise<unknown>
  );

  beforeEach(() => {
    updateGameMock.mockClear();
    showToastMock.mockClear();
    invokeMock.mockClear();
    invokeMock.mockImplementation(() => Promise.resolve(null));
  });

  afterEach(() => {
    openMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve([]));
  });

  function openMediaTab() {
    render(<EditGameModal game={makeGame()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Media & Images" }));
  }

  function iconFileButton() {
    return screen.getAllByRole("button", { name: "File" })[0];
  }

  it("saves a chosen icon immediately, replacing the existing one", async () => {
    openMock.mockResolvedValueOnce("/pictures/new-icon.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") {
        return Promise.resolve("artwork/game-1/icon.png");
      }
      if (cmd === "artwork_asset_url") {
        return Promise.resolve("file:///tmp/artwork/game-1/icon.png");
      }
      return Promise.resolve(null);
    });

    render(
      <EditGameModal
        game={makeGame({ iconUrl: "asset://localhost/old-icon.png" })}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "Media & Images" }));
    fireEvent.click(iconFileButton());

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "store_artwork_file",
        expect.objectContaining({ gameId: "game-1", slot: "icon" })
      )
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "save_game",
        expect.objectContaining({
          game: expect.objectContaining({
            id: "game-1",
            iconUrl: expect.stringContaining("asset://localhost/"),
          }),
        })
      )
    );
    expect(updateGameMock).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({
        iconUrl: expect.stringContaining("asset://localhost/"),
      })
    );
    expect(updateGameMock.mock.calls[0][1].iconUrl).not.toBe(
      "asset://localhost/old-icon.png"
    );
  });

  it("does not touch the game when the artwork file cannot be stored", async () => {
    openMock.mockResolvedValueOnce("/pictures/broken.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "store_artwork_file") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve(null);
    });

    openMediaTab();
    fireEvent.click(iconFileButton());

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("Failed to load image", "error")
    );
    expect(invokeMock).not.toHaveBeenCalledWith("save_game", expect.anything());
    expect(updateGameMock).not.toHaveBeenCalled();
  });
});
