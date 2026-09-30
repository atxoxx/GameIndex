import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SettingsProvider,
  useSettings,
  useWebviewContentFilterEnabled,
} from "./SettingsContext";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const CONTENT_FILTER_KEY = "gamelib.webview_content_filter";

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
  const { webviewContentFilter, setWebviewContentFilter } = useSettings();
  const fromHook = useWebviewContentFilterEnabled();
  return (
    <div>
      <span data-testid="value">{String(webviewContentFilter)}</span>
      <span data-testid="hook">{String(fromHook)}</span>
      <button type="button" onClick={() => setWebviewContentFilter(false)}>
        disable
      </button>
      <button type="button" onClick={() => setWebviewContentFilter(true)}>
        enable
      </button>
    </div>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe("webview content filter setting", () => {
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

  it("reads a persisted disabled choice on mount", async () => {
    localStorage.setItem(CONTENT_FILTER_KEY, "false");
    render(<Consumer />, { wrapper });
    expect(await screen.findByTestId("value")).toHaveTextContent("false");
    expect(screen.getByTestId("hook")).toHaveTextContent("false");
  });

  it("disables the filter and persists the choice", async () => {
    render(<Consumer />, { wrapper });
    await screen.findByTestId("value");

    act(() => {
      screen.getByText("disable").click();
    });

    expect(screen.getByTestId("value")).toHaveTextContent("false");
    expect(screen.getByTestId("hook")).toHaveTextContent("false");
    expect(localStorage.getItem(CONTENT_FILTER_KEY)).toBe("false");
  });

  it("re-enables the filter after it was disabled", async () => {
    localStorage.setItem(CONTENT_FILTER_KEY, "false");
    render(<Consumer />, { wrapper });
    await screen.findByTestId("value");

    act(() => {
      screen.getByText("enable").click();
    });

    expect(screen.getByTestId("value")).toHaveTextContent("true");
    expect(localStorage.getItem(CONTENT_FILTER_KEY)).toBe("true");
  });
});

describe("useWebviewContentFilterEnabled", () => {
  it("defaults to enabled outside a SettingsProvider", () => {
    const { result } = renderHook(() => useWebviewContentFilterEnabled());
    expect(result.current).toBe(true);
  });
});
