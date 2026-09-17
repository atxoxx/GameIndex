import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SourceProvider, useSources } from "./SourceContext";
import type { SourceLink } from "../types/source";

const { invokeMock, showToastMock, tMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  showToastMock: vi.fn(),
  tMock: vi.fn((key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ t: tMock }) }));

const consoleSpies: Array<{ mockRestore: () => void }> = [];

function makeSource(overrides: Partial<SourceLink> = {}): SourceLink {
  return {
    id: "s1",
    url: "https://example.test/sources.json",
    name: "Repo One",
    enabled: true,
    lastFetched: null,
    gameCount: 0,
    ...overrides,
  };
}

function installInvoke(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  const table: Record<string, (args?: unknown) => unknown> = {
    sources_list: () => [],
    ...handlers,
  };
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    const handler = table[cmd];
    return handler ? handler(args) : undefined;
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SourceProvider>{children}</SourceProvider>
);

function renderSourcesHook() {
  return renderHook(() => useSources(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  showToastMock.mockReset();
  tMock.mockClear();
  consoleSpies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
  installInvoke();
});

afterEach(() => {
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("SourceProvider", () => {
  it("hydrates the source list from sources_list and clears loading (happy path)", async () => {
    const list = [
      makeSource({ id: "s1", name: "Repo One", gameCount: 4 }),
      makeSource({ id: "s2", name: "Repo Two", enabled: false }),
    ];
    installInvoke({ sources_list: () => list });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sources).toEqual(list);
  });

  it("flips a source's enabled flag optimistically through sources_toggle (happy path)", async () => {
    installInvoke({
      sources_list: () => [makeSource({ id: "s1", enabled: true })],
      sources_toggle: () => undefined,
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(1));

    await act(async () => {
      await result.current.toggleSource("s1");
    });

    expect(result.current.sources[0].enabled).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("sources_toggle", { id: "s1" });
  });

  it("drops a removed source from the cache (happy path)", async () => {
    installInvoke({
      sources_list: () => [makeSource({ id: "s1" }), makeSource({ id: "s2" })],
      sources_remove: () => undefined,
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(2));

    await act(async () => {
      await result.current.removeSource("s1");
    });

    expect(result.current.sources.map((s) => s.id)).toEqual(["s2"]);
    expect(invokeMock).toHaveBeenCalledWith("sources_remove", { id: "s1" });
  });

  it("re-pulls the authoritative list after adding a source (happy path)", async () => {
    const created = makeSource({ id: "s9", name: "Fresh", gameCount: 0 });
    const authoritative = [makeSource({ id: "s9", name: "Fresh", gameCount: 12 })];
    let listCalls = 0;
    installInvoke({
      sources_list: () => (++listCalls === 1 ? [] : authoritative),
      sources_add: () => created,
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([]);

    let returned: SourceLink | undefined;
    await act(async () => {
      returned = await result.current.addSource("https://example.test/fresh.json", "Fresh");
    });

    expect(returned).toEqual(created);
    expect(result.current.sources).toEqual(authoritative);
    expect(invokeMock).toHaveBeenCalledWith("sources_add", {
      url: "https://example.test/fresh.json",
      name: "Fresh",
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.added"),
      "success",
    );
  });

  it("falls back to appending the created source when the re-pull fails (error path)", async () => {
    const created = makeSource({ id: "s9", name: "Fresh" });
    let listCalls = 0;
    installInvoke({
      sources_list: () => {
        listCalls += 1;
        if (listCalls === 1) return [];
        throw new Error("list unavailable");
      },
      sources_add: () => created,
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addSource("https://example.test/fresh.json", "Fresh");
    });

    expect(result.current.sources).toEqual([created]);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.added"),
      "success",
    );
  });

  it("dedupes concurrent refreshAllSources calls into one backend refresh (happy path)", async () => {
    let refreshAllCalls = 0;
    installInvoke({
      sources_refresh_all: () => {
        refreshAllCalls += 1;
        return undefined;
      },
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const first = result.current.refreshAllSources();
      const second = result.current.refreshAllSources();
      await Promise.all([first, second]);
    });

    expect(refreshAllCalls).toBe(1);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.allRefreshed"),
      "success",
    );
  });

  it("surfaces a load failure toast and keeps the empty state (error path)", async () => {
    installInvoke({
      sources_list: () => {
        throw new Error("offline");
      },
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sources).toEqual([]);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.loadFailed"),
      "error",
    );
  });

  it("toasts and rethrows when refreshing a single source fails (error path)", async () => {
    installInvoke({
      sources_list: () => [],
      sources_refresh: () => {
        throw new Error("fetch failed");
      },
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.refreshSource("s1")).rejects.toThrow("fetch failed");
    });

    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.refreshFailed"),
      "error",
    );
  });

  it("toasts and rethrows when refreshing all sources fails, then allows a retry (error path)", async () => {
    let attempts = 0;
    installInvoke({
      sources_refresh_all: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("bulk refresh failed");
        return undefined;
      },
    });

    const { result } = renderSourcesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.refreshAllSources()).rejects.toThrow(
        "bulk refresh failed",
      );
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("sourceContext.refreshFailed"),
      "error",
    );

    await act(async () => {
      await result.current.refreshAllSources();
    });
    expect(attempts).toBe(2);
  });
});
