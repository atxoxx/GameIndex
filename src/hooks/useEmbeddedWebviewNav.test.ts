import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  dismissWebviewConsent,
  useEmbeddedWebviewNav,
} from "./useEmbeddedWebviewNav";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("useEmbeddedWebviewNav", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts with no back or forward history", () => {
    const { result } = renderHook(() =>
      useEmbeddedWebviewNav("preview-1", "https://a.example")
    );

    expect(result.current.navState).toEqual({ back: false, forward: false });
  });

  it("drives back and forward through the native history command", () => {
    const { result } = renderHook(() =>
      useEmbeddedWebviewNav("preview-1", "https://a.example")
    );

    act(() => {
      result.current.goBack();
    });
    expect(invokeMock).toHaveBeenCalledWith("webview_history_navigate", {
      label: "preview-1",
      direction: "back",
    });

    act(() => {
      result.current.goForward();
    });
    expect(invokeMock).toHaveBeenCalledWith("webview_history_navigate", {
      label: "preview-1",
      direction: "forward",
    });
  });

  it("tracks in-page navigation and enables back", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "webview_current_url") return "https://b.example";
      return undefined;
    });

    const { result } = renderHook(() =>
      useEmbeddedWebviewNav("preview-1", "https://a.example")
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current.navState.back).toBe(true);
    expect(result.current.navState.forward).toBe(false);
  });

  it("keeps a stable empty state when the URL lookup fails", async () => {
    invokeMock.mockRejectedValue(new Error("webview gone"));
    const { result } = renderHook(() =>
      useEmbeddedWebviewNav("preview-1", "https://a.example")
    );

    expect(result.current.navState).toEqual({ back: false, forward: false });
  });
});

describe("dismissWebviewConsent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("invokes the backend dismissal for a label", () => {
    dismissWebviewConsent("preview-1");
    expect(invokeMock).toHaveBeenCalledWith("webview_dismiss_consent", {
      label: "preview-1",
    });
  });

  it("does nothing without a label", () => {
    dismissWebviewConsent(null);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
