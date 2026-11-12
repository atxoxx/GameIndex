/**
 * Steam Web API + Steam store helpers.
 *
 * Ports of the network half of `src-tauri/src/steam/{auth,sync}.rs` and the
 * name → appid lookup used by `useSteamAppId`. No new dependencies: every call
 * goes through `lib/http.ts`, which supplies the shared user-agent, timeouts
 * and retry policy.
 */
import { httpJson, httpText } from "../../lib/http";
import { getSecret } from "../../lib/secrets";

const API_BASE = "https://api.steampowered.com";

export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  avatarfull?: string;
  profileurl?: string;
}

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever?: number;
  rtime_last_played?: number;
  img_icon_url?: string;
}

export interface SteamOwnedGamesResponse {
  response?: {
    game_count?: number;
    games?: SteamOwnedGame[];
  };
}

/** `steam_connect` validation: 17 digits, then a GetPlayerSummaries probe. */
export function describeSteamSession(
  apiKey: string,
  steamId: string,
): { ok: boolean; error?: string } {
  if (!/^\d{17}$/.test(steamId)) {
    return { ok: false, error: `Invalid Steam ID: ${steamId || "(empty)"}` };
  }
  if (!apiKey.trim()) {
    return { ok: false, error: "A Steam Web API key is required." };
  }
  return { ok: true };
}

export async function fetchPlayerSummaries(
  apiKey: string,
  steamIds: string[],
): Promise<SteamPlayerSummary[]> {
  if (steamIds.length === 0) return [];
  const url =
    `${API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}` +
    `&steamids=${encodeURIComponent(steamIds.join(","))}&format=json`;
  const body = await httpJson<{ response?: { players?: SteamPlayerSummary[] } }>(url, {
    timeoutMs: 20_000,
    retries: 2,
  });
  return body.response?.players ?? [];
}

/** Owned games (`IPlayerService/GetOwnedGames`), including free-to-play titles. */
export async function fetchOwnedGames(
  apiKey: string,
  steamId: string,
): Promise<SteamOwnedGame[]> {
  const url =
    `${API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamId)}&include_appinfo=true` +
    `&include_played_free_games=true&format=json`;
  const body = await httpJson<SteamOwnedGamesResponse>(url, {
    timeoutMs: 60_000,
    retries: 3,
  });
  return body.response?.games ?? [];
}

/** `STEAM_API_KEY` fallback for owned-games sync when no session is stored. */
export function fallbackSteamApiKey(): string | null {
  const fromSecrets = getSecret("STEAM_API_KEY");
  return fromSecrets && fromSecrets.trim() ? fromSecrets.trim() : null;
}

export interface SteamStoreSearchItem {
  id: number;
  name: string;
  tiny_image?: string;
}

/**
 * Steam store search (`storesearch`). Mirrors `lookup_steam_app_id_for_game`:
 * exact normalized name first, then a token-coverage match where every query
 * word must appear in the candidate name. Returns `null` rather than guessing.
 */
export async function lookupSteamAppId(gameName: string): Promise<number | null> {
  const query = gameName.trim();
  if (!query) return null;

  const url =
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}` +
    `&l=en&cc=us`;
  let items: SteamStoreSearchItem[] = [];
  try {
    const response = await httpText(url, { timeoutMs: 15_000, retries: 1 });
    if (!response.ok) return null;
    const parsed = JSON.parse(response.text) as { items?: SteamStoreSearchItem[] };
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (error) {
    console.warn(
      "[steam] appid lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  if (items.length === 0) return null;

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[\u2122\u00ae]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const queryNormalized = normalize(query);
  const queryTokens = queryNormalized.split(" ").filter(Boolean);

  const exact = items.find((item) => normalize(item.name) === queryNormalized);
  if (exact) return exact.id;

  const tokenMatch = items.find((item) => {
    const candidate = normalize(item.name);
    return queryTokens.every((token) => candidate.split(" ").includes(token));
  });
  return tokenMatch ? tokenMatch.id : null;
}

export interface SteamAppDetails {
  name?: string;
  dlc?: number[];
  short_description?: string;
  header_image?: string;
  is_free?: boolean;
  release_date?: { date?: string; coming_soon?: boolean };
  price_overview?: {
    final?: number;
    initial?: number;
    discount_percent?: number;
    final_formatted?: string;
    initial_formatted?: string;
  };
}

/** `store.steampowered.com/api/appdetails` for one appid. */
export async function fetchSteamAppDetails(
  appId: number,
  lang: string,
): Promise<SteamAppDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${encodeURIComponent(
    lang || "en",
  )}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await httpText(url, { timeoutMs: 15_000 });
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (!response.ok) return null;
      const parsed = JSON.parse(response.text) as Record<
        string,
        { success?: boolean; data?: SteamAppDetails }
      >;
      const entry = parsed[String(appId)];
      if (!entry?.success || !entry.data) return null;
      return entry.data;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return null;
}
