import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const { invokeMock, state } = vi.hoisted(() => {
  const state = {
    games: [] as Array<Record<string, unknown>>,
    streams: [] as Array<{
      query: string;
      emit: (event: unknown) => void;
    }>,
  };
  const invokeMock = vi.fn((cmd: string) => {
    if (cmd === "check_ownership" || cmd === "check_ownership_for_ids") {
      return Promise.resolve({ owned: false, stores: [] });
    }
    return Promise.resolve(null);
  });
  return { invokeMock, state };
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
  useGames: () => ({ games: state.games }),
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
    (
      query: string,
      _steamAppId: number | undefined,
      onProgress?: (event: unknown) => void,
    ) =>
      new Promise(() => {
        if (onProgress) state.streams.push({ query, emit: onProgress });
      }),
  ),
}));

vi.mock("../ui/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

import DownloadModal from "./DownloadModal";
import { searchDownloadsStream } from "../../context/SourceContext";

const streamMock = searchDownloadsStream as unknown as ReturnType<typeof vi.fn>;

function result(sourceName: string, title: string) {
  return {
    sourceName,
    sourceId: sourceName.toLowerCase(),
    title,
    fileSize: "10 GB",
    uris: [`magnet:?xt=urn:btih:${title}`],
    magnet: `magnet:?xt=urn:btih:${title}`,
    uploadDate: "2024-01-01T00:00:00Z",
    matchScore: 0.9,
    isNew: false,
    seeds: 5,
    peers: 1,
    provider: "source" as const,
  };
}

function progress(newResults: unknown[], isDone: boolean, completedSources = 1) {
  return {
    searchId: "s1",
    sourceName: "AlphaSource",
    completedSources,
    totalSources: 3,
    newResults,
    isDone,
  };
}

function game(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    name: "Ultrakill",
    releaseDate: "2020-03-06",
    alternativeNames: [] as string[],
    ...overrides,
  };
}

function titles(): string[] {
  return Array.from(document.querySelectorAll(".dl-result-title")).map(
    (el) => el.textContent ?? "",
  );
}

describe("DownloadModal search stability", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockClear();
    streamMock.mockClear();
    state.streams.length = 0;
    state.games = [game()];
  });

  it("keeps the visible results when library metadata updates mid-session", async () => {
    const { rerender } = render(
      <DownloadModal gameName="Ultrakill" gameId="g1" onClose={() => {}} />,
    );

    await waitFor(() => expect(state.streams).toHaveLength(1));
    await act(async () => {
      state.streams[0].emit(
        progress([result("Alpha", "First"), result("Beta", "Second")], true),
      );
    });
    await waitFor(() => expect(titles()).toEqual(["First", "Second"]));

    // The aggregate bucket comes from `extractSourceFilters`, so the rail must
    // not add a second "all sources" tab beside it.
    const tabs = Array.from(document.querySelectorAll(".dlm-sources-tab"));
    expect(tabs).toHaveLength(3);
    expect(
      tabs.filter((tab) => tab.textContent?.includes("downloadModal.allSources")),
    ).toHaveLength(1);

    // Background enrichment lands: the same game gains aliases, and another
    // library row is renamed. Both previously rebuilt `runSearch` and wiped
    // the list with a fresh search.
    state.games = [
      game({ alternativeNames: ["ULTRAKILL", "Ultra Kill"] }),
      { id: "g2", name: "Neon White" },
    ];
    rerender(
      <DownloadModal gameName="Ultrakill" gameId="g1" onClose={() => {}} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(["First", "Second"]);
  });

  it("ignores a superseded search that finishes after a newer one starts", async () => {
    const { rerender } = render(
      <DownloadModal gameName="Ultrakill" gameId="g1" onClose={() => {}} />,
    );

    await waitFor(() => expect(state.streams).toHaveLength(1));
    await act(async () => {
      state.streams[0].emit(progress([result("Alpha", "Ultrakill build 1")], true));
    });
    await waitFor(() => expect(titles()).toEqual(["Ultrakill build 1"]));

    // A genuinely different game is requested while the old stream is still
    // open: the old stream's events must not resurrect its rows or flip the
    // step out of the new search.
    rerender(
      <DownloadModal gameName="Neon White" gameId="g2" onClose={() => {}} />,
    );
    await waitFor(() => expect(state.streams).toHaveLength(2));

    await act(async () => {
      state.streams[0].emit(
        progress([result("Alpha", "Stale Ultrakill row")], true, 2),
      );
    });
    expect(titles()).toEqual([]);

    await act(async () => {
      state.streams[1].emit(progress([result("Beta", "Neon White build 1")], true));
    });
    await waitFor(() => expect(titles()).toEqual(["Neon White build 1"]));
  });
});
