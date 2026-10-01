import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SavesPage from "./SavesPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string) => {
      const dict: Record<string, string> = {
        "saves.subtab.games": "Tracked Games",
        "saves.subtab.snapshots": "Snapshot Timeline",
        "saves.subtab.system": "Library & Database",
        "saves.subtab.settings": "Settings & Storage",
        "saves.page.title": "Save Backups",
        "saves.page.desc": "Detect, snapshot and restore the save data for every game in your library.",
        "saves.kpi.games": "Games",
        "saves.kpi.locations": "Locations",
        "saves.kpi.backups": "Backups",
        "saves.kpi.lastBackup": "Last backup",
        "saves.kpi.never": "Never",
        "saves.page.yourGames": "Your games",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({
    games: [
      { id: "game-1", title: "Cyberpunk 2077", coverArtUrl: "" },
      { id: "game-2", title: "Witcher 3", coverArtUrl: "" },
    ],
  }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({
    showFullLinuxUi: false,
  }),
  useWidgetVisible: () => true,
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: (fn: () => void) => ({
    ref: vi.fn(),
    tabIndex: 0,
    onClick: fn,
    onKeyDown: vi.fn(),
  }),
}));

vi.mock("../../context/SavesContext", () => ({
  useSaves: () => ({
    enabled: true,
    ready: true,
    settings: {
      enabled: true,
      backupDir: "C:/Games/Saves/Backups",
      autoBackupOnExit: true,
      includeEmulatorSaves: false,
      retention: 10,
      restoreSafetySnapshot: true,
      ignorePatterns: [],
      lastScanAt: 0,
    },
    summary: {
      enabled: true,
      backupDir: "C:/Games/Saves/Backups",
      gamesWithLocations: 2,
      totalLocations: 3,
      missingLocations: 0,
      totalBackups: 5,
      totalBackupBytes: 1048576,
      lastBackupAt: 1700000000000,
      autoBackupOnExit: true,
      retention: 10,
    },
    progress: null,
    refresh: vi.fn(),
    scanAll: vi.fn(),
    restoreBackup: vi.fn(),
    deleteBackup: vi.fn(),
    openBackup: vi.fn(),
    openPath: vi.fn(),
    pickBackupDir: vi.fn(),
    updateSettings: vi.fn(),
  }),
}));

import { invoke } from "@tauri-apps/api/core";

describe("SavesPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "saves_list_all_locations") {
        return [
          {
            id: "loc-1",
            gameId: "game-1",
            path: "C:/Saves/Cyberpunk",
            label: "Saves",
            kind: "dir",
            source: "curated",
            include: true,
            createdAt: 1700000000,
            updatedAt: 1700000000,
          },
        ];
      }
      if (cmd === "saves_list_backups") {
        return [
          {
            id: "bak-1",
            gameId: "game-1",
            gameName: "Cyberpunk 2077",
            createdAt: 1700000000000,
            kind: "manual",
            note: "Before boss",
            locationCount: 1,
            fileCount: 3,
            totalBytes: 2048,
            status: "complete",
            rootPath: "",
            manifestPath: "",
          },
        ];
      }
      return null;
    });
  });

  it("renders all four subtabs properly", async () => {
    render(
      <MemoryRouter initialEntries={["/saves"]}>
        <SavesPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Tracked Games")).toBeDefined();
    expect(screen.getByText("Snapshot Timeline")).toBeDefined();
    expect(screen.getByText("Library & Database")).toBeDefined();
    expect(screen.getByText("Settings & Storage")).toBeDefined();
  });
});
