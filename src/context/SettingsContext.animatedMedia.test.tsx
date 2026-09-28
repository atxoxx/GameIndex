import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SettingsProvider,
  useSettings,
  useAnimatedMediaEnabled,
} from "./SettingsContext";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const ANIMATED_MEDIA_KEY = "gamelib.animated_media_enabled";

function installInvoke() {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_platform":
        return "windows";
      case "get_launcher_settings":
        return {
          closeToTrayEnabled: false,
          minimizeOnLaunchEnabled: false,
          restoreOnExitEnabled: false,
          disableElevationPrompts: false,
          startupSplashEnabled: true,
        };
      case "is_autostart_enabled":
        return false;
      default:
        return undefined;
    }
  });
}

function Consumer() {
  const { animatedMediaEnabled, setAnimatedMediaEnabled } = useSettings();
  const fromHook = useAnimatedMediaEnabled();
  return (
    <div>
      <span data-testid="value">{String(animatedMediaEnabled)}</span>
      <span data-testid="hook">{String(fromHook)}</span>
      <button type="button" onClick={() => setAnimatedMediaEnabled(false)}>
        disable
      </button>
      <button type="button" onClick={() => setAnimatedMediaEnabled(true)}>
        enable
      </button>
    </div>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe("animated media setting", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    installInvoke();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to enabled when nothing is persisted", async () => {
    render(<Consumer />, { wrapper });
    expect(await screen.findByTestId("value")).toHaveTextContent("true");
    expect(screen.getByTestId("hook")).toHaveTextContent("true");
  });

  it("disables animated media and persists the choice", async () => {
    render(<Consumer />, { wrapper });
    await screen.findByTestId("value");

    act(() => {
      screen.getByText("disable").click();
    });

    expect(screen.getByTestId("value")).toHaveTextContent("false");
    expect(screen.getByTestId("hook")).toHaveTextContent("false");
    expect(localStorage.getItem(ANIMATED_MEDIA_KEY)).toBe("false");
  });

  it("reads a persisted disabled choice on mount", async () => {
    localStorage.setItem(ANIMATED_MEDIA_KEY, "false");
    render(<Consumer />, { wrapper });
    expect(await screen.findByTestId("value")).toHaveTextContent("false");
    expect(screen.getByTestId("hook")).toHaveTextContent("false");
  });

  it("keeps the in-memory choice when storage writes fail", async () => {
    const setItem = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    const failingStorage: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem,
    };
    vi.stubGlobal("localStorage", failingStorage);

    try {
      render(<Consumer />, { wrapper });
      await screen.findByTestId("value");

      act(() => {
        screen.getByText("disable").click();
      });

      expect(screen.getByTestId("value")).toHaveTextContent("false");
      expect(setItem).toHaveBeenCalledWith(ANIMATED_MEDIA_KEY, "false");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("useAnimatedMediaEnabled", () => {
  it("defaults to enabled outside a SettingsProvider", () => {
    const { result } = renderHook(() => useAnimatedMediaEnabled());
    expect(result.current).toBe(true);
  });
});
