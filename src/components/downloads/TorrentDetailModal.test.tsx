import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TorrentDetail, TorrentDownload } from "../../types/download";
import TorrentDetailModal from "./TorrentDetailModal";

const getTorrentDetail = vi.fn();

vi.mock("../../context/DownloadContext", () => ({
  useDownloads: () => ({ getTorrentDetail }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function makeDownload(): TorrentDownload {
  return {
    id: "dl_1",
    kind: "torrent",
    name: "Example Torrent",
    sourceUri: "magnet:?xt=urn:btih:aaaa",
    savePath: "C:/Downloads",
    downloaded: 100,
    totalSize: 1000,
    progress: 0.1,
    downloadSpeed: 10,
    uploadSpeed: 0,
    peers: 2,
    seeds: 1,
    status: { kind: "downloading" },
    gameId: null,
    sourceName: "Example",
    addedAt: 1_700_000_000,
    files: [],
  };
}

function makeDetail(): TorrentDetail {
  return {
    id: "dl_1",
    infoHash: "000102030405060708090a0b0c0d0e0f10111213",
    name: "Example Torrent",
    magnetUri: "magnet:?xt=urn:btih:aaaa",
    savePath: "C:/Downloads",
    sourceName: "Example",
    status: { kind: "downloading" },
    totalSize: 1000,
    downloaded: 100,
    uploaded: 0,
    ratio: 0,
    downloadSpeed: 10,
    uploadSpeed: 0,
    peers: 2,
    seeds: 1,
    peakSpeed: 20,
    addedAt: 1_700_000_000,
    completedAt: null,
    breakdown: {
      live: 2,
      liveTcp: 2,
      liveUtp: 0,
      queued: 0,
      connecting: 1,
      dead: 0,
      seen: 5,
      etaSecs: 90,
      averagePieceMs: 250,
    },
    peerList: [
      {
        address: "203.0.113.7:6881",
        state: "live",
        client: "qBittorrent 4.6",
        connection: "tcp",
        downloaded: 100,
        uploaded: 0,
        pieces: 3,
        errors: 0,
      },
    ],
    trackers: ["https://tracker.example/announce"],
    files: [{ name: "game.iso", size: 1000, downloaded: 100, progress: 0.1, selected: true }],
    onlyFiles: null,
    stalled: false,
  };
}

describe("TorrentDetailModal", () => {
  beforeEach(() => {
    getTorrentDetail.mockReset();
  });

  it("renders the overview with the info hash once the detail resolves", async () => {
    getTorrentDetail.mockResolvedValue(makeDetail());
    render(<TorrentDetailModal download={makeDownload()} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("000102030405060708090a0b0c0d0e0f10111213")).toBeInTheDocument(),
    );
    expect(screen.getByText("torrentDetail.infoHash")).toBeInTheDocument();
  });

  it("shows the unavailable hint when the torrent is not active", async () => {
    getTorrentDetail.mockRejectedValue(new Error("This torrent is not active in the engine."));
    render(<TorrentDetailModal download={makeDownload()} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("torrentDetail.unavailable")).toBeInTheDocument(),
    );
  });
});
