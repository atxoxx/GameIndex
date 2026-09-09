import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});