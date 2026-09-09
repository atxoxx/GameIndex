import { describe, it, expect } from "vitest";
import { normalizeTag, isNoiseTag, deduplicateAndMergeTags } from "./genreTags";

describe("genreTags utility", () => {
  it("normalizes known variations into canonical names", () => {
    expect(normalizeTag("role-playing (rpg)")).toBe("RPG");
    expect(normalizeTag("Role-Playing")).toBe("RPG");
    expect(normalizeTag("science fiction")).toBe("Sci-Fi");
    expect(normalizeTag("sci-fi")).toBe("Sci-Fi");
    expect(normalizeTag("hack and slash/beat 'em up")).toBe("Hack and Slash");
    expect(normalizeTag("singleplayer")).toBe("Single-player");
    expect(normalizeTag("single player")).toBe("Single-player");
    expect(normalizeTag("multiplayer")).toBe("Multiplayer");
    expect(normalizeTag("co-operative")).toBe("Co-op");
    expect(normalizeTag("online co-op")).toBe("Online Co-op");
    expect(normalizeTag("souls-like")).toBe("Souls-like");
    expect(normalizeTag("open world")).toBe("Open World");
    expect(normalizeTag("post-apocalyptic")).toBe("Post-Apocalyptic");
  });

  it("detects noise tags accurately", () => {
    expect(isNoiseTag("Great Soundtrack")).toBe(true);
    expect(isNoiseTag("soundtrack")).toBe(true);
    expect(isNoiseTag("memes")).toBe(true);
    expect(isNoiseTag("Benchmark")).toBe(true);
    expect(isNoiseTag("Masterpiece")).toBe(true);
    expect(isNoiseTag("Violent")).toBe(true);
    expect(isNoiseTag("Nudity")).toBe(true);
    expect(isNoiseTag("RPG")).toBe(false);
    expect(isNoiseTag("Open World")).toBe(false);
    expect(isNoiseTag("Souls-like")).toBe(false);
  });

  it("merges and deduplicates multiple sources without case-sensitive duplicates", () => {
    const existing = ["Action", "Role-playing (RPG)"];
    const igdbGenres = ["Role-playing (RPG)", "Adventure"];
    const igdbThemes = ["Science fiction", "Action", "Open world"];
    const steamTags = [
      "Cyberpunk",
      "Open World",
      "RPG",
      "Sci-fi",
      "Singleplayer",
      "Great Soundtrack", // noise
      "Violent", // noise
      "Action RPG",
      "FPS",
    ];

    const result = deduplicateAndMergeTags(existing, igdbGenres, igdbThemes, steamTags);

    expect(result).toContain("Action");
    expect(result).toContain("RPG");
    expect(result).toContain("Adventure");
    expect(result).toContain("Sci-Fi");
    expect(result).toContain("Open World");
    expect(result).toContain("Cyberpunk");
    expect(result).toContain("Single-player");
    expect(result).toContain("Action RPG");
    expect(result).toContain("FPS");

    // Noise should be removed
    expect(result).not.toContain("Great Soundtrack");
    expect(result).not.toContain("Violent");

    // Check no duplicate variations
    const rpgCount = result.filter((t) => t === "RPG").length;
    expect(rpgCount).toBe(1);

    const scifiCount = result.filter((t) => t === "Sci-Fi").length;
    expect(scifiCount).toBe(1);

    const openWorldCount = result.filter((t) => t === "Open World").length;
    expect(openWorldCount).toBe(1);
  });
});
