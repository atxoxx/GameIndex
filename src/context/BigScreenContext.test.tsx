import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { windowMock } = vi.hoisted(() => ({
  windowMock: {
    isFullscreen: vi.fn(),
    isMaximized: vi.fn(),
    innerSize: vi.fn(),
    outerPosition: vi.fn(),
    setFullscreen: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock,
}));

import { BigScreenProvider, useBigScreen } from "./BigScreenContext";

const SIZE = { width: 1600, height: 900 };
const POSITION = { x: 120, y: 80 };

function Probe() {
  const { isBigScreen, setBigScreen } = useBigScreen();
  return (
    <div>
      <span data-testid="bigscreen">{String(isBigScreen)}</span>
      <button onClick={() => setBigScreen(true)}>enter</button>
      <button onClick={() => setBigScreen(false)}>exit</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <BigScreenProvider>
      <Probe />
    </BigScreenProvider>,
  );
}

describe("BigScreenProvider window handling", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(windowMock).forEach((fn) => fn.mockReset());
    windowMock.isFullscreen.mockResolvedValue(false);
    windowMock.isMaximized.mockResolvedValue(false);
    windowMock.innerSize.mockResolvedValue(SIZE);
    windowMock.outerPosition.mockResolvedValue(POSITION);
    windowMock.setFullscreen.mockResolvedValue(undefined);
    windowMock.maximize.mockResolvedValue(undefined);
    windowMock.unmaximize.mockResolvedValue(undefined);
    windowMock.setSize.mockResolvedValue(undefined);
    windowMock.setPosition.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).fullscreenElement;
    delete (document as unknown as Record<string, unknown>).exitFullscreen;
    delete (document.documentElement as unknown as Record<string, unknown>)
      .requestFullscreen;
    vi.restoreAllMocks();
  });

  it("enters native fullscreen and restores the previous geometry on exit (happy path)", async () => {
    renderProvider();

    fireEvent.click(screen.getByText("enter"));
    await waitFor(() =>
      expect(windowMock.setFullscreen).toHaveBeenCalledWith(true),
    );
    expect(windowMock.innerSize).toHaveBeenCalled();

    fireEvent.click(screen.getByText("exit"));
    await waitFor(() =>
      expect(windowMock.setPosition).toHaveBeenCalledWith(POSITION),
    );
    expect(windowMock.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(windowMock.setSize).toHaveBeenCalledWith(SIZE);
    expect(windowMock.unmaximize).not.toHaveBeenCalled();
    expect(localStorage.getItem("gamelib-bigscreen")).toBe("false");
  });

  it("re-maximizes the window when it was maximized before entering (happy path)", async () => {
    windowMock.isMaximized
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    renderProvider();
    fireEvent.click(screen.getByText("enter"));
    await waitFor(() =>
      expect(windowMock.setFullscreen).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByText("exit"));
    await waitFor(() => expect(windowMock.maximize).toHaveBeenCalled());
    expect(windowMock.setSize).not.toHaveBeenCalled();
  });

  it("falls back to the Web Fullscreen API when native fullscreen is denied (error path)", async () => {
    windowMock.setFullscreen.mockRejectedValue(new Error("not allowed"));
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    renderProvider();
    fireEvent.click(screen.getByText("enter"));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalled());
    expect(screen.getByTestId("bigscreen")).toHaveTextContent("true");
  });

  it("leaves a Web Fullscreen session and restores geometry on exit (error path)", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    renderProvider();
    fireEvent.click(screen.getByText("enter"));
    await waitFor(() =>
      expect(windowMock.setFullscreen).toHaveBeenCalledWith(true),
    );

    fireEvent.click(screen.getByText("exit"));
    await waitFor(() => expect(exitFullscreen).toHaveBeenCalled());
    expect(windowMock.setPosition).toHaveBeenCalledWith(POSITION);
    expect(screen.getByTestId("bigscreen")).toHaveTextContent("false");
  });
});
