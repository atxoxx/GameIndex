import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TorrentDownload } from "../../types/download";
import DownloadRow from "./DownloadRow";

const onPause = vi.fn();
const onResume = vi.fn();
const onRemove = vi.fn();
const onDeleteFiles = vi.fn();
const retryDownload = vi.fn();
const setSeeding = vi.fn();

vi.mock("../../hooks/useSizeUnit", () => ({
  useSizeUnit: () => ({ unit: "gb" }),
}));

vi.mock("../../hooks/useSpeedUnit", () => ({
  useSpeedUnit: () => ({ unit: "bytes" }),
}));

vi.mock("../../hooks/useDownloadCoverArt", () => ({
  useDownloadCoverArt: () => ({ matchedGame: null, coverArtUrl: null }),
}));

vi.mock("../../context/DownloadContext", () => ({
  useDownloads: () => ({
    updateSelectedFiles: vi.fn(),
    setSeeding,
    retryDownload,
  }),
}));

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ launchGame: vi.fn() }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("./downloadMenu", () => ({
  useDownloadMenuItems: () => [],
}));

vi.mock("./TorrentDetailModal", () => ({
  default: () => null,
}));

function makeDownload(overrides: Partial<TorrentDownload> = {}): TorrentDownload {
  return {
    id: "dl_1",
    kind: "torrent",
    name: "Example Torrent",
    sourceUri: "magnet:?xt=urn:btih:aaaa",
    savePath: "C:/Downloads",
    downloaded: 500,
    totalSize: 1000,
    progress: 0.5,
    downloadSpeed: 10,
    uploadSpeed: 0,
    peers: 4,
    seeds: 9,
    status: { kind: "downloading" },
    gameId: null,
    sourceName: "Example",
    addedAt: 1_700_000_000,
    files: [],
    ...overrides,
  };
}

function renderRow(download: TorrentDownload) {
  return render(
    <DownloadRow
      download={download}
      onPause={onPause}
      onResume={onResume}
      onRemove={onRemove}
      onDeleteFiles={onDeleteFiles}
    />,
  );
}

describe("DownloadRow", () => {
  beforeEach(() => {
    onPause.mockClear();
    onResume.mockClear();
    retryDownload.mockReset();
  });

  it("shows the name, status and progress, and pauses from the primary action", () => {
    renderRow(makeDownload());

    expect(screen.getByText("Example Torrent")).toBeInTheDocument();
    expect(screen.getByText("download.status.downloading")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "downloadRow.pause" }));
    expect(onPause).toHaveBeenCalledWith("dl_1");
  });

  it("surfaces the failure and retries from the primary action", async () => {
    retryDownload.mockResolvedValue(undefined);
    renderRow(makeDownload({ status: { kind: "error", message: "Tracker returned 403" } }));

    expect(screen.getByRole("alert")).toHaveTextContent("Tracker returned 403");

    fireEvent.click(screen.getByRole("button", { name: "downloadRow.retry" }));
    await waitFor(() => expect(retryDownload).toHaveBeenCalledWith("dl_1"));
  });
});
