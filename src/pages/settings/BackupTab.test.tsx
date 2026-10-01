import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BackupTab from "./BackupTab";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: (fn: () => void) => ({
    ref: vi.fn(),
    tabIndex: 0,
    onClick: fn,
    onKeyDown: vi.fn(),
  }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({
    showFullLinuxUi: false,
  }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

import { invoke } from "@tauri-apps/api/core";

describe("BackupTab Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "backup_get_status") {
        return {
          lastBackupAt: 1700000000,
          domains: [
            { name: "games", itemCount: 10, sizeBytes: 2048 },
            { name: "sessions", itemCount: 5, sizeBytes: 1024 },
          ],
        };
      }
      if (cmd === "backup_get_config") {
        return {
          backupDir: "C:/Games/Backups",
          retentionCount: 10,
          safetyBackupBeforeRestore: true,
        };
      }
      if (cmd === "backup_list_archives") {
        return [
          {
            path: "C:/Games/Backups/backup-1.gamelib-backup",
            filename: "backup-1.gamelib-backup",
            sizeBytes: 4096,
            createdAt: 1700000000,
          },
        ];
      }
      return null;
    });
  });

  it("renders subtabs navigation correctly", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/backup"]}>
        <BackupTab />
      </MemoryRouter>,
    );

    expect(screen.getByText("Overview & Snapshots")).toBeDefined();
    expect(screen.getAllByText("Create Backup").length).toBeGreaterThan(0);
    expect(screen.getByText("Restore & Inspect")).toBeDefined();
    expect(screen.getByText("Storage & Automation")).toBeDefined();
  });
});
