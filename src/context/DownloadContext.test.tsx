import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  DownloadProvider,
  useActiveDownloadCount,
  useDownloads,
} from "./DownloadContext";
import type { DownloadHistory, TorrentDownload } from "../types/download";

const { invokeMock, listenMock, listeners, showToastMock, tMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    invokeMock: vi.fn(),
    listenMock: vi.fn(
      async (event: string, cb: (event: { payload: unknown }) => void) => {
        listeners.set(event, cb);
        return () => listeners.delete(event);
      },
    ),
    listeners,
    showToastMock: vi.fn(),
    tMock: vi.fn((key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("./ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ t: tMock }) }));

const consoleSpies: Array<{ mockRestore: () => void }> = [];

function makeDownload(overrides: Partial<TorrentDownload> = {}): TorrentDownload {
  return {
    id: "d1",
    kind: "torrent",
    name: "Sample",
    sourceUri: "magnet:?xt=urn:btih:abc",
    savePath: "C:/downloads",
    downloaded: 0,
    totalSize: 1000,
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    seeds: 0,
    status: { kind: "downloading" },
    gameId: null,
    sourceName: "Test",
    addedAt: 1,
    files: [],
    ...overrides,
  };
}

function makeHistory(overrides: Partial<DownloadHistory> = {}): DownloadHistory {
  return {
    id: 1,
    downloadId: "d-done",
    kind: "torrent",
    name: "Done",
    sourceName: "Test",
    savePath: "C:/downloads",
    downloaded: 1000,
    totalSize: 1000,
    status: { kind: "completed" },
    debridCached: null,
    autoExtract: null,
    extracted: null,
    addedAt: 1,
    completedAt: 2,
    peakSpeed: 0,
    ...overrides,
  };
}

function installInvoke(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  const table: Record<string, (args?: unknown) => unknown> = {
    torrent_get_all: () => [],
    download_history_get: () => [],
    ...handlers,
  };
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    const handler = table[cmd];
    return handler ? handler(args) : undefined;
  });
}

function emitProgress(payload: unknown) {
  const handler = listeners.get("download-progress");
  if (!handler) throw new Error("download-progress listener was not registered");
  act(() => {
    handler({ payload });
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadProvider>{children}</DownloadProvider>
);

function renderDownloadsHook() {
  return renderHook(() => useDownloads(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  listenMock.mockClear();
  showToastMock.mockReset();
  tMock.mockClear();
  consoleSpies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
  consoleSpies.push(vi.spyOn(console, "warn").mockImplementation(() => {}));
  consoleSpies.push(vi.spyOn(console, "debug").mockImplementation(() => {}));
  installInvoke();
});

afterEach(() => {
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("DownloadProvider queue state", () => {
  it("hydrates from torrent_get_all and sorts active downloads before completed (happy path)", async () => {
    installInvoke({
      torrent_get_all: () => [
        makeDownload({ id: "d-active-old", addedAt: 1, status: { kind: "downloading" } }),
        makeDownload({ id: "d-done", addedAt: 2, status: { kind: "completed" } }),
        makeDownload({ id: "d-active-new", addedAt: 3, status: { kind: "paused" } }),
      ],
      download_history_get: () => [makeHistory()],
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.downloads.map((d) => d.id)).toEqual([
      "d-active-new",
      "d-active-old",
      "d-done",
    ]);
    expect(result.current.activeDownloads.map((d) => d.id)).toEqual([
      "d-active-new",
      "d-active-old",
    ]);
    expect(result.current.completedDownloads.map((d) => d.id)).toEqual(["d-done"]);
    expect(result.current.activeCount).toBe(2);
    expect(result.current.history).toHaveLength(1);
  });

  it("keeps several active downloads side by side (single-active enforcement is backend-owned)", async () => {
    installInvoke({
      torrent_get_all: () => [
        makeDownload({ id: "a", addedAt: 1, status: { kind: "downloading" } }),
        makeDownload({ id: "b", addedAt: 2, status: { kind: "queued" } }),
        makeDownload({ id: "c", addedAt: 3, status: { kind: "fetchingMetadata" } }),
      ],
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeCount).toBe(3);
    expect(result.current.completedDownloads).toHaveLength(0);
  });

  it("inserts a newly added download at the top and dedupes by id (happy path)", async () => {
    const created = makeDownload({ id: "new-1", name: "New", addedAt: 99 });
    installInvoke({ torrent_add: () => created });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addDownload("magnet:x", "C:/dl", "game-9", "Source");
    });
    expect(result.current.downloads.map((d) => d.id)).toEqual(["new-1"]);

    await act(async () => {
      await result.current.addDownload("magnet:x", "C:/dl");
    });
    expect(result.current.downloads).toHaveLength(1);

    expect(invokeMock).toHaveBeenCalledWith(
      "torrent_add",
      expect.objectContaining({
        magnetUri: "magnet:x",
        savePath: "C:/dl",
        gameId: "game-9",
        sourceName: "Source",
      }),
    );
  });

  it("removes a download immediately and reloads history (happy path)", async () => {
    installInvoke({
      torrent_get_all: () => [makeDownload({ id: "d1" })],
      torrent_remove: () => undefined,
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));
    invokeMock.mockClear();

    await act(async () => {
      await result.current.removeDownload("d1", true);
    });

    expect(result.current.downloads).toHaveLength(0);
    expect(invokeMock).toHaveBeenCalledWith("torrent_remove", {
      id: "d1",
      deleteFiles: true,
    });
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "download_history_get"),
    ).toHaveLength(1);
  });

  it("flips status optimistically on pause and resume (happy path)", async () => {
    installInvoke({
      torrent_get_all: () => [makeDownload({ id: "d1", status: { kind: "downloading" } })],
      torrent_pause: () => undefined,
      torrent_resume: () => undefined,
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));

    await act(async () => {
      await result.current.pauseDownload("d1");
    });
    expect(result.current.downloads[0].status).toEqual({ kind: "paused" });
    expect(result.current.downloads[0].downloadSpeed).toBe(0);

    await act(async () => {
      await result.current.resumeDownload("d1");
    });
    expect(result.current.downloads[0].status).toEqual({ kind: "downloading" });

    expect(invokeMock).toHaveBeenCalledWith("torrent_pause", { id: "d1" });
    expect(invokeMock).toHaveBeenCalledWith("torrent_resume", { id: "d1" });
  });

  it("returns the backend counts from pauseAll and resumeAll (happy path)", async () => {
    installInvoke({ torrent_pause_all: () => 3, torrent_resume_all: () => 1 });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.pauseAll()).toBe(3);
      expect(await result.current.resumeAll()).toBe(1);
    });

    expect(invokeMock).toHaveBeenCalledWith("torrent_pause_all");
    expect(invokeMock).toHaveBeenCalledWith("torrent_resume_all");
  });

  it("persists the seed-after-complete preference to localStorage and the backend (happy path)", async () => {
    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setSeedConfig(true);
    });

    expect(result.current.seedAfterComplete).toBe(true);
    expect(localStorage.getItem("gamelib-seed-after-complete")).toBe("true");
    expect(invokeMock).toHaveBeenCalledWith("download_set_seed_config", {
      seedAfterComplete: true,
    });
  });

  it("restores engine truth and rejects when pause fails (error path)", async () => {
    installInvoke({
      torrent_get_all: () => [makeDownload({ id: "d1", status: { kind: "downloading" } })],
      torrent_pause: () => {
        throw new Error("pause failed");
      },
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));
    const refreshesBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "torrent_get_all",
    ).length;

    await act(async () => {
      await expect(result.current.pauseDownload("d1")).rejects.toThrow("pause failed");
    });

    await waitFor(() =>
      expect(result.current.downloads[0].status.kind).toBe("downloading"),
    );
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "torrent_get_all").length,
    ).toBeGreaterThan(refreshesBefore);
  });

  it("reconciles from the engine and rejects when removal fails (error path)", async () => {
    installInvoke({
      torrent_get_all: () => [makeDownload({ id: "d1" })],
      torrent_remove: () => {
        throw new Error("remove failed");
      },
    });

    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));

    await act(async () => {
      await expect(result.current.removeDownload("d1")).rejects.toThrow("remove failed");
    });

    await waitFor(() => expect(result.current.downloads).toHaveLength(1));
  });

  it("applies download-progress snapshots and tolerates malformed payloads (error path)", async () => {
    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    emitProgress("not-an-array");
    emitProgress({ unexpected: true });
    expect(result.current.downloads).toHaveLength(0);

    emitProgress([
      makeDownload({ id: "d1", progress: 0.25, status: { kind: "downloading" } }),
    ]);
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));
    expect(result.current.downloads[0].progress).toBe(0.25);

    emitProgress([
      { id: "partial", status: { kind: "downloading" } } as unknown as TorrentDownload,
    ]);
    await waitFor(() =>
      expect(result.current.downloads.map((d) => d.id)).toEqual(["partial"]),
    );
    expect(result.current.activeCount).toBe(1);
  });

  it("ignores progress entries without a status and still renders (error path)", async () => {
    function Probe() {
      const { downloads, activeCount, completedDownloads } = useDownloads();
      return (
        <span data-testid="probe">
          {`${activeCount}:${completedDownloads.length}:${downloads.map((d) => d.id).join(",")}`}
        </span>
      );
    }

    render(
      <DownloadProvider>
        <Probe />
      </DownloadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("0:0:"));

    emitProgress([
      { id: "ghost", name: "Ghost", progress: 0.5 } as unknown as TorrentDownload,
      makeDownload({ id: "d1", status: { kind: "downloading" } }),
    ]);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("1:0:d1"));

    emitProgress([{ id: "ghost-only" } as unknown as TorrentDownload]);
    expect(screen.getByTestId("probe")).toHaveTextContent("1:0:d1");
  });

  it("skips byte-identical progress ticks via the fingerprint (happy path)", async () => {
    const renders = { n: 0 };
    function Probe() {
      const { downloads } = useDownloads();
      renders.n += 1;
      return <span data-testid="progress">{downloads.map((d) => d.progress).join(",")}</span>;
    }

    render(
      <DownloadProvider>
        <Probe />
      </DownloadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("progress")).toHaveTextContent(""));

    const payload = [
      makeDownload({ id: "d1", progress: 0.4, status: { kind: "downloading" } }),
    ];
    emitProgress(payload);
    await waitFor(() => expect(screen.getByTestId("progress")).toHaveTextContent("0.4"));

    const rendersAfterTick = renders.n;
    emitProgress([
      makeDownload({ id: "d1", progress: 0.4, status: { kind: "downloading" } }),
    ]);
    expect(renders.n).toBe(rendersAfterTick);
  });

  it("toasts once on the not-completed to completed transition (happy path)", async () => {
    const { result } = renderDownloadsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    emitProgress([makeDownload({ id: "d1", status: { kind: "downloading" } })]);
    await waitFor(() => expect(result.current.downloads).toHaveLength(1));
    expect(showToastMock).not.toHaveBeenCalled();

    emitProgress([
      makeDownload({ id: "d1", status: { kind: "completed" }, addedAt: 2 }),
    ]);
    await waitFor(() =>
      expect(result.current.downloads[0].status.kind).toBe("completed"),
    );
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0][1]).toBe("success");
    expect(String(showToastMock.mock.calls[0][0])).toContain("download.complete");

    emitProgress([
      makeDownload({ id: "d1", status: { kind: "completed" }, addedAt: 2 }),
    ]);
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });
});

describe("ActiveDownloadCountContext", () => {
  it("returns 0 when no provider is mounted (happy path)", () => {
    const { result } = renderHook(() => useActiveDownloadCount());
    expect(result.current).toBe(0);
  });

  it("updates only on real active-count changes, not progress churn (happy path)", async () => {
    installInvoke({
      torrent_get_all: () => [
        makeDownload({ id: "d1", status: { kind: "downloading" }, progress: 0.1 }),
      ],
    });

    const countRenders = { n: 0 };
    function CountProbe() {
      const count = useActiveDownloadCount();
      countRenders.n += 1;
      return <span data-testid="count">{count}</span>;
    }
    function FullProbe() {
      const { downloads, activeCount } = useDownloads();
      return (
        <span data-testid="full">
          {`${activeCount}:${downloads.map((d) => d.progress).join(",")}`}
        </span>
      );
    }

    render(
      <DownloadProvider>
        <CountProbe />
        <FullProbe />
      </DownloadProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(screen.getByTestId("full")).toHaveTextContent("1:0.1");

    const rendersAfterHydrate = countRenders.n;

    emitProgress([
      makeDownload({
        id: "d1",
        status: { kind: "downloading" },
        progress: 0.5,
        downloadSpeed: 2048,
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId("full")).toHaveTextContent("1:0.5"));
    expect(countRenders.n).toBe(rendersAfterHydrate);
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    emitProgress([
      makeDownload({
        id: "d1",
        status: { kind: "downloading" },
        progress: 0.5,
        downloadSpeed: 2048,
      }),
      makeDownload({ id: "d2", status: { kind: "completed" }, addedAt: 5 }),
    ]);
    await waitFor(() => expect(screen.getByTestId("full")).toHaveTextContent("1:0.5,"));
    expect(countRenders.n).toBe(rendersAfterHydrate);

    emitProgress([
      makeDownload({
        id: "d1",
        status: { kind: "downloading" },
        progress: 0.5,
        downloadSpeed: 2048,
      }),
      makeDownload({ id: "d3", status: { kind: "downloading" }, addedAt: 6 }),
    ]);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(countRenders.n).toBeGreaterThan(rendersAfterHydrate);
  });
});
