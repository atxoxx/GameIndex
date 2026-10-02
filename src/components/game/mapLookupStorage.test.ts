import { afterEach, describe, expect, it } from "vitest";
import {
  readPersistedLookup,
  readPersistedLookupFound,
  sameLookupName,
  writePersistedLookup,
  writePersistedLookupFound,
} from "./mapLookupStorage";

describe("mapLookupStorage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips the searched name and found status per game", () => {
    writePersistedLookup("game-1", "STALKER");
    writePersistedLookupFound("game-1", true);

    expect(readPersistedLookup("game-1")).toBe("STALKER");
    expect(readPersistedLookupFound("game-1")).toBe(true);
    // A different game is unaffected.
    expect(readPersistedLookup("game-2")).toBeNull();
    expect(readPersistedLookupFound("game-2")).toBeNull();
  });

  it("clears both values when passed null", () => {
    writePersistedLookup("game-1", "STALKER");
    writePersistedLookupFound("game-1", true);

    writePersistedLookup("game-1", null);
    writePersistedLookupFound("game-1", null);

    expect(readPersistedLookup("game-1")).toBeNull();
    expect(readPersistedLookupFound("game-1")).toBeNull();
  });

  it("ignores missing keys", () => {
    writePersistedLookup(undefined, "STALKER");
    writePersistedLookupFound(undefined, true);

    expect(readPersistedLookup(undefined)).toBeNull();
    expect(readPersistedLookupFound(undefined)).toBeNull();
  });

  it("compares names case-insensitively", () => {
    expect(sameLookupName(" STALKER ", "stalker")).toBe(true);
    expect(sameLookupName("STALKER", "Stalker 2")).toBe(false);
  });
});
