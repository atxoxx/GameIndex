import { describe, it, expect, afterEach, vi } from "vitest";
import { SPLASH_ENABLED_KEY, isSplashEnabled } from "./SplashContext";

describe("isSplashEnabled", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("defaults to enabled when nothing is stored", () => {
    expect(isSplashEnabled()).toBe(true);
  });

  it("is disabled only when explicitly stored as false", () => {
    localStorage.setItem(SPLASH_ENABLED_KEY, "false");
    expect(isSplashEnabled()).toBe(false);
  });

  it("stays enabled for any other stored value", () => {
    localStorage.setItem(SPLASH_ENABLED_KEY, "true");
    expect(isSplashEnabled()).toBe(true);
  });

  it("falls back to enabled when storage access throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(isSplashEnabled()).toBe(true);
  });
});
