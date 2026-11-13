/**
 * GOG owned-library fetch (Bearer token + session cookies).
 *
 * `embed.gog.com/user/data/games` returns bare product ids; metadata comes
 * from `embed.gog.com/account/gameDetails/<id>.json` (the endpoint GOG's own
 * web account uses — `api.gog.com` rejects non-Galaxy clients). Playtime is
 * mirrored from `gameplay.gog.com/clients/<userId>/playtime`.
 */
import { httpJson } from "../../lib/http";
import { getGogCookies, getGogSession, refreshGogIfNeeded } from "./gogAuth";
import type { GogSyncedGame } from "../../../../src/types/gog";
import type { AuthCookie } from "../../surfaces/authWindow";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface OwnedResponse {
  owned?: unknown;
}

interface GameDetails {
  id?: unknown;
  title?: unknown;
  images?: {
    boxArtImage?: unknown;
    backgroundImage?: unknown;
    logo?: unknown;
    icon?: unknown;
  };
  image?: unknown;
  backgroundImage?: unknown;
  developer?: unknown;
  publisher?: unknown;
  genres?: unknown;
}

interface PlaytimeRow {
  product_id?: unknown;
  productId?: unknown;
  playtime?: unknown;
  last_session?: unknown;
  lastSession?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cookieHeader(cookies: AuthCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function ownedIds(payload: OwnedResponse): string[] {
  const owned = Array.isArray(payload.owned) ? payload.owned : [];
  const ids: string[] = [];
  for (const entry of owned) {
    if (typeof entry === "number" || typeof entry === "string") {
      const value = String(entry).trim();
      if (value) ids.push(value);
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const value = text(record.id) || text(record.gameId) || text(record.productId);
      if (value) ids.push(value);
    }
  }
  return ids;
}

function coverFrom(details: GameDetails | null): string | undefined {
  const images = details?.images;
  return (
    text(images?.boxArtImage) ||
    text(images?.backgroundImage) ||
    text(details?.image) ||
    text(details?.backgroundImage) ||
    undefined
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface GogLibraryFetch {
  games: GogSyncedGame[];
  errors: string[];
}

/** Owned GOG games (installed flags are filled in by the caller). */
export async function fetchGogLibrary(): Promise<GogLibraryFetch> {
  const tokens = await refreshGogIfNeeded();
  if (!tokens) {
    throw new Error("GOG is not authenticated — connect your GOG account first.");
  }
  const session = getGogSession();
  const cookies = getGogCookies();
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokens.accessToken}`,
    "user-agent": USER_AGENT,
  };
  if (cookies.length > 0) headers.cookie = cookieHeader(cookies);

  const errors: string[] = [];
  const ownedPayload = await httpJson<OwnedResponse>(
    "https://embed.gog.com/user/data/games",
    { headers, timeoutMs: 30_000 },
  );
  const ids = [...new Set(ownedIds(ownedPayload))];
  if (ids.length === 0) {
    errors.push(
      "GOG returned no owned games — the session may have expired; reconnect your account.",
    );
  }

  const userId = session?.userId ?? tokens.userId;
  const playtime = new Map<string, { minutes?: number; lastSession?: number }>();
  if (userId) {
    try {
      const rows = await httpJson<PlaytimeRow[]>(
        `https://gameplay.gog.com/clients/${encodeURIComponent(userId)}/playtime`,
        { headers, timeoutMs: 20_000 },
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = text(row.product_id) || text(row.productId);
        if (!id) continue;
        const minutes = Number(row.playtime);
        const lastSession = Number(row.last_session ?? row.lastSession);
        playtime.set(id, {
          minutes: Number.isFinite(minutes) ? minutes : undefined,
          lastSession: Number.isFinite(lastSession) ? lastSession : undefined,
        });
      }
    } catch (error) {
      errors.push(
        `GOG playtime could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let metadataMissing = 0;
  const games = await mapLimit(ids, 8, async (id) => {
    let details: GameDetails | null = null;
    try {
      details = await httpJson<GameDetails>(
        `https://embed.gog.com/account/gameDetails/${encodeURIComponent(id)}.json`,
        { headers, timeoutMs: 20_000 },
      );
    } catch {
      metadataMissing += 1;
    }
    const stats = playtime.get(id);
    return {
      id: `gog-${id}`,
      title: text(details?.title) || `GOG Game ${id}`,
      gogGameId: id,
      isInstalled: false,
      playtimeMinutes: stats?.minutes,
      lastPlayed: stats?.lastSession,
      coverUrl: coverFrom(details),
    } satisfies GogSyncedGame;
  });

  if (metadataMissing > 0) {
    errors.push(
      `${metadataMissing} of ${ids.length} owned games returned no metadata — using fallback titles.`,
    );
  }
  return { games, errors };
}
