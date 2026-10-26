import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivitySessionList } from "./ActivitySessionList";
import {
  DEFAULT_SESSION_FILTERS,
  type ActivitySessionFilters,
} from "../../utils/activity/sessionQuery";
import type { Game, GameSession } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string) => key,
  }),
}));

vi.mock("../../context/SessionNotesContext", () => ({
  useSessionNotes: () => ({
    getAllNotes: () => ({}),
    getNote: () => ({ note: "", tags: [] }),
    setNote: () => {},
    setTags: () => {},
  }),
}));

function game(): Game {
  return {
    id: "elden",
    name: "Elden Ring",
    path: "",
    platform: "Steam",
    installed: true,
    playTime: "10h",
    addedAt: 1,
  } as Game;
}

function session(id: string, gameName = "Elden Ring"): GameSession {
  return {
    id,
    gameId: "elden",
    gameName,
    date: "2026-08-30T23:10:00",
    durationMin: 90,
  };
}

const filters: ActivitySessionFilters = DEFAULT_SESSION_FILTERS;

function renderList(
  sessions: GameSession[],
  overrides: Partial<ComponentProps<typeof ActivitySessionList>> = {},
) {
  return render(
    <ActivitySessionList
      sessions={sessions}
      games={[game()]}
      filters={filters}
      onFiltersChange={() => {}}
      onDelete={() => {}}
      emptyTitle="No sessions yet"
      emptyHint="Launch a game to start."
      {...overrides}
    />,
  );
}

afterEach(() => cleanup());

describe("ActivitySessionList", () => {
  it("renders a row per session with its duration and the range summary", () => {
    renderList([session("a"), session("b")]);
    expect(screen.getAllByText("Elden Ring")).toHaveLength(2);
    expect(screen.getAllByText("1h 30m")).toHaveLength(2);
    expect(screen.getByText("activityWs.sessions.summary")).toBeTruthy();
  });

  it("shows the no-match state when the search excludes everything", () => {
    renderList([session("a")]);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "nothing matches" } });
    expect(screen.getByText("activityWs.sessions.noMatchesTitle")).toBeTruthy();
    expect(screen.queryByText("Elden Ring")).toBeNull();
  });

  it("shows the empty state when there are no sessions at all", () => {
    renderList([]);
    expect(screen.getByText("No sessions yet")).toBeTruthy();
    expect(screen.getByText("Launch a game to start.")).toBeTruthy();
  });

  it("opens the batch bar when a row is selected", () => {
    renderList([session("a")], { selectable: true, onBatchDelete: () => {} });
    fireEvent.click(screen.getByLabelText("activityWs.sessions.selectSession"));
    expect(screen.getByText("activitySessions.selectedCount")).toBeTruthy();
    expect(screen.getByText("activitySessions.deleteSelected")).toBeTruthy();
  });

  it("opens the session body inline instead of a side sheet", () => {
    renderList([session("a")], {
      onDelete: () => {},
      onLaunchGame: () => {},
    });
    fireEvent.click(screen.getByRole("button", { name: /Elden Ring/ }));
    expect(screen.getByRole("region", { name: /activityWs\.drawer\.eyebrow/ })).toBeTruthy();
    expect(screen.getByText("sessionNotes.title")).toBeTruthy();
    expect(screen.getByText("game.play")).toBeTruthy();
  });

  it("uses the compact row layout when requested", () => {
    renderList([session("a")], {
      filters: { ...filters, density: "compact" },
    });
    expect(document.querySelector(".activity-session-list.is-compact")).toBeTruthy();
  });
});
