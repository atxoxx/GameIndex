import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { StoreInstall, StoreInstallFinished } from "../types/storeInstalls";

type Handler<T> = (event: { payload: T }) => void;
const handlers = new Map<string, Handler<unknown>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: Handler<unknown>) => {
    handlers.set(event, cb);
    return () => {
      handlers.delete(event);
    };
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));

import {
  subscribeStoreInstallFinished,
  useStoreInstallFor,
  useStoreInstalls,
} from "./useStoreInstalls";

function entry(gameId: string): StoreInstall {
  return {
    key: `steam:${gameId}`,
    gameId,
    source: "steam",
    appId: "440",
    title: `Game ${gameId}`,
    state: "downloading",
    percent: 12,
    downloaded: 120,
    total: 1000,
    speed: 60,
    eta: 15,
  };
}

describe("useStoreInstalls", () => {
  it("starts empty and follows the backend's progress snapshot", async () => {
    const { result } = renderHook(() => ({
      all: useStoreInstalls(),
      selected: useStoreInstallFor("g2"),
    }));

    // Nothing has arrived yet: consumers must get an empty list, never a
    // throw, on a machine where no store is downloading.
    expect(result.current.all).toEqual([]);
    expect(result.current.selected).toBeNull();

    await waitFor(() => expect(handlers.has("store-install-progress")).toBe(true));

    act(() => {
      handlers.get("store-install-progress")!({ payload: [entry("g1"), entry("g2")] });
    });

    expect(result.current.all).toHaveLength(2);
    expect(result.current.selected?.gameId).toBe("g2");
  });

  it("routes completions to subscribers until they unsubscribe", async () => {
    const received: StoreInstallFinished[] = [];
    const unsubscribe = subscribeStoreInstallFinished((finished) => received.push(finished));

    await waitFor(() => expect(handlers.has("store-install-finished")).toBe(true));
    const push = handlers.get("store-install-finished")!;

    act(() => {
      push({ payload: { gameId: "g1", title: "Game g1", source: "steam" } });
    });
    expect(received).toHaveLength(1);

    unsubscribe();
    act(() => {
      push({ payload: { gameId: "g1", title: "Game g1", source: "steam" } });
    });
    expect(received).toHaveLength(1);
  });
});
