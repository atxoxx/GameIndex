import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveGameArtwork,
  setActiveGameArtwork,
} from "./activeGameArtwork";

describe("activeGameArtwork", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ignores empty, whitespace, null, or undefined values", () => {
    const before = getActiveGameArtwork();
    setActiveGameArtwork(null);
    expect(getActiveGameArtwork()).toBe(before);

    setActiveGameArtwork(undefined);
    expect(getActiveGameArtwork()).toBe(before);

    setActiveGameArtwork("");
    expect(getActiveGameArtwork()).toBe(before);

    setActiveGameArtwork("   ");
    expect(getActiveGameArtwork()).toBe(before);
  });

  it("updates and persists active artwork when a valid URL is set", () => {
    const testUrl = "https://images.example.com/cover1.jpg";
    setActiveGameArtwork(testUrl);

    expect(getActiveGameArtwork()).toBe(testUrl);
    expect(localStorage.getItem("gamelib_active_game_artwork")).toBe(testUrl);
  });

  it("updates when a different URL is provided", () => {
    const url1 = "https://images.example.com/cover1.jpg";
    const url2 = "https://images.example.com/cover2.jpg";

    setActiveGameArtwork(url1);
    expect(getActiveGameArtwork()).toBe(url1);

    setActiveGameArtwork(url2);
    expect(getActiveGameArtwork()).toBe(url2);
    expect(localStorage.getItem("gamelib_active_game_artwork")).toBe(url2);
  });
});
