import { beforeEach, describe, expect, it } from "vitest";
import { readMapMemory, rememberMapChoice, writeMapMemory } from "./mapMemory";

describe("mapMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a map per provider and the last provider", () => {
    rememberMapChoice("game-1", "wand", "https://wand.com/maps/a");
    rememberMapChoice("game-1", "mapgenie", "https://mapgenie.io/game");
    rememberMapChoice("game-1", "wand", "https://wand.com/maps/b");

    const memory = readMapMemory("game-1");
    expect(memory.provider).toBe("wand");
    expect(memory.maps.wand).toBe("https://wand.com/maps/b");
    expect(memory.maps.mapgenie).toBe("https://mapgenie.io/game");
  });

  it("tolerates missing and corrupt storage", () => {
    expect(readMapMemory(undefined)).toEqual({ maps: {}, provider: null });
    expect(readMapMemory("missing")).toEqual({ maps: {}, provider: null });

    localStorage.setItem("gamelib.maps.selection.broken", "{not json");
    expect(readMapMemory("broken")).toEqual({ maps: {}, provider: null });

    writeMapMemory("game-2", { maps: {}, provider: null });
    expect(readMapMemory("game-2")).toEqual({ maps: {}, provider: null });
  });
});
