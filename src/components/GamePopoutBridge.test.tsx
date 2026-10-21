import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import GamePopoutBridge from "./GamePopoutBridge";
import { GAME_DETAIL_ROUTE_ATTR, GAME_DETAIL_TITLE_ATTR } from "../utils/gameDetailWindow";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function Card() {
  return (
    <div
      data-testid="card"
      {...{
        [GAME_DETAIL_ROUTE_ATTR]: "/library/hades",
        [GAME_DETAIL_TITLE_ATTR]: "Hades",
      }}
    >
      <span data-testid="body">Hades</span>
      <button type="button" data-testid="play">
        Play
      </button>
    </div>
  );
}

describe("GamePopoutBridge", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  function renderBridge() {
    const utils = render(
      <>
        <GamePopoutBridge />
        <Card />
      </>
    );
    return utils;
  }

  function auxClick(element: HTMLElement, button: number) {
    element.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button })
    );
  }

  it("opens the detail window on a middle click over a card", () => {
    const { getByTestId } = renderBridge();

    auxClick(getByTestId("body"), 1);

    expect(invoke).toHaveBeenCalledWith("open_game_detail_window", {
      route: "/library/hades",
      title: "Hades",
    });
  });

  it("leaves a nested control alone", () => {
    const { getByTestId } = renderBridge();

    auxClick(getByTestId("play"), 1);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores primary and secondary clicks", () => {
    const { getByTestId } = renderBridge();

    auxClick(getByTestId("body"), 0);
    auxClick(getByTestId("body"), 2);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("suppresses the WebView autoscroll on middle mousedown", () => {
    const { getByTestId } = renderBridge();

    const notPrevented = fireEvent.mouseDown(getByTestId("body"), { button: 1 });

    expect(notPrevented).toBe(false);
  });
});
