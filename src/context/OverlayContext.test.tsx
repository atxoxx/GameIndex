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

describe("OverlayProvider background sync", () => {
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

  it("mirrors the background settings onto the root element", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "overlay_get_settings") {
        return Promise.resolve({
          backgroundStyle: "dim",
          backgroundBlur: 6,
          backgroundOpacity: 0.5,
          reduceEffects: true,
        });
      }
      return Promise.resolve(null);
    });

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();

    const root = document.documentElement;
    expect(root.dataset.overlayBg).toBe("dim");
    expect(root.dataset.overlayEffects).toBe("reduced");
    expect(root.dataset.overlayNative).toBe("false");
    expect(root.style.getPropertyValue("--overlay-bg-blur")).toBe("6px");
    expect(root.style.getPropertyValue("--overlay-bg-opacity")).toBe("0.5");
  });

  it("activates the native backdrop for glass when supported", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "overlay_get_settings") {
        return Promise.resolve({
          backgroundStyle: "glass",
          backgroundOpacity: 0.6,
          nativeBlur: true,
          reduceEffects: false,
        });
      }
      if (command === "overlay_native_blur_supported") {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();
    await flush();

    expect(document.documentElement.dataset.overlayNative).toBe("true");
    const calls = mockedInvoke.mock.calls.filter(
      (entry) => entry[0] === "overlay_set_window_effect",
    );
    expect(
      calls.some(
        (entry) => (entry[1] as { enabled?: boolean }).enabled === true,
      ),
    ).toBe(true);
  });

  it("applies settings pushed from the backend live", async () => {
    mockedInvoke.mockResolvedValue(null);

    render(
      <OverlayProvider>
        <Probe />
      </OverlayProvider>,
    );
    await flush();

    act(() => {
      handlers.get("overlay:settings")?.({
        payload: { opacity: 0.42, tickerLayout: "gauges" },
      });
    });

    expect(contextRef.current?.settings.opacity).toBe(0.42);
    expect(contextRef.current?.settings.tickerLayout).toBe("gauges");
  });
});
