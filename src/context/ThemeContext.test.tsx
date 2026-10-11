import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ThemeProvider, useTheme } from "./ThemeContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const ref: { current: ReturnType<typeof useTheme> | null } = { current: null };

function Probe() {
  ref.current = useTheme();
  return null;
}

describe("ThemeProvider live sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    ref.current = null;
    localStorage.clear();
    mockInvoke.mockResolvedValue(undefined as unknown as never);
    mockListen.mockImplementation(((event: string, cb: Handler) => {
      handlers.set(event, cb);
      return Promise.resolve(() => {});
    }) as typeof listen);
  });

  it("applies a theme pushed from the backend and reacts to the change", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      handlers.get("theme:changed")?.({ payload: "nord" });
    });

    expect(ref.current?.currentTheme).toBe("nord");
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
    expect(localStorage.getItem("gamelib-theme")).toBe("nord");
  });

  it("ignores an unknown/invalid theme id", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const before = ref.current?.currentTheme;

    act(() => {
      handlers.get("theme:changed")?.({ payload: "Not A Theme!" });
    });

    expect(ref.current?.currentTheme).toBe(before);
  });
});
