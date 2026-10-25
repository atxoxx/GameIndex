import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PlayerCountBadge from "./PlayerCountBadge";
import type { SteamPlayerHistory } from "../types/game";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

// The chart measures its container; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const history: SteamPlayerHistory = {
  appId: 730,
  points: [
    { timestamp: 1_700_000_000_000, count: 30_000 },
    { timestamp: 1_700_086_400_000, count: 41_000 },
    { timestamp: 1_700_172_800_000, count: 55_000 },
    { timestamp: 1_700_259_200_000, count: 42_318 },
  ],
  current: 42_318,
  peakInRange: 68_412,
  peakInRangeAt: 1_700_172_800_000,
  peakAllTime: 953_426,
  peakAllTimeAt: 1_645_000_000_000,
  averageInRange: 37_806,
  previousAverageInRange: 33_755,
  sampleCount: 4,
  downsampled: false,
};

function mockHappyPath() {
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "get_steam_player_count":
        return Promise.resolve(42_318);
      case "get_steam_player_history":
        return Promise.resolve(history);
      default:
        return Promise.resolve(null);
    }
  });
}

async function openModal() {
  render(<PlayerCountBadge appId={730} gameName="Counter-Strike 2" />);
  const badge = await screen.findByRole("button", {
    name: /players currently in this game/i,
  });
  fireEvent.click(badge);
  return screen.findByRole("dialog");
}

afterEach(cleanup);

beforeEach(() => {
  invoke.mockReset();
});

describe("PlayerCountBadge / PlayerCountModal", () => {
  it("opens a floating modal with the live count, trend and 7-day sparkline", async () => {
    mockHappyPath();
    const dialog = await openModal();

    expect(within(dialog).getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(within(dialog).getByText("Overview")).toBeInTheDocument();
    expect(within(dialog).getByText("Activity")).toBeInTheDocument();
    expect(within(dialog).getByText("42,318")).toBeInTheDocument();
    expect(within(dialog).getByText("Last 7 days")).toBeInTheDocument();

    // 37,806 average vs 33,755 previous ≈ +12%
    expect(within(dialog).getByText(/\+12%/)).toBeInTheDocument();

    // Reviews and static metadata now live on the Game page overview only.
    expect(invoke).not.toHaveBeenCalledWith(
      "get_steam_game_stats",
      expect.anything()
    );
  });

  it("switches to Activity and renders the range controls and peak band", async () => {
    mockHappyPath();
    const dialog = await openModal();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Activity" }));

    expect(await within(dialog).findByText("Concurrent Steam players")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "7d" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(dialog).getByRole("group", { name: "Activity statistics" })).toBeInTheDocument();
    expect(within(dialog).getByText("68.4K")).toBeInTheDocument();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "get_steam_player_history",
        expect.objectContaining({ appId: 730, rangeDays: 7 })
      )
    );
  });

  it("surfaces a retry when the history request fails", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "get_steam_player_count") return Promise.resolve(42_318);
      return Promise.reject("steamcharts is down");
    });

    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Activity" }));

    expect(
      await within(dialog).findByText("Player history unavailable")
    ).toBeInTheDocument();

    const retry = within(dialog).getByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(([command]) => command === "get_steam_player_history")
          .length
      ).toBeGreaterThanOrEqual(3)
    );
  });

  it("renders a static reading on Big Picture without a modal", async () => {
    mockHappyPath();
    const { container } = render(
      <PlayerCountBadge appId={730} interactive={false} />
    );

    await waitFor(() =>
      expect(container.querySelector(".steam-player-count--static")).not.toBeNull()
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
