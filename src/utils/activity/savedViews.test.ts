import { describe, expect, it } from "vitest";
import {
  MAX_SAVED_VIEWS,
  makeSavedViewId,
  readSavedViews,
  removeSavedView,
  sanitizeSavedView,
  sanitizeSavedViews,
  upsertSavedView,
  writeSavedViews,
  type SavedActivityView,
} from "./savedViews";
import { DEFAULT_SESSION_FILTERS } from "./sessionQuery";

const base = {
  name: "Late nights",
  tab: "sessions" as const,
  rangeKey: "30d" as const,
  from: "",
  to: "",
  source: "Steam",
  gameId: "elden",
  filters: { ...DEFAULT_SESSION_FILTERS, telemetry: "notes" as const },
};

describe("sanitizeSavedView", () => {
  it("accepts a complete view", () => {
    const view = sanitizeSavedView({ ...base, id: "v1", createdAt: 10 });
    expect(view).toMatchObject({ id: "v1", name: "Late nights", tab: "sessions", source: "Steam" });
    expect(view?.filters.telemetry).toBe("notes");
  });

  it("rejects nameless entries and repairs unknown fields", () => {
    expect(sanitizeSavedView({ ...base, id: "v1", name: "  " })).toBeNull();
    const repaired = sanitizeSavedView({
      ...base,
      id: "v2",
      tab: "nope",
      rangeKey: "nope",
      from: "not-a-day",
      source: "",
      gameId: "",
      filters: { duration: "long", telemetry: "bogus" },
    });
    expect(repaired).toMatchObject({
      tab: "overview",
      rangeKey: "30d",
      from: "",
      source: "all",
      gameId: null,
    });
    expect(repaired?.filters.duration).toBe("long");
    expect(repaired?.filters.telemetry).toBe("all");
  });

  it("filters duplicates and caps the stored list", () => {
    const many = Array.from({ length: MAX_SAVED_VIEWS + 4 }, (_, index) =>
      sanitizeSavedView({ ...base, id: `v${index}`, name: `View ${index}` }),
    );
    expect(sanitizeSavedViews([...many, many[0]])).toHaveLength(MAX_SAVED_VIEWS);
    expect(sanitizeSavedViews("nope")).toEqual([]);
  });
});

describe("upsertSavedView", () => {
  it("replaces a view with the same name instead of duplicating it", () => {
    const first = upsertSavedView([], { ...base, name: "Evening" }, 1);
    const second = upsertSavedView(first, { ...base, name: "evening", rangeKey: "90d" }, 2);
    expect(second).toHaveLength(1);
    expect(second[0].rangeKey).toBe("90d");
    expect(second[0].id).toBe(first[0].id);
  });

  it("ignores an empty name and removes by id", () => {
    const views = upsertSavedView([], { ...base, name: "" }, 1);
    expect(views).toEqual([]);
    const saved = upsertSavedView([], { ...base, name: "One" }, 1);
    expect(removeSavedView(saved, saved[0].id)).toEqual([]);
  });

  it("creates unique ids", () => {
    expect(makeSavedViewId(1000)).not.toBe(makeSavedViewId(1000));
  });
});

describe("saved view storage", () => {
  it("round-trips through a storage implementation", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    } as unknown as Storage;
    const view: SavedActivityView = {
      ...base,
      id: "v1",
      createdAt: 5,
    };
    writeSavedViews([view], storage);
    expect(readSavedViews(storage)).toEqual([view]);
    writeSavedViews([], storage);
    expect(readSavedViews(storage)).toEqual([]);
  });

  it("returns an empty list for corrupt storage", () => {
    const storage = {
      getItem: () => "{not json",
      setItem: () => {},
    } as unknown as Storage;
    expect(readSavedViews(storage)).toEqual([]);
  });
});
