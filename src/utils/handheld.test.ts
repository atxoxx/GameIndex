import { describe, it, expect } from "vitest";
import {
  detectHandheldHost,
  isHandheldPref,
  loadHandheldPref,
  nextHandheldPref,
  resolveHandheldEnabled,
  saveHandheldPref,
  HANDHELD_PREF_KEY,
} from "./handheld";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    raw: store,
  };
}

describe("detectHandheldHost", () => {
  it("recognises SteamOS / Steam Deck user agents", () => {
    expect(detectHandheldHost("Mozilla/5.0 (X11; Linux x86_64) SteamOS")).toBe(true);
    expect(detectHandheldHost("Mozilla/5.0 ... SteamDeck")).toBe(true);
  });

  it("does not hijack ordinary desktops", () => {
    expect(detectHandheldHost("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(detectHandheldHost("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(detectHandheldHost("")).toBe(false);
  });
});

describe("handheld preference", () => {
  it("defaults to auto on empty or invalid storage", () => {
    expect(loadHandheldPref(fakeStorage())).toBe("auto");
    expect(loadHandheldPref(fakeStorage({ [HANDHELD_PREF_KEY]: "banana" }))).toBe("auto");
  });

  it("round-trips an explicit preference", () => {
    const storage = fakeStorage();
    saveHandheldPref("off", storage);
    expect(loadHandheldPref(storage)).toBe("off");
  });

  it("rejects values that are not the three known prefs", () => {
    expect(isHandheldPref("on")).toBe(true);
    expect(isHandheldPref("auto")).toBe(true);
    expect(isHandheldPref("off")).toBe(true);
    expect(isHandheldPref(null)).toBe(false);
    expect(isHandheldPref("ON")).toBe(false);
  });
});

describe("resolveHandheldEnabled", () => {
  it("honours an explicit on/off over detection", () => {
    expect(resolveHandheldEnabled("on", false)).toBe(true);
    expect(resolveHandheldEnabled("off", true)).toBe(false);
  });

  it("falls back to the detected device state under auto", () => {
    expect(resolveHandheldEnabled("auto", true)).toBe(true);
    expect(resolveHandheldEnabled("auto", false)).toBe(false);
  });
});

describe("nextHandheldPref", () => {
  it("toggles to the opposite explicit state", () => {
    expect(nextHandheldPref(true)).toBe("off");
    expect(nextHandheldPref(false)).toBe("on");
  });
});
