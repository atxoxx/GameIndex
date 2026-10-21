import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findGameDetailTarget,
  GAME_DETAIL_ROUTE_ATTR,
  GAME_DETAIL_TITLE_ATTR,
  isTauriRuntime,
  openGameDetailWindow,
} from "./gameDetailWindow";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function setTauriRuntime(enabled: boolean) {
  const holder = window as unknown as { __TAURI__?: unknown };
  if (enabled) holder.__TAURI__ = {};
  else delete holder.__TAURI__;
}

describe("openGameDetailWindow", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    setTauriRuntime(false);
    vi.restoreAllMocks();
  });

  it("asks the backend to open the reusable detail window", () => {
    setTauriRuntime(true);

    openGameDetailWindow("/library/hades", "Hades");

    expect(invoke).toHaveBeenCalledWith("open_game_detail_window", {
      route: "/library/hades",
      title: "Hades",
    });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens a browser tab when the Tauri runtime is absent", () => {
    setTauriRuntime(false);

    openGameDetailWindow("/store/hades");

    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#/store/hades`,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("logs a failed window creation instead of throwing", async () => {
    setTauriRuntime(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("window build failed"));

    expect(() => openGameDetailWindow("/library/hades")).not.toThrow();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      "[game-detail] failed to open window:",
      expect.any(Error)
    );
  });

  it("detects the Tauri runtime from the global bridge", () => {
    setTauriRuntime(true);
    expect(isTauriRuntime()).toBe(true);
    setTauriRuntime(false);
    expect(isTauriRuntime()).toBe(false);
  });
});

describe("findGameDetailTarget", () => {
  it("resolves the nearest tagged game item", () => {
    const card = document.createElement("div");
    card.setAttribute(GAME_DETAIL_ROUTE_ATTR, "/store/hades");
    card.setAttribute(GAME_DETAIL_TITLE_ATTR, "Hades");
    const label = document.createElement("span");
    card.appendChild(label);
    document.body.appendChild(card);

    const event = { target: label } as unknown as Event;

    expect(findGameDetailTarget(event)).toEqual({
      route: "/store/hades",
      title: "Hades",
    });
    card.remove();
  });

  it("returns null when the target is not a game item", () => {
    const plain = document.createElement("span");
    document.body.appendChild(plain);

    expect(findGameDetailTarget({ target: plain } as unknown as Event)).toBeNull();
    plain.remove();
  });
});
