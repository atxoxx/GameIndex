import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadHealMutes,
  muteGame,
  isGameMuted,
  shouldSurfaceFailure,
  failureReason,
  installFolderOf,
  type WatchdogFailure,
} from "./heal";

function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
  };
}

const failure: WatchdogFailure = {
  gameId: "g1",
  gameName: "Test Game",
  elapsedSeconds: 3,
  attached: false,
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("heal mutes", () => {
  it("round-trips a mute through a fresh load", () => {
    muteGame("g1");
    expect(isGameMuted("g1")).toBe(true);
    expect(isGameMuted("other")).toBe(false);
  });

  it("mirrors the storage-backed variant of the same logic", () => {
    const storage = fakeStorage();
    muteGame("g1", storage);
    expect(isGameMuted("g1", storage)).toBe(true);
    expect(loadHealMutes(storage)).toEqual({ g1: true });
  });
});

describe("shouldSurfaceFailure", () => {
  it("surfaces known, un-muted failures", () => {
    expect(shouldSurfaceFailure(failure, () => true)).toBe(true);
  });

  it("silences muted games (error path: delete-then-relaunch noise)", () => {
    const storage = fakeStorage();
    muteGame("g1", storage);
    expect(shouldSurfaceFailure(failure, () => true, storage)).toBe(false);
  });

  it("skips unknown game ids (stale session for a deleted game)", () => {
    expect(shouldSurfaceFailure(failure, () => false)).toBe(false);
  });
});

describe("failureReason", () => {
  it("distinguishes attached crashes from launches that never appeared", () => {
    expect(failureReason({ ...failure, attached: true })).toBe("crashed");
    expect(failureReason({ ...failure, attached: false })).toBe("notFound");
  });
});

describe("installFolderOf", () => {
  it("strips the exe from windows paths", () => {
    expect(installFolderOf("C:\\Games\\Steam\\common\\Game\\bin\\game.exe")).toBe(
      "C:\\Games\\Steam\\common\\Game\\bin"
    );
  });

  it("strips the exe from posix paths", () => {
    expect(installFolderOf("/opt/games/game/game")).toBe("/opt/games/game");
  });

  it("passes through a bare path with no separator", () => {
    expect(installFolderOf("game.exe")).toBe("game.exe");
  });
});
