import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WineLogResult } from "../../../types/game";
import { WineLogsModal } from "./WineLogsModal";

const { invokeMock, saveMock, updateGameMock, onCloseMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  saveMock: vi.fn(),
  updateGameMock: vi.fn(),
  onCloseMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveMock }));
vi.mock("../../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${Object.values(vars).join(",")}` : key,
  }),
}));
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../../../context/GameContext", () => ({
  useGames: () => ({ updateGame: updateGameMock }),
  useGameById: () => undefined,
}));

const LOG_CONTENT = [
  "=== GameIndex Compatibility Log ===",
  "info: launching game",
  "err: failed to load d3d11",
  "warn: shader cache miss",
  "fixme:d3d: feature not supported",
  "dxvk: pipeline compiled",
  "plain line",
].join("\n");

function makeResult(overrides: Partial<WineLogResult> = {}): WineLogResult {
  return {
    gameId: "game-1",
    logContent: LOG_CONTENT,
    exists: true,
    lastModified: 1_800_000_000_000,
    sizeBytes: 512 * 1024,
    logPath: "/home/player/.local/share/gameindex/wine/game-1.log",
    ...overrides,
  };
}

function renderModal(
  props: {
    result?: WineLogResult;
    onLaunch?: () => void;
    onOpenEditTab?: () => void;
  } = {}
) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "get_game_wine_logs") return props.result ?? makeResult();
    return null;
  });

  return render(
    <WineLogsModal
      gameId="game-1"
      gameName="Test Game"
      onClose={onCloseMock}
      onLaunch={props.onLaunch}
      onOpenEditTab={props.onOpenEditTab}
    />
  );
}

function rows() {
  return Array.from(document.querySelectorAll(".wine-logs-row"));
}

function filterCount(id: string) {
  return document.querySelector(`[data-filter="${id}"] .wine-logs-filter-count`)?.textContent;
}

describe("WineLogsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMock.mockResolvedValue(null);
  });

  it("shows header file meta, rail stats and severity counts", async () => {
    renderModal();

    await waitFor(() => expect(rows()).toHaveLength(7));

    const header = document.querySelector(".wine-logs-header");
    expect(header?.textContent).toContain("Test Game");
    expect(header?.textContent).toContain("512 KB");

    const statValues = Array.from(document.querySelectorAll(".wine-logs-stat-value")).map(
      (element) => element.textContent
    );
    expect(statValues[0]).toBe("512 KB");
    expect(statValues[1]).toBe("7");

    expect(filterCount("all")).toBe("7");
    expect(filterCount("error")).toBe("1");
    expect(filterCount("warning")).toBe("2");
    expect(filterCount("system")).toBe("1");
  });

  it("hides info and error rows when the Warnings filter is chosen", async () => {
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(7));

    const warningsFilter = document.querySelector<HTMLButtonElement>(
      '[data-filter="warning"]'
    );
    expect(warningsFilter?.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(warningsFilter!);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(
      rows().every((row) => row.classList.contains("wine-logs-row--warning"))
    ).toBe(true);
    expect(document.querySelector(".wine-logs-row--error")).toBeNull();
    expect(document.querySelector(".wine-logs-row--info")).toBeNull();
    expect(warningsFilter?.getAttribute("aria-checked")).toBe("true");
  });

  it("filters by search and reports the match position", async () => {
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(7));

    const input = screen.getByLabelText("wineLogs.searchPlaceholder");
    fireEvent.change(input, { target: { value: "dxvk" } });

    await waitFor(() => {
      const current = rows();
      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toContain("dxvk: pipeline compiled");
    });
    expect(document.querySelector(".wine-logs-search-count")?.textContent).toBe("1 / 1");
    expect(document.querySelector(".wine-logs-count")?.textContent).toContain("1 / 7");
  });

  it("offers a launch CTA in the empty state", async () => {
    const onLaunch = vi.fn();
    const onOpenEditTab = vi.fn();
    renderModal({
      result: makeResult({ exists: false, logContent: "", sizeBytes: 0 }),
      onLaunch,
      onOpenEditTab,
    });

    const launch = await screen.findByText("wineLogs.launchWithWine");
    expect(screen.getByText("wineLogs.openCompatSettings")).toBeInTheDocument();

    fireEvent.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(7));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
});
