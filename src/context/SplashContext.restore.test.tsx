import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  SplashProvider,
  useSplash,
  type SplashContextType,
} from "./SplashContext";
import type { Game } from "../types/game";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  convertFileSrc: (p: string) => p,
}));

const mockedInvoke = vi.mocked(invoke);

const game = { id: "game-a", name: "Alpha", platform: "Local" } as Game;

let splash: SplashContextType | null = null;

function Probe() {
  splash = useSplash();
  return null;
}

function renderSplash(): SplashContextType {
  render(
    <SplashProvider>
      <Probe />
    </SplashProvider>,
  );
  if (!splash) throw new Error("SplashContext was not provided");
  return splash;
}

describe("SplashProvider window restore", () => {
  beforeEach(() => {
    splash = null;
    mockedInvoke.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("restores a window hidden by minimize-on-launch when the splash is dismissed before the game starts", async () => {
    const ctx = renderSplash();
    await act(async () => {
      ctx.open({ game });
    });

    // A launch that never reached "started" registers no session, so the
    // backend has nothing that would ever restore the hidden window.
    mockedInvoke.mockClear();
    await act(async () => {
      ctx.close();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("restore_main_window");
  });

  it("restores the window after a failed launch is dismissed", async () => {
    const ctx = renderSplash();
    await act(async () => {
      ctx.open({ game });
    });
    await act(async () => {
      ctx.updateStatus("error", "spawn failed");
    });

    mockedInvoke.mockClear();
    await act(async () => {
      ctx.close();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("restore_main_window");
  });

  it("leaves the hidden window alone when the splash closes after the game started", async () => {
    const ctx = renderSplash();
    await act(async () => {
      ctx.open({ game });
    });
    await act(async () => {
      ctx.updateStatus("started");
    });

    mockedInvoke.mockClear();
    await act(async () => {
      ctx.close();
    });

    expect(mockedInvoke).not.toHaveBeenCalledWith("restore_main_window");
  });

  it("does nothing when closing an idle splash", async () => {
    const ctx = renderSplash();
    await act(async () => {
      ctx.close();
    });

    expect(mockedInvoke).not.toHaveBeenCalledWith("restore_main_window");
  });
});
