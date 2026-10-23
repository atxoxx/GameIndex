import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DownloadHistory } from "../../types/download";
import DownloadsHistoryTab from "./DownloadsHistoryTab";

const invoke = vi.fn();
const showToast = vi.fn();
const copyTextToClipboard = vi.fn();
let history: DownloadHistory[] = [];

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

vi.mock("../../context/DownloadContext", () => ({
  useDownloads: () => ({ history, refreshHistory: vi.fn(), loading: false }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("../../hooks/useSizeUnit", () => ({
  useSizeUnit: () => ({ unit: "gb" }),
}));

vi.mock("../../utils/clipboard", () => ({
  copyTextToClipboard: (...args: unknown[]) => copyTextToClipboard(...args),
}));

vi.mock("../ui", () => ({
  ConfirmModal: () => null,
}));

function noonToday(): number {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function makeRow(overrides: Partial<DownloadHistory> = {}): DownloadHistory {
  return {
    id: 1,
    downloadId: "dl_1",
    kind: "torrent",
    name: "Example download",
    sourceName: "Example",
    savePath: "D:/Games/Example",
    downloaded: 1000,
    totalSize: 2000,
    status: { kind: "completed" },
    debridCached: null,
    autoExtract: null,
    extracted: null,
    addedAt: noonToday() - 600,
    completedAt: noonToday(),
    peakSpeed: 100,
    ...overrides,
  };
}

describe("DownloadsHistoryTab", () => {
  beforeEach(() => {
    invoke.mockReset();
    showToast.mockReset();
    copyTextToClipboard.mockReset();
    history = [
      makeRow({ id: 1, downloadId: "dl_1", name: "Today completed" }),
      makeRow({
        id: 2,
        downloadId: "dl_2",
        name: "Today removed",
        status: { kind: "removed" },
        completedAt: noonToday() - 3600,
      }),
      makeRow({
        id: 3,
        downloadId: "dl_3",
        name: "Yesterday completed",
        completedAt: noonToday() - 86_400,
        addedAt: noonToday() - 90_000,
      }),
    ];
  });

  it("groups rows under today and yesterday", () => {
    render(<DownloadsHistoryTab />);

    expect(screen.getByText("downloads.today")).toBeInTheDocument();
    expect(screen.getByText("downloads.yesterday")).toBeInTheDocument();
    expect(screen.getByText("Today completed")).toBeInTheDocument();
    expect(screen.getByText("Today removed")).toBeInTheDocument();
    expect(screen.getByText("Yesterday completed")).toBeInTheDocument();
  });

  it("filters the ledger by status", () => {
    render(<DownloadsHistoryTab />);

    fireEvent.click(screen.getByRole("button", { name: /downloadsFilter.statusCompleted/ }));

    expect(screen.getByText("Today completed")).toBeInTheDocument();
    expect(screen.queryByText("Today removed")).not.toBeInTheDocument();
  });

  it("opens the destination folder and reports the failure", async () => {
    invoke.mockResolvedValueOnce(undefined);
    render(<DownloadsHistoryTab />);

    fireEvent.click(screen.getAllByRole("button", { name: "downloadRow.openFolder" })[0]);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_folder", { path: "D:/Games/Example" }),
    );
    expect(showToast).not.toHaveBeenCalled();

    invoke.mockRejectedValueOnce(new Error("no such folder"));
    fireEvent.click(screen.getAllByRole("button", { name: "downloadRow.openFolder" })[0]);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "downloadRow.openFolderFailed",
        "error",
      ),
    );
  });
});
