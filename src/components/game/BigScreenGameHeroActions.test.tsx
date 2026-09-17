import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BigScreenGameHeroActions, {
  PRIMARY_ACTION_ATTR,
  focusPrimaryAction,
} from "./BigScreenGameHeroActions";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

const noop = () => {};

function renderRow(overrides: Partial<Parameters<typeof BigScreenGameHeroActions>[0]> = {}) {
  const props = {
    isRunning: false,
    isClosing: false,
    showInstall: false,
    hasPlayableTrailer: false,
    onPlay: noop,
    onInstall: noop,
    onForceClose: noop,
    onDownload: noop,
    onTrailer: noop,
    ...overrides,
  };
  const utils = render(<BigScreenGameHeroActions {...props} />);
  const row = utils.container.querySelector(".bigscreen-gamepage-hero-actions");
  if (!row) throw new Error("action row not rendered");
  return { ...utils, row: row as HTMLElement, props };
}

function primaryEl(row: HTMLElement): HTMLElement {
  const el = row.querySelector<HTMLElement>(`[${PRIMARY_ACTION_ATTR}="true"]`);
  if (!el) throw new Error("no primary action marked");
  return el;
}

describe("BigScreenGameHeroActions", () => {
  it("makes Play the primary action and the first focusable stop", () => {
    const { row } = renderRow();
    const play = screen.getByRole("button", { name: "game.play" });

    expect(primaryEl(row)).toBe(play);
    // Nothing in the row can be reached before Play.
    expect(row.querySelector('[tabindex="0"]')).toBe(play);
    expect(primaryEl(row).className).toContain("bigscreen-details-btn--primary");
  });

  it("promotes Install when the game isn't installed on Steam", () => {
    const { row } = renderRow({ showInstall: true });

    expect(screen.queryByRole("button", { name: "game.play" })).toBeNull();
    expect(primaryEl(row)).toBe(
      screen.getByRole("button", { name: "game.installViaSteam" }),
    );
  });

  it("promotes Force Close while a game is running", () => {
    const { row } = renderRow({ isRunning: true });

    expect(primaryEl(row)).toBe(
      screen.getByRole("button", { name: "game.forceClose" }),
    );
    expect(screen.queryByRole("button", { name: "game.play" })).toBeNull();
  });

  it("disables Force Close while the close request is in flight", () => {
    renderRow({ isRunning: true, isClosing: true });
    expect(
      screen.getByRole("button", { name: "game.closing" }),
    ).toBeDisabled();
  });

  it("only offers a Trailer button when the game has a playable video", () => {
    const { unmount } = renderRow();
    expect(screen.queryByRole("button", { name: "game.watchTrailer" })).toBeNull();
    unmount();

    const { row } = renderRow({ hasPlayableTrailer: true });
    const trailer = screen.getByRole("button", { name: "game.watchTrailer" });
    expect(trailer).toBeInTheDocument();
    // The secondary never steals the primary marker.
    expect(primaryEl(row)).not.toBe(trailer);
  });

  it("activates each action through its own handler", () => {
    const onPlay = vi.fn();
    const onDownload = vi.fn();
    renderRow({ onPlay, onDownload });

    fireEvent.click(screen.getByRole("button", { name: "game.play" }));
    fireEvent.click(screen.getByRole("button", { name: "game.findDownload" }));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("never advertises Edit or Remove — those live on desktop", () => {
    const { row } = renderRow({ hasPlayableTrailer: true });
    expect(row.querySelector('[aria-label="game.editDetails"]')).toBeNull();
    expect(row.querySelector('[aria-label="game.remove"]')).toBeNull();
  });
});

describe("focusPrimaryAction", () => {
  it("focuses the marked element and reports success", () => {
    document.body.innerHTML = `
      <div id="root">
        <button id="decorative"></button>
        <button id="${PRIMARY_ACTION_ATTR}-target" ${PRIMARY_ACTION_ATTR}="true"></button>
      </div>`;
    const root = document.getElementById("root") as HTMLElement;

    expect(focusPrimaryAction(root)).toBe(true);
    expect(document.activeElement?.id).toBe(`${PRIMARY_ACTION_ATTR}-target`);
  });

  it("reports failure instead of throwing when nothing is marked", () => {
    document.body.innerHTML = `<div id="root"><button></button></div>`;
    expect(
      focusPrimaryAction(document.getElementById("root") as HTMLElement),
    ).toBe(false);
    expect(focusPrimaryAction(null)).toBe(false);
  });
});
