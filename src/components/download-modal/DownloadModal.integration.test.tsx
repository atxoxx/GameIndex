import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { invokeMock, results, pluginResults } = vi.hoisted(() => {
  const results = [
    {
      sourceName: "AlphaSource",
      sourceId: "alpha",
      title: "Alpha Title",
      fileSize: "10 GB",
      uris: ["magnet:?xt=urn:btih:aaa"],
      magnet: "magnet:?xt=urn:btih:aaa",
      uploadDate: "2020-01-01T00:00:00Z",
      matchScore: 0.9,
      isNew: false,
      seeds: 5,
      peers: 1,
      provider: "source" as const,
    },
    {
      sourceName: "BetaSource",
      sourceId: "beta",
      title: "Beta Title",
      fileSize: "50 GB",
      uris: ["magnet:?xt=urn:btih:bbb"],
      magnet: "magnet:?xt=urn:btih:bbb",
      uploadDate: "2024-01-01T00:00:00Z",
      matchScore: 0.8,
      isNew: false,
      seeds: 50,
      peers: 2,
      provider: "source" as const,
    },
    {
      sourceName: "GammaSource",
      sourceId: "gamma",
      title: "Gamma Title",
      fileSize: "1 GB",
      uris: ["magnet:?xt=urn:btih:ccc"],
      magnet: "magnet:?xt=urn:btih:ccc",
      uploadDate: "2022-01-01T00:00:00Z",
      matchScore: 0.7,
      isNew: false,
      seeds: 1,
      peers: 1,
      provider: "source" as const,
    },
  ];
  const invokeMock = vi.fn((cmd: string) => {
    if (cmd === "check_ownership" || cmd === "check_ownership_for_ids") {
      return Promise.resolve({
        owned: false,
        stores: [],
      });
    }
    return Promise.resolve(null);
  });
  const pluginResults = [
    {
      sourceName: "PluginA",
      sourceId: "plugina",
      pluginId: "plugina",
      title: "Plugin Alpha",
      fileSize: "2 GB",
      uris: ["magnet:?xt=urn:btih:pa"],
      magnet: "magnet:?xt=urn:btih:pa",
      uploadDate: "2023-01-01T00:00:00Z",
      matchScore: 0.9,
      isNew: false,
      seeds: 10,
      peers: 1,
      provider: "plugin" as const,
    },
    {
      sourceName: "PluginB",
      sourceId: "pluginb",
      pluginId: "pluginb",
      title: "Plugin Beta",
      fileSize: "30 GB",
      uris: ["magnet:?xt=urn:btih:pb"],
      magnet: "magnet:?xt=urn:btih:pb",
      uploadDate: "2021-01-01T00:00:00Z",
      matchScore: 0.7,
      isNew: false,
      seeds: 20,
      peers: 1,
      provider: "plugin" as const,
    },
  ];
  return { invokeMock, results, pluginResults };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string) => k, language: "en" }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../context/GameContext", () => ({
  useGames: () => ({ games: [] }),
}));

vi.mock("../../context/DownloadContext", () => ({
  useDownloads: () => ({
    addDownload: vi.fn(),
    addDirectDownload: vi.fn(),
    addDebridDownload: vi.fn(),
    startSelectedDownload: vi.fn(),
    selectSavePath: vi.fn(),
    defaultDownloadPath: "C:/Downloads",
    activeDownloads: [],
    completedDownloads: [],
    history: [],
    debridProvider: "none",
    debridApiKey: "",
  }),
}));

vi.mock("../../hooks/useGameUpdateCheck", () => ({
  useGameUpdateCheck: () => ({ installedVersion: null }),
}));

vi.mock("../../context/SourceContext", () => ({
  searchDownloadsStream: vi.fn(
    async (
      _q: string,
      _id: number | undefined,
      onProgress?: (e: unknown) => void,
    ) => {
      onProgress?.({
        searchId: "s1",
        sourceName: "AlphaSource",
        completedSources: 3,
        totalSources: 3,
        newResults: results,
        isDone: true,
      });
      return results;
    },
  ),
}));

vi.mock("../ui/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

import DownloadModal from "./DownloadModal";
import { searchDownloadsStream } from "../../context/SourceContext";

const streamMock = searchDownloadsStream as unknown as ReturnType<typeof vi.fn>;

function titlesInOrder(): string[] {
  return Array.from(document.querySelectorAll(".dl-result-title")).map(
    (el) => el.textContent ?? "",
  );
}

function emitSearch(newResults: unknown[]) {
  streamMock.mockImplementation(
    async (
      _q: string,
      _id: number | undefined,
      onProgress?: (e: unknown) => void,
    ) => {
      onProgress?.({
        searchId: "s1",
        sourceName: "Source",
        completedSources: 1,
        totalSources: 1,
        newResults,
        isDone: true,
      });
      return newResults;
    },
  );
}

describe("DownloadModal sorting", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockClear();
    emitSearch(results);
  });

  it("reorders source results when a sort option is chosen", async () => {
    render(<DownloadModal gameName="Test Game" onClose={() => {}} />);

    await waitFor(() => {
      expect(titlesInOrder().length).toBe(3);
    });

    // Default (recommended): Beta (recent + many seeds), then Alpha, then Gamma
    expect(titlesInOrder()).toEqual(["Beta Title", "Alpha Title", "Gamma Title"]);

    // Open the filter popover
    fireEvent.click(screen.getByText("downloadModal.filtersButton"));

    const sortSelect = screen.getByLabelText(
      "downloads.sortResultsAria",
    ) as HTMLSelectElement;

    // Sort by date (newest): Beta 2024, Gamma 2022, Alpha 2020
    fireEvent.change(sortSelect, { target: { value: "date" } });
    await waitFor(() => {
      expect(titlesInOrder()).toEqual(["Beta Title", "Gamma Title", "Alpha Title"]);
    });
  });

  it("reorders plugin results when a sort option is chosen", async () => {
    emitSearch(pluginResults);

    render(<DownloadModal gameName="Test Game" onClose={() => {}} />);

    await waitFor(() => {
      expect(titlesInOrder().length).toBe(2);
    });

    // Default (recommended): Plugin Alpha scores higher.
    expect(titlesInOrder()).toEqual(["Plugin Alpha", "Plugin Beta"]);

    fireEvent.click(screen.getByText("downloadModal.filtersButton"));
    const sortSelect = screen.getByLabelText(
      "downloads.sortResultsAria",
    ) as HTMLSelectElement;

    // Sort by size (large -> small): Plugin Beta 30, Plugin Alpha 2.
    fireEvent.change(sortSelect, { target: { value: "size_desc" } });
    await waitFor(() => {
      expect(titlesInOrder()).toEqual(["Plugin Beta", "Plugin Alpha"]);
    });
  });
});
