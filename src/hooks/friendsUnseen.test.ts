import { describe, expect, it } from "vitest";

import type {
  DmThread,
  GameRecommendation,
  GameSession,
  GameSuggestion,
} from "../pages/friendsStorage";
import {
  countNewRemoteItems,
  type FriendsCollections,
} from "./friendsUnseen";

const ME = "Me";
const THEM = "Bob";

function session(
  id: string,
  creatorName: string,
  overrides: Partial<GameSession> = {}
): GameSession {
  return {
    id,
    gameId: "g1",
    gameName: "Game",
    scheduledAt: "2026-01-01T20:00",
    maxPlayers: 4,
    description: "",
    creatorName,
    attendees: [creatorName],
    updatedAt: 1,
    ...overrides,
  };
}

function recommendation(
  id: string,
  recommendedBy: string,
  overrides: Partial<GameRecommendation> = {}
): GameRecommendation {
  return {
    id,
    gameId: "g1",
    gameName: "Game",
    recommendedBy,
    recommendedTo: "All Friends",
    reason: "",
    rating: 5,
    comments: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function suggestion(
  id: string,
  suggestedBy: string,
  overrides: Partial<GameSuggestion> = {}
): GameSuggestion {
  return {
    id,
    gameId: "g2",
    gameName: "Wish Game",
    note: "",
    suggestedBy,
    suggestedTo: "All Friends",
    comments: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function thread(id: string, messages: DmThread["messages"]): DmThread {
  return { id, participants: [ME, THEM], messages, updatedAt: 1 };
}

function message(id: string, author: string, overrides: Record<string, unknown> = {}) {
  return { id, author, text: "hi", timestamp: 1, ...overrides };
}

function collections(
  overrides: Partial<FriendsCollections> = {}
): FriendsCollections {
  return {
    sessions: [],
    recommendations: [],
    suggestions: [],
    dms: [],
    ...overrides,
  };
}

describe("countNewRemoteItems", () => {
  it("counts items another person added since the previous read", () => {
    const deltas = countNewRemoteItems(
      collections(),
      collections({
        sessions: [session("s1", THEM)],
        recommendations: [recommendation("r1", THEM)],
        suggestions: [suggestion("g1", THEM)],
        dms: [thread("dm_1", [message("m1", THEM)])],
      }),
      ME
    );

    expect(deltas).toEqual({ sessions: 1, recs: 1, suggestions: 1, dms: 1 });
  });

  it("never badges our own writes", () => {
    const deltas = countNewRemoteItems(
      collections(),
      collections({
        sessions: [session("s1", ME)],
        recommendations: [recommendation("r1", ME)],
        suggestions: [suggestion("g1", ME)],
        dms: [thread("dm_1", [message("m1", ME)])],
      }),
      ME
    );

    expect(deltas).toEqual({ sessions: 0, recs: 0, suggestions: 0, dms: 0 });
  });

  it("does not count an item that was already there", () => {
    const previous = collections({
      sessions: [session("s1", THEM)],
      dms: [thread("dm_1", [message("m1", THEM)])],
    });

    const deltas = countNewRemoteItems(previous, previous, ME);

    expect(deltas).toEqual({ sessions: 0, recs: 0, suggestions: 0, dms: 0 });
  });

  it("counts only the messages appended to an existing thread", () => {
    const previous = collections({
      dms: [thread("dm_1", [message("m1", THEM)])],
    });
    const next = collections({
      dms: [
        thread("dm_1", [
          message("m1", THEM),
          message("m2", THEM),
          message("m3", ME),
          message("m4", THEM),
        ]),
      ],
    });

    const deltas = countNewRemoteItems(previous, next, ME);

    expect(deltas.dms).toBe(2);
  });

  it("ignores tombstones", () => {
    const deltas = countNewRemoteItems(
      collections(),
      collections({
        sessions: [session("s1", THEM, { deleted: true })],
        recommendations: [recommendation("r1", THEM, { deleted: true })],
        suggestions: [suggestion("g1", THEM, { deleted: true })],
        dms: [thread("dm_1", [message("m1", THEM, { deleted: true })])],
      }),
      ME
    );

    expect(deltas).toEqual({ sessions: 0, recs: 0, suggestions: 0, dms: 0 });
  });
});
