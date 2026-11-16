import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

import GameExecutablePickerModal from "./GameExecutablePickerModal";
import type { Game, GameExecutable } from "../../types/game";

const state = vi.hoisted(() => ({ running: [] as string[] }));
const updateGameMock = vi.hoisted(() => vi.fn());
const pickFileMock = vi.hoisted(() => vi.fn(() => Promise.resolve(null as string | null)));
const copyMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: pickFileMock }));
vi.mock("../../utils/clipboard", () => ({ copyTextToClipboard: copyMock }));
vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ updateGame: updateGameMock, runningGameIds: state.running }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "beamng",
    name: "BeamNG.drive",
    platform: "Steam",
    steamAppId: 284190,
    path: "C:/games/BeamNG.drive/Bin64/BeamNG.drive.exe",
    installed: true,
    playTime: "0h",
    addedAt: 1,
    ...overrides,
  } as Game;
}

const extra: GameExecutable = {
  path: "C:/mods/BeamNG.Earth-1.10.1-beta.exe",
  label: "Beamng earth",
  arguments: "-earth",
};

function renderPicker(game = makeGame({ extraExecutables: [extra] })) {
  const onClose = vi.fn();
  const onLaunch = vi.fn();
  const launchGame = vi.fn();

  // Mirror the real GameContext: updateGame merges into state synchronously,
  // so the modal re-renders with the edited executable on the next frame.
  function Harness() {
    const [current, setCurrent] = useState(game);
    updateGameMock.mockImplementation((id: string, patch: Partial<Game>) => {
      if (id === current.id) setCurrent((prev) => ({ ...prev, ...patch }));
    });
    return (
      <GameExecutablePickerModal
        game={current}
        open
        onClose={onClose}
        onLaunch={onLaunch}
        launchGame={launchGame}
      />
    );
  }

  const view = render(<Harness />);
  return { ...view, onClose, onLaunch, launchGame };
}

function launchButtons() {
  return screen.getAllByRole("button", { name: "game.execExtras.launch" });
}

beforeEach(() => {
  cleanup();
  updateGameMock.mockClear();
  pickFileMock.mockClear();
  copyMock.mockClear();
  state.running = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === "check_paths_exist") {
      const paths = (args as Record<string, unknown> | undefined)?.paths as string[] | undefined;
      return (paths ?? []).map((p) => !p.toLowerCase().includes("missing"));
    }
    return null;
  });
});

describe("GameExecutablePickerModal", () => {
  it("lists the default target and the extra executable with its label and arguments", async () => {
    renderPicker();
    expect(screen.getAllByText("BeamNG.drive")).toHaveLength(2);
    expect(screen.getByDisplayValue("Beamng earth")).toBeTruthy();
    expect(screen.getByDisplayValue("-earth")).toBeTruthy();
    expect(screen.getByText("BeamNG.Earth-1.10.1-beta.exe")).toBeTruthy();
    await waitFor(() => expect(launchButtons()).toHaveLength(2));
  });

  it("launches the extra executable with its current edits and closes the picker", async () => {
    const { onClose, onLaunch } = renderPicker();
    await waitFor(() => expect(launchButtons()).toHaveLength(2));

    fireEvent.change(screen.getByDisplayValue("-earth"), { target: { value: "-earth -fps 120" } });
    fireEvent.click(launchButtons()[1]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: extra.path,
        label: "Beamng earth",
        arguments: "-earth -fps 120",
      }),
    );
  });

  it("launches the default target with the plain launch callback", async () => {
    const { onClose, launchGame } = renderPicker();
    await waitFor(() => expect(launchButtons()).toHaveLength(2));

    fireEvent.click(launchButtons()[0]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(launchGame).toHaveBeenCalledTimes(1);
    expect((launchGame.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "beamng" });
  });

  it("promotes an extra to default and keeps the old main as an extra", () => {
    const game = makeGame({
      extraExecutables: [extra],
      launchArguments: "-original",
      runAsAdmin: false,
    });
    renderPicker(game);

    fireEvent.click(screen.getByRole("button", { name: "game.execExtras.makeDefault" }));

    expect(updateGameMock).toHaveBeenCalledWith("beamng", {
      path: extra.path,
      launchArguments: "-earth",
      runAsAdmin: undefined,
      steamBypass: true,
      extraExecutables: [
        {
          path: game.path,
          label: "BeamNG.drive.exe",
          arguments: "-original",
          runAsAdmin: undefined,
        },
      ],
    });
  });

  it("toggles run-as-admin and removes an executable", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "game.execExtras.runAsAdmin" }));
    expect(updateGameMock).toHaveBeenLastCalledWith("beamng", {
      extraExecutables: [{ ...extra, runAsAdmin: true }],
    });

    fireEvent.click(screen.getByRole("button", { name: "game.execExtras.remove" }));
    expect(updateGameMock).toHaveBeenLastCalledWith("beamng", {
      extraExecutables: undefined,
    });
  });

  it("disables launch for a missing path and while the game is running", async () => {
    const missingGame = makeGame({
      extraExecutables: [{ path: "C:/mods/missing.exe", label: "Missing" }],
    });
    const { unmount } = renderPicker(missingGame);
    await waitFor(() => expect(screen.getByText("game.execExtras.pathMissing")).toBeTruthy());
    expect(launchButtons()[1]).toBeDisabled();
    unmount();

    state.running = ["beamng"];
    renderPicker();
    await waitFor(() => expect(launchButtons()).toHaveLength(2));
    expect(launchButtons()[0]).toBeDisabled();
    expect(launchButtons()[1]).toBeDisabled();
  });
});
