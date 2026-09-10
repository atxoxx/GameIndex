import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { EditGameModal } from "./EditGameModal";
import type { Game } from "../../types/game";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

const updateGameMock = vi.fn();
vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    updateGame: updateGameMock,
    isGameUntracked: () => false,
    toggleGameTracking: vi.fn(),
  }),
}));
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
