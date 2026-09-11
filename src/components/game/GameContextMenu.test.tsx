import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GameContextMenu from "./GameContextMenu";
import type { Game } from "../../types/game";

const updateGameMock = vi.fn();
const enrichGameMetadataMock = vi.fn(() => Promise.resolve());
const toggleGameTrackingMock = vi.fn();
const showToastMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    updateGame: updateGameMock,
    enrichGameMetadata: enrichGameMetadataMock,
    isGameUntracked: () => false,
    toggleGameTracking: toggleGameTrackingMock,
  }),
}));
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ isWindowsHost: false }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Test Game",
    path: "/games/Test/Test.exe",
    platform: "Local",
    installed: true,
    playTime: "2h",
    addedAt: 1,
    ...overrides,
  };
}

function renderMenu(props: Partial<React.ComponentProps<typeof GameContextMenu>> = {}) {
  const onClose = vi.fn();
  const onLaunch = vi.fn();
  const onViewDetails = vi.fn();
  const onRemove = vi.fn();
  render(
    <GameContextMenu
      x={10}
      y={10}
      game={makeGame()}
      isRunning={false}
      onClose={onClose}
      onLaunch={onLaunch}
      onViewDetails={onViewDetails}
      onRemove={onRemove}
      {...props}
    />
  );
  return { onClose, onLaunch, onViewDetails, onRemove };
}

function menuItem(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const item = labelEl.closest('[role="menuitem"]');
  if (!item) throw new Error(`No menuitem found for "${label}"`);
  return item as HTMLElement;
}

describe("GameContextMenu", () => {
  beforeEach(() => {
    updateGameMock.mockClear();
    enrichGameMetadataMock.mockClear();
    toggleGameTrackingMock.mockClear();
    showToastMock.mockClear();
    navigateMock.mockClear();
  });

  it("dispatches the injected actions from the rendered items", () => {
    const { onViewDetails, onLaunch } = renderMenu();

    fireEvent.click(menuItem("Play Game"));
    expect(onLaunch).toHaveBeenCalledTimes(1);

    fireEvent.click(menuItem("View Details"));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("sets the play status through the status submenu", async () => {
    renderMenu();

    fireEvent.click(menuItem("Set status"));
    fireEvent.click(await screen.findByText("Completed"));

    expect(updateGameMock).toHaveBeenCalledWith("game-1", { playStatus: "completed" });
    expect(showToastMock).toHaveBeenCalled();
  });

  it("copies a game field to the clipboard and confirms it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderMenu();
    fireEvent.click(menuItem("Copy"));
    fireEvent.click(await screen.findByText("Copy Name"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Test Game"));
    expect(showToastMock).toHaveBeenCalledWith("Copied to clipboard", "success");
  });

  it("surfaces an error toast when the clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });

    renderMenu();
    fireEvent.click(menuItem("Copy"));
    fireEvent.click(await screen.findByText("Copy Game ID"));

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("Couldn't copy to clipboard", "error")
    );
  });

  it("disables force-close when the caller provides no handler", () => {
    const { onClose } = renderMenu({ isRunning: true, onForceClose: undefined });

    const item = menuItem("Force Close");
    expect(item).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(item);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderMenu();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
