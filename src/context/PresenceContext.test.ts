import { describe, expect, it } from "vitest";
import { resolveActivityState, type PresenceActivityState } from "./PresenceContext";
import type { PresenceActivityHint } from "../types/presence";

const article: PresenceActivityHint = { kind: "article", title: "Article" };
const itch: PresenceActivityHint = { kind: "itch", title: "Game" };

describe("resolveActivityState", () => {
  it("publishes a hint and lets another owner take over", () => {
    let state: PresenceActivityState | null = resolveActivityState(null, "news", article);
    expect(state?.owner).toBe("news");
    expect(state?.hint).toEqual(article);

    state = resolveActivityState(state, "itch", itch);
    expect(state?.owner).toBe("itch");
    expect(state?.hint).toEqual(itch);
  });

  it("only clears the activity when the same owner clears it", () => {
    const published = resolveActivityState(null, "itch", itch);

    // A closed news preview on the same route must not wipe the itch hint.
    expect(resolveActivityState(published, "news", null)).toBe(published);
    expect(resolveActivityState(published, "itch", null)).toBeNull();
  });

  it("does nothing when clearing an already-empty activity", () => {
    expect(resolveActivityState(null, "news", null)).toBeNull();
  });
});
