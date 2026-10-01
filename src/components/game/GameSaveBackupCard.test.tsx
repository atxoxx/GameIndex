import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SaveBackup } from "../../types/saves";
import { invoke } from "@tauri-apps/api/core";
import { useSaves } from "../../context/SavesContext";
import GameSaveBackupCard from "./GameSaveBackupCard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: () => ({
    ref: vi.fn(),
    tabIndex: 0,
    onClick: vi.fn(),
    onKeyDown: vi.fn(),
  }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string) => {
      const dict: Record<string, string> = {
        "saves.tab.title": "Save Backups",
        "saves.action.backupNow": "Back up now",
        "saves.action.restore": "Restore",
        "saves.action.manage": "Manage",
        "saves.backups.count": "backups",
        "saves.game.lastBackup": "last backed up",
        "saves.backups.meta": "files",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../context/SavesContext", () => ({
  useSaves: vi.fn(),
}));

const backup: SaveBackup = {
  id: "bak-1",
  gameId: "game-1",
  gameName: "Game One",
  createdAt: 1_700_000_000_000,
  kind: "manual",
  note: "",
  locationCount: 1,
  fileCount: 3,
  totalBytes: 2048,
  status: "complete",
  rootPath: "/backups/game-1/x.gisave",
  manifestPath: "",
};

function renderCard() {
  return render(
    <GameSaveBackupCard gameId="game-1" gameName="Game One" onManage={() => {}} />
  );
}

describe("GameSaveBackupCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSaves).mockReturnValue({
      enabled: true,
      restoreBackup: vi.fn().mockResolvedValue({ restoredFiles: 3, warnings: [] }),
    } as unknown as ReturnType<typeof useSaves>);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "saves_list_backups") return [backup];
      if (cmd === "saves_backup_game") return backup;
      return null;
    });
  });

  it("shows the latest snapshot and backs up the game", async () => {
    const { container } = renderCard();

    expect(await screen.findByText("Save Backups")).toBeDefined();
    expect(screen.getByText("last backed up")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /back up now/i }));

    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("saves_backup_game", {
        gameId: "game-1",
        note: null,
      })
    );
    expect(container.querySelector(".game-save-backup-card")).not.toBeNull();
  });

  it("renders nothing when the saves suite is disabled", () => {
    vi.mocked(useSaves).mockReturnValue({
      enabled: false,
      restoreBackup: vi.fn(),
    } as unknown as ReturnType<typeof useSaves>);

    const { container } = renderCard();
    expect(container.querySelector(".game-save-backup-card")).toBeNull();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
