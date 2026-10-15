import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { DisplayMatch } from "./types";
import { clearSessionCache } from "./cacheCheck";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { useRowCacheChecks } from "./useRowCacheChecks";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function match(overrides: Partial<DisplayMatch> = {}): DisplayMatch {
  return {
    sourceName: "Source",
    sourceId: "s",
    title: "Game",
    fileSize: "1 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0.9,
    isNew: false,
    provider: "source",
    id: "id",
    ...overrides,
  };
}

function render(overrides: {
  matches: DisplayMatch[];
  provider?: string;
  apikey?: string;
  enabled?: boolean;
}) {
  return renderHook(() =>
    useRowCacheChecks({
      matches: overrides.matches,
      provider: overrides.provider ?? "alldebrid",
      apikey: overrides.apikey ?? "key",
      enabled: overrides.enabled ?? true,
    }),
  );
}

describe("useRowCacheChecks", () => {
  beforeEach(() => {
    clearSessionCache();
    invokeMock.mockReset();
  });

  it("probes a magnet-bearing result and reports the verdict", async () => {
    invokeMock.mockResolvedValue({ cached: true });
    const { result } = render({
      matches: [match({ id: "a", infohash: HASH_A })],
    });

    await waitFor(() => expect(result.current.get("a")).toBe("cached"));
    expect(invokeMock).toHaveBeenCalledWith(
      "debrid_check_cache",
      expect.objectContaining({ provider: "alldebrid", apikey: "key" }),
    );
  });

  it("reports uncached and ignores results with nothing to check", async () => {
    invokeMock.mockResolvedValue({ cached: false });
    const { result } = render({
      matches: [match({ id: "a", magnet: `magnet:?xt=urn:btih:${HASH_A}` }), match({ id: "b" })],
    });

    await waitFor(() => expect(result.current.get("a")).toBe("uncached"));
    expect(result.current.has("b")).toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("shares one probe across duplicate infohashes", async () => {
    invokeMock.mockResolvedValue({ cached: true });
    const { result } = render({
      matches: [match({ id: "a", infohash: HASH_A }), match({ id: "b", infohash: HASH_A })],
    });

    await waitFor(() => expect(result.current.get("b")).toBe("cached"));
    expect(result.current.get("a")).toBe("cached");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reuses session verdicts instead of re-probing", async () => {
    invokeMock.mockResolvedValue({ cached: true });
    const first = render({ matches: [match({ id: "a", infohash: HASH_A })] });
    await waitFor(() => expect(first.result.current.get("a")).toBe("cached"));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    const second = render({ matches: [match({ id: "z", infohash: HASH_A })] });
    await waitFor(() => expect(second.result.current.get("z")).toBe("cached"));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("stays idle when disabled or the provider cannot check cache", async () => {
    invokeMock.mockResolvedValue({ cached: true });
    const disabled = render({ matches: [match({ id: "a", infohash: HASH_A })], enabled: false });
    const unsupported = render({
      matches: [match({ id: "b", infohash: HASH_B })],
      provider: "realdebrid",
    });

    await waitFor(() => {
      expect(disabled.result.current.size).toBe(0);
      expect(unsupported.result.current.size).toBe(0);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
