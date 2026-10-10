import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  OverlayProvider,
  useOverlay,
  type OverlayContextValue,
} from "./OverlayContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../hooks/useOverlayBounds", () => ({ useOverlayBounds: () => {} }));

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

type EventHandler = (event: { payload: unknown }) => void;
const handlers = new Map<string, EventHandler>();

const contextRef: { current: OverlayContextValue | null } = { current: null };

function Probe() {
  contextRef.current = useOverlay();
  return <span data-testid="game">{contextRef.current.session?.gameId ?? "none"}</span>;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OverlayProvider session seeding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    contextRef.current = null;
    mockedListen.mockImplementation(((
      event: string,
      cb: EventHandler,
    ) => {
      handlers.set(event, cb);
      return Promise.resolve(() => {});
    }) as typeof listen);
  });

  it("seeds the current session from overlay_get_session on mount", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "overlay_get_settings") return Promise.resolve(null);
      if (command === "overlay_get_session") {
        return Promise.resolve({ gameId: "g1", startedAt: 123, pid: 42 });
      }
      return Promise.resolve(null);
    });

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();

    expect(mockedInvoke).toHaveBeenCalledWith("overlay_get_session");
    expect(contextRef.current?.session).toEqual({
      gameId: "g1",
      startedAt: 123,
      pid: 42,
    });
  });

  it("stays empty (and swallows the error) when overlay_get_session rejects", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "overlay_get_session") {
        return Promise.reject(new Error("no runtime"));
      }
      return Promise.resolve(null);
    });

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();

    expect(contextRef.current?.session).toBeNull();
  });

  it("still tracks session changes pushed on overlay:session", async () => {
    mockedInvoke.mockResolvedValue(null);

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();

    act(() => {
      handlers.get("overlay:session")?.({
        payload: { gameId: "g2", startedAt: 456, pid: 7 },
      });
    });

    expect(contextRef.current?.session?.gameId).toBe("g2");
  });
});
