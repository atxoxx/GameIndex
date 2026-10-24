import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  deleteBackup: vi.fn(async () => undefined),
  restoreBackup: vi.fn(async () => ({
    backupId: "bak-1",
    gameId: "game-1",
    restoredFiles: 3,
    totalBytes: 2048,
    safetyBackupId: null,
    warnings: [],
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const LABELS = vi.hoisted<Record<string, string>>(() => ({
  "nav.saves": "Saves",
  "saves.page.title": "Save Backups",
  "saves.page.desc": "Detect, snapshot and restore the save data for every game in your library.",
  "saves.page.loadError": "Could not read the save backup library.",
  "saves.page.noGamesTitle": "No save locations found yet",
  "saves.page.noGamesText": "Scan your library to find the folders and files your games use to store progress.",
  "saves.page.yourGames": "Your games",
  "saves.subtab.games": "Tracked Games",
  "saves.subtab.snapshots": "Snapshot Timeline",
  "saves.subtab.system": "Library & Database",
  "saves.subtab.settings": "Settings & Storage",
  "saves.viewsLabel": "Saves views",
  "saves.action.scanLibrary": "Scan library",
  "saves.action.scanForSaves": "Scan for saves",
  "saves.action.backupAll": "Back up all",
  "saves.action.backupNow": "Back up now",
  "saves.action.rescan": "Rescan",
  "saves.action.restore": "Restore",
  "saves.action.addLocation": "Add location",
  "saves.action.add": "Add",
  "saves.action.openFolder": "Open folder",
  "saves.action.openBackup": "Open backup folder",
  "saves.action.openBackupFolder": "Open backup folder",
  "saves.action.deleteBackup": "Delete backup",
  "saves.action.removeLocation": "Remove location",
  "saves.action.change": "Change…",
  "saves.settings.backupDir": "Backup folder",
  "saves.settings.title": "Save Backups",
  "saves.settings.on": "Enabled",
  "saves.settings.off": "Disabled",
  "saves.settings.storageTitle": "Storage & retention",
  "saves.settings.storageDesc": "Where snapshots live and how many to keep.",
  "saves.settings.retention": "Keep snapshots",
  "saves.settings.retentionHint": "Per game. Set to 0 to keep every snapshot.",
  "saves.settings.maintenanceTitle": "Maintenance",
  "saves.settings.maintenanceDesc": "Scan for new save locations or snapshot everything at once.",
  "saves.kpi.label": "Save backup summary",
  "saves.kpi.games": "Games",
  "saves.kpi.locations": "Locations",
  "saves.kpi.backups": "Backups",
  "saves.kpi.lastBackup": "Last backup",
  "saves.kpi.storageUsed": "Storage Used",
  "saves.kpi.never": "Never",
  "saves.kpi.missing": "{count} missing",
  "saves.kpi.attentionCount": "{count} need attention",
  "saves.kpi.installedCount": "{count} installed",
  "saves.state.protected": "Protected",
  "saves.state.stale": "Snapshot stale",
  "saves.state.never": "Never backed up",
  "saves.state.missing": "Path missing",
  "saves.state.excluded": "No locations included",
  "saves.state.notInstalled": "Not installed",
  "saves.searchPlaceholder": "Search games…",
  "saves.rail.sort": "Sort",
  "saves.rail.showing": "{count} shown",
  "saves.rail.selectAll": "Select all shown",
  "saves.rail.selectGame": "Select {name} for bulk backup",
  "saves.rail.backupSelected": "Back up {count} selected",
  "saves.rail.bulkProgress": "Backing up {done}/{total}…",
  "saves.rail.emptyTitle": "No games match",
  "saves.rail.emptyText": "Try a different search or filter.",
  "saves.rail.clearFilters": "Clear filters",
  "saves.rail.clearSearch": "Clear search",
  "saves.filter.all": "All Games",
  "saves.filter.backedUp": "Protected",
  "saves.filter.needsBackup": "Needs Backup",
  "saves.filter.attention": "Missing Locations",
  "saves.sort.attention": "Needs attention",
  "saves.sort.recent": "Latest Backup",
  "saves.sort.title": "Game Name",
  "saves.sort.count": "Snapshot Count",
  "saves.sort.oldest": "Oldest first",
  "saves.sort.size": "Largest first",
  "saves.sortGames": "Sort games",
  "saves.sortSnapshots": "Sort snapshots",
  "saves.filterByGame": "Filter by game",
  "saves.filterByType": "Filter by type",
  "saves.pane.emptyTitle": "Choose a game",
  "saves.pane.emptyText": "Select a game on the left to see its save locations and snapshots.",
  "saves.pane.openGame": "Open game page",
  "saves.pane.locationsDetail": "{total} total",
  "saves.pane.missingPaths": "Missing paths",
  "saves.pane.noIncluded": "No locations included",
  "saves.pane.recentSnapshots": "Recent snapshots",
  "saves.pane.viewAll": "View all",
  "saves.pane.statsLabel": "This game's save backup figures",
  "saves.game.locations": "{count} locations",
  "saves.game.lastBackup": "last backed up {when}",
  "saves.game.noBackup": "never backed up",
  "saves.game.viewHistory": "History",
  "saves.locations.title": "Save locations",
  "saves.locations.count": "{count} included",
  "saves.locations.include": "Include in backups",
  "saves.locations.untitled": "Save location",
  "saves.locations.kindFile": "File",
  "saves.locations.kindFolder": "Folder",
  "saves.locations.missing": "Missing",
  "saves.locations.missingHint": "This path no longer exists on disk.",
  "saves.locations.labelPlaceholder": "Label (optional)",
  "saves.locations.addTitle": "Add a save location",
  "saves.locations.emptyTitle": "No save locations yet",
  "saves.locations.emptyText": "Add the folder manually or run a rescan.",
  "saves.add.placeholder": "Paste or browse to a save folder or file…",
  "saves.snapshot.takeWithNote": "Snapshot with Note…",
  "saves.snapshot.notePlaceholder": "Snapshot note (optional)",
  "saves.snapshots.searchPlaceholder": "Filter snapshots by game or note…",
  "saves.snapshots.allGames": "All Games",
  "saves.snapshots.allKinds": "All Types",
  "saves.snapshots.showingCount": "{count} snapshots ({size})",
  "saves.snapshots.emptyFilter": "No snapshots match the current filters.",
  "saves.snapshots.emptyFilterText": "Try another game, type or search term.",
  "saves.snapshots.noneTitle": "No snapshots yet",
  "saves.snapshots.noneText": "Take a snapshot to protect your save files.",
  "saves.snapshots.selectAll": "Select all shown",
  "saves.snapshots.selectOne": "Select snapshot for {name}",
  "saves.snapshots.selected": "{count} selected",
  "saves.snapshots.deleteSelected": "Delete selected",
  "saves.snapshots.clearSelection": "Clear selection",
  "saves.snapshots.deleteAllForGame": "Delete all snapshots",
  "saves.snapshots.deleteAllConfirmTitle": "Delete every snapshot for {name}?",
  "saves.snapshots.deleteAllConfirmBody": "{count} snapshots will be removed from disk.",
  "saves.day.today": "Today",
  "saves.day.yesterday": "Yesterday",
  "saves.kind.manual": "Manual",
  "saves.kind.autoExit": "On exit",
  "saves.kind.preRestore": "Pre-restore",
  "saves.status.complete": "Complete",
  "saves.status.partial": "Partial",
  "saves.status.failed": "Failed",
  "saves.backups.title": "Backup history",
  "saves.backups.count": "{count} backups",
  "saves.backups.meta": "{files} files · {size}",
  "saves.source.curated": "Known game",
  "saves.source.heuristic": "Detected",
  "saves.source.steam": "Steam Cloud",
  "saves.source.emulator": "Emulator",
  "saves.source.pcgamingwiki": "PCGamingWiki",
  "saves.source.manual": "Manual",
  "saves.drawer.title": "Snapshot details",
  "saves.drawer.close": "Close details",
  "saves.drawer.clearSearch": "Clear file filter",
  "saves.drawer.error": "Could not read this snapshot's manifest.",
  "saves.drawer.missingManifest": "This snapshot has no manifest on disk.",
  "saves.drawer.search": "Filter files…",
  "saves.drawer.noFiles": "No files in this snapshot.",
  "saves.drawer.summary": "{locations} locations · {files} files · {size}",
  "saves.drawer.locationFiles": "{count} files",
  "saves.drawer.showing": "Showing {shown} of {total}",
  "saves.confirm.restoreTitle": "Restore {name}?",
  "saves.confirm.restoreMessage": "This replaces the game's current save files with the snapshot from {when}.",
  "saves.confirm.restoreWarning": "Close the game first.",
  "saves.confirm.deleteTitle": "Delete this backup?",
  "saves.confirm.deleteMessage": "The snapshot files are removed from disk. This cannot be undone.",
  "saves.confirm.bulkDeleteTitle": "Delete {count} snapshots?",
  "saves.confirm.bulkDeleteMessage": "The selected snapshot files are removed from disk.",
  "saves.confirm.backupAllTitle": "Back up {count} games now?",
  "saves.confirm.backupAllMessage": "A new snapshot will be written for every game with included save locations.",
  "saves.confirm.backupAllMore": "+{count} more games",
  "saves.page.disabledTitle": "Save Backups are turned off",
  "saves.page.disabledText": "Enable the Save Backups suite in Settings.",
  "saves.page.disabledDesc": "This feature is currently disabled.",
  "saves.progress.working": "Working…",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.retry": "Try Again",
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, string | number>) => {
      const template = LABELS[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_match: string, name: string) =>
        vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
      );
    },
  }),
}));

const GAMES = vi.hoisted(() => ([
  {
    id: "game-1",
    name: "Cyberpunk 2077",
    path: "C:/Games/Cyberpunk.exe",
    platform: "Steam",
    installed: true,
    coverArtUrl: "",
  },
  {
    id: "game-2",
    name: "Baldur's Gate 3",
    path: "C:/Games/BG3.exe",
    platform: "GOG",
    installed: true,
    coverArtUrl: "",
  },
  {
    id: "game-3",
    name: "Elden Ring",
    path: "C:/Games/EldenRing.exe",
    platform: "Steam",
    installed: false,
    coverArtUrl: "",
  },
]));

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ games: GAMES }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ showFullLinuxUi: false }),
  useWidgetVisible: () => true,
  usePageWidgetOrder: () => undefined,
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
      includePcgw: false,
      retention: 10,
      restoreSafetySnapshot: true,
      ignorePatterns: [],
      lastScanAt: 0,
    },
    summary: {
      enabled: true,
      backupDir: "C:/Games/Saves/Backups",
      gamesWithLocations: 3,
      totalLocations: 4,
      missingLocations: 1,
      totalBackups: 2,
      totalBackupBytes: 6144,
      lastBackupAt: Date.now() - 3_600_000,
      autoBackupOnExit: true,
      retention: 10,
    },
    progress: null,
    refresh: vi.fn(async () => undefined),
    scanAll: vi.fn(async () => undefined),
    restoreBackup: mocks.restoreBackup,
    deleteBackup: mocks.deleteBackup,
    openBackup: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    openLocation: vi.fn(async () => undefined),
    pickBackupDir: vi.fn(async () => undefined),
    updateSettings: vi.fn(async () => undefined),
  }),
}));

vi.mock("../../components/PageWidget", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { invoke } from "@tauri-apps/api/core";
import SavesPage from "./SavesPage";

const NOW = Date.now();

const LOCATIONS = [
  {
    id: "loc-cp",
    gameId: "game-1",
    path: "C:/Saves/Cyberpunk",
    label: "Saved Games",
    kind: "dir",
    source: "curated",
    include: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "loc-bg",
    gameId: "game-2",
    path: "C:/Saves/BG3",
    label: "Profile",
    kind: "dir",
    source: "steam",
    include: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "loc-bg-missing",
    gameId: "game-2",
    path: "D:/Missing/BG3",
    label: "Cloud backup",
    kind: "dir",
    source: "manual",
    include: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "loc-er",
    gameId: "game-3",
    path: "C:/Saves/EldenRing",
    label: "Saves",
    kind: "dir",
    source: "heuristic",
    include: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const BACKUPS = [
  {
    id: "bak-cp",
    gameId: "game-1",
    gameName: "Cyberpunk 2077",
    createdAt: NOW - 5 * 60_000,
    kind: "manual",
    note: "Before the boss",
    locationCount: 1,
    fileCount: 3,
    totalBytes: 2048,
    status: "complete",
    rootPath: "C:/Backups/cp",
    manifestPath: "",
  },
  {
    id: "bak-bg",
    gameId: "game-2",
    gameName: "Baldur's Gate 3",
    createdAt: NOW - 8 * 86_400_000,
    kind: "auto-exit",
    note: "",
    locationCount: 2,
    fileCount: 12,
    totalBytes: 4096,
    status: "complete",
    rootPath: "C:/Backups/bg3",
    manifestPath: "",
  },
];

const HEALTH = [
  { id: "loc-cp", exists: true },
  { id: "loc-bg", exists: true },
  { id: "loc-bg-missing", exists: false },
  { id: "loc-er", exists: true },
];

function mockSuccess() {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "saves_list_all_locations") return LOCATIONS;
    if (command === "saves_list_backups") return BACKUPS;
    if (command === "saves_location_health") return HEALTH;
    if (command === "saves_get_backup_manifest") {
      return {
        format: "gameindex.save-backup",
        version: 1,
        gameId: "game-2",
        gameName: "Baldur's Gate 3",
        createdAt: NOW - 8 * 86_400_000,
        kind: "auto-exit",
        note: "",
        locations: [
          {
            index: 0,
            path: "C:/Saves/BG3",
            kind: "dir",
            label: "Profile",
            source: "steam",
            fileCount: 1,
            totalBytes: 4096,
          },
        ],
        files: [{ locationIndex: 0, rel: "SaveGame.sav", size: 4096, modifiedMs: NOW }],
      };
    }
    if (command === "saves_backup_all") return BACKUPS;
    if (command === "saves_backup_game") return BACKUPS[0];
    return null;
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/saves"]}>
      <SavesPage />
    </MemoryRouter>,
  );
}

describe("SavesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSuccess();
  });

  it("renders the protection hub and selects the most urgent game", async () => {
    renderPage();

    expect(await screen.findByText("Save Backups")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Tracked Games/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Snapshot Timeline/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Library & Database/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Settings & Storage/ })).toBeTruthy();

    // Baldur's Gate 3 has a stale snapshot and a missing path: most urgent.
    await waitFor(() => {
      expect(screen.getAllByText("Baldur's Gate 3").length).toBeGreaterThan(1);
    });
    expect(screen.getByText("D:/Missing/BG3")).toBeTruthy();
    expect(screen.getByText("Recent snapshots")).toBeTruthy();
    expect(screen.getAllByText("Path missing").length).toBeGreaterThan(0);
  });

  it("filters the rail and switches the pane when a game is chosen", async () => {
    renderPage();
    await screen.findByText("Recent snapshots");

    fireEvent.click(screen.getByRole("button", { name: /Needs Backup/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Baldur's Gate 3/ })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /Elden Ring/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Elden Ring/ }));
    await waitFor(() => {
      expect(screen.getAllByText("Elden Ring").length).toBeGreaterThan(1);
    });
    expect(screen.getByText("C:/Saves/EldenRing")).toBeTruthy();
    expect(screen.getAllByText("Never backed up").length).toBeGreaterThan(0);
  });

  it("opens a snapshot and shows its manifest files", async () => {
    renderPage();
    await screen.findByText("Recent snapshots");

    fireEvent.click(screen.getByRole("button", { name: /On exit/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Snapshot details")).toBeTruthy();
    expect(await within(dialog).findByText("SaveGame.sav")).toBeTruthy();
    expect(within(dialog).getByText("C:/Saves/BG3")).toBeTruthy();
  });

  it("toggles a save location from the pane", async () => {
    renderPage();
    await screen.findByText("D:/Missing/BG3");

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Include in backups" })[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("saves_update_location", {
        location: expect.objectContaining({ id: "loc-bg", include: false }),
      });
    });
  });

  it("groups snapshots by day and deletes a selected snapshot", async () => {
    renderPage();
    await screen.findByText("Recent snapshots");
    fireEvent.click(screen.getByRole("tab", { name: /Snapshot Timeline/ }));

    expect(await screen.findByText("Today")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select snapshot for Baldur's Gate 3" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this backup?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mocks.deleteBackup).toHaveBeenCalledWith("bak-bg");
    });
  });

  it("confirms a library-wide backup with the list of games", async () => {
    renderPage();
    await screen.findByText("Recent snapshots");

    fireEvent.click(screen.getByRole("button", { name: "Back up all" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Back up 3 games now?")).toBeTruthy();
    expect(within(dialog).getByText("Cyberpunk 2077")).toBeTruthy();
    expect(within(dialog).getByText("Elden Ring")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Back up all" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("saves_backup_all");
    });
  });

  it("renders a recoverable empty state when the library cannot be read", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("database unavailable"));
    renderPage();

    expect(await screen.findByText("Could not read the save backup library.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
    expect(screen.getByText("No save locations found yet")).toBeTruthy();
  });
});
