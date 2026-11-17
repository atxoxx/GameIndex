import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpText: vi.fn(),
}));

vi.mock("../../lib/http", () => ({
  httpText: mocks.httpText,
  httpJson: vi.fn(),
}));
vi.mock("../../lib/secrets", () => ({ getSecret: () => null }));

import { lookupSteamAppId } from "./steamApi";

function searchResponse(items: { id: number; name: string }[]) {
  return {
    ok: true,
    status: 200,
    text: JSON.stringify({ items }),
    url: "https://store.steampowered.com/api/storesearch/",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lookupSteamAppId", () => {
  it("does not match a word that only appears inside another word", async () => {
    // Steam's storesearch returns Citizen Sleeper 2 for "Star Citizen" because
    // "citizen" matches and "star" sits inside "starward". The old substring
    // matcher accepted that and persisted the wrong appid.
    mocks.httpText.mockResolvedValue(
      searchResponse([{ id: 2442460, name: "Citizen Sleeper 2: Starward Vector" }]),
    );

    await expect(lookupSteamAppId("Star Citizen")).resolves.toBeNull();
  });

  it("still resolves an exact title and a title with an edition suffix", async () => {
    mocks.httpText.mockResolvedValue(
      searchResponse([
        { id: 2442460, name: "Citizen Sleeper 2: Starward Vector" },
        { id: 1595, name: "Star Citizen" },
      ]),
    );
    await expect(lookupSteamAppId("Star Citizen")).resolves.toBe(1595);

    mocks.httpText.mockResolvedValue(
      searchResponse([{ id: 2442460, name: "Citizen Sleeper 2: Starward Vector" }]),
    );
    await expect(lookupSteamAppId("Citizen Sleeper 2")).resolves.toBe(2442460);
  });
});
