/**
 * itch.io browsing, game details, the signed-in library and downloads.
 *
 * itch.io exposes no catalogue/search API, so this module builds the store's
 * own browse URLs (see `./urls.ts`) and parses the returned HTML (see
 * `./parse.ts`).
 *
 * Everything is cached (`extras-cache`) and requests are serialised with a
 * small gap: itch answers bursts with 403/429, and the cache is what keeps a
 * tab switch from turning into a scrape storm.
 */
import { httpText } from "../../lib/http";
import { cached, EXTRA_TTL } from "../extras/cache";
import { betaCookies } from "../integrations/betaAuth";
import type {
  ItchFeed,
  ItchGameDetail,
  ItchOwnedFeed,
  ItchPriceFilter,
} from "../../../../src/types/itch";
import { parseItchCsrfToken, parseItchDetail, parseItchGrid } from "./parse";
import {
  buildItchBrowseUrl,
  itchGameUrl,
  matchesPrice,
  normaliseFilters,
  sortItchGames,
} from "./urls";

const PAGE_SIZE = 36;
/** Gap between itch requests, so a page of parallel calls stays polite. */
const REQUEST_GAP_MS = 320;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Request scheduling ─────────────────────────────────────────────────

let chain: Promise<unknown> = Promise.resolve();

function schedule<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run
    .catch(() => undefined)
    .then(() => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)));
  return run;
}

function storedCookieHeader(): string | null {
  try {
    const cookies = betaCookies("itch");
    if (cookies.length === 0) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } catch {
    return null;
  }
}

/**
 * Short, non-reversible tag for the current itch session.
 *
 * Cached pages depend on who is signed in — a paid game only exposes its
 * playable iframe, and the library only exists, once the account is known.
 * Folding this into the cache key means re-signing in (or signing out) does not
 * serve the previous account's page for the rest of the TTL.
 */
function sessionTag(): string {
  const header = storedCookieHeader() ?? "";
  let hash = 0;
  for (let index = 0; index < header.length; index += 1) {
    hash = (hash * 31 + header.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

interface ItchPage {
  status: number;
  url: string;
  html: string;
}

function isOk(page: ItchPage): boolean {
  return page.status >= 200 && page.status < 300;
}

async function fetchPage(url: string): Promise<ItchPage> {
  const cookie = storedCookieHeader();
  return schedule(async () => {
    const response = await httpText(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        ...(cookie ? { cookie } : {}),
      },
      retries: 1,
      timeoutMs: 20_000,
      maxBytes: 4 * 1024 * 1024,
      redirect: "follow",
    });
    return { status: response.status, url: response.url || url, html: response.text };
  });
}

function ensureOk(page: ItchPage, what: string): void {
  if (page.status === 403 || page.status === 429) {
    throw new Error(
      `itch.io rate-limited the ${what} request. Wait a minute, then refresh.`,
    );
  }
  if (page.status === 404) {
    throw new Error(`itch.io: ${what} not found.`);
  }
  if (!isOk(page)) {
    throw new Error(`itch.io: ${what} returned HTTP ${page.status}.`);
  }
}

function feedFromPage(
  parsed: { games: ItchFeed["games"]; total: number | null },
  page: number,
): ItchFeed {
  const games = parsed.games;
  const hasMore =
    parsed.total !== null
      ? page * PAGE_SIZE < parsed.total
      : games.length >= Math.floor(PAGE_SIZE * 0.75);
  return {
    games,
    hasMore: hasMore && games.length > 0,
    nextOffset: page + 1,
    total: parsed.total,
    page,
  };
}

// ── Browse ─────────────────────────────────────────────────────────────

export async function fetchItchGames(rawFilters: unknown): Promise<ItchFeed> {
  const built = buildItchBrowseUrl(normaliseFilters(rawFilters));

  const feed = await cached(
    `itch:browse:${built.url}`,
    EXTRA_TTL.itchFeed,
    async () => {
      const page = await fetchPage(built.url);
      ensureOk(page, "browse");
      const parsed = parseItchGrid(page.html);
      if (parsed.games.length === 0) {
        // An empty grid is only legitimate when the page says so.
        if (/No results|no games found/i.test(page.html)) {
          return feedFromPage(parsed, built.page);
        }
        throw new Error(
          "itch.io returned no games for this browse page. The page layout may have changed.",
        );
      }
      return feedFromPage(parsed, built.page);
    },
    { staleOnError: true },
  );

  let games = feed.games;
  if (built.webFacet) {
    games = games.map((game) => ({ ...game, playableInBrowser: true }));
  }
  if (built.clientPrice) {
    games = games.filter((game) => matchesPrice(game, built.clientPrice as ItchPriceFilter));
  }
  games = sortItchGames(games, built.clientSort);

  return { ...feed, games };
}

// ── Detail ─────────────────────────────────────────────────────────────

export async function fetchItchGameDetail(target: unknown): Promise<ItchGameDetail> {
  const raw = typeof target === "string" ? target : "";
  if (!raw.trim()) throw new Error("itch.io: a game URL is required.");
  const url = itchGameUrl(raw);

  return cached(
    `itch:detail:${url}:${sessionTag()}`,
    EXTRA_TTL.itchDetail,
    async () => {
      const page = await fetchPage(url);
      ensureOk(page, "game page");
      const detail = parseItchDetail(page.html, page.url || url);
      // `itch:path` is only present on a real game page; an error/redirect page
      // has neither it nor a title.
      if (!detail.id || !detail.title) {
        throw new Error("itch.io: could not read this game page.");
      }
      return detail;
    },
    { staleOnError: true },
  );
}

// ── Library ────────────────────────────────────────────────────────────

/**
 * Games the signed-in account owns. itch has no purchases API, so this reads
 * the list the site renders at `/my-purchases` with the cookies captured by the
 * itch.io integration. A redirect to `/login` means the session expired.
 */
export async function fetchItchOwnedGames(rawPage: unknown): Promise<ItchOwnedFeed> {
  const page = Math.max(1, Math.min(200, Math.floor(Number(rawPage) || 1)));
  const cookie = storedCookieHeader();
  if (!cookie) {
    return {
      games: [],
      hasMore: false,
      nextOffset: page,
      total: 0,
      page,
      authenticated: false,
    };
  }

  const url = `https://itch.io/my-purchases${page > 1 ? `?page=${page}` : ""}`;
  return cached(
    `itch:library:${page}:${sessionTag()}`,
    EXTRA_TTL.itchLibrary,
    async () => {
      const response = await schedule(() =>
        httpText(url, {
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml",
            cookie,
          },
          retries: 1,
          timeoutMs: 20_000,
          maxBytes: 4 * 1024 * 1024,
          // A redirect to /login is how itch reports an expired session.
          redirect: "manual",
        }),
      );

      if (response.status >= 300 && response.status < 400) {
        return {
          games: [],
          hasMore: false,
          nextOffset: page,
          total: 0,
          page,
          authenticated: false,
        };
      }
      if (response.status === 403 || response.status === 429) {
        throw new Error(
          "itch.io rate-limited the library request. Wait a minute, then refresh.",
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`itch.io library returned HTTP ${response.status}.`);
      }

      const parsed = parseItchGrid(response.text);
      const feed = feedFromPage(parsed, page);
      return { ...feed, authenticated: true, total: feed.total ?? parsed.games.length };
    },
    { staleOnError: true },
  );
}

// ── Downloads ──────────────────────────────────────────────────────────

export interface ItchDownloadTarget {
  url: string;
  external: boolean;
}

/**
 * Resolve a downloadable upload to a signed CDN URL.
 *
 * itch's download buttons POST the page's CSRF token to
 * `/<game>/file/<upload>`; the JSON reply carries a short-lived signed URL
 * (60s) plus `external: true` when the author linked off-site. The caller
 * starts the download immediately, so the expiry is not a problem.
 */
export async function resolveItchDownload(
  rawUrl: unknown,
  rawUploadId: unknown,
): Promise<ItchDownloadTarget> {
  const pageUrl = itchGameUrl(typeof rawUrl === "string" ? rawUrl : "");
  const uploadId = String(rawUploadId ?? "").trim();
  if (!/^\d+$/.test(uploadId)) throw new Error("itch.io: a valid upload id is required.");

  const cookie = storedCookieHeader();
  const headers = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml",
    ...(cookie ? { cookie } : {}),
  };

  const page = await schedule(() =>
    httpText(pageUrl, { headers, retries: 1, timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 }),
  );
  if (page.status < 200 || page.status >= 300) {
    ensureOk({ status: page.status, url: pageUrl, html: page.text }, "game page");
  }
  const csrf = parseItchCsrfToken(page.text);
  if (!csrf) {
    throw new Error("itch.io: could not read the download token from the game page.");
  }

  const body = new URLSearchParams({ csrf_token: csrf });
  const response = await schedule(() =>
    httpText(`${pageUrl}/file/${uploadId}?source=game_download`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json",
        referer: pageUrl,
        origin: new URL(pageUrl).origin,
      },
      body,
      retries: 0,
      timeoutMs: 25_000,
      maxBytes: 512 * 1024,
    }),
  );

  if (response.status === 403 || response.status === 429) {
    throw new Error(
      "itch.io refused the download. If you own this game, sign in to itch.io first.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`itch.io download returned HTTP ${response.status}.`);
  }

  let payload: { url?: unknown; external?: unknown; errors?: unknown } = {};
  try {
    payload = JSON.parse(response.text) as typeof payload;
  } catch {
    throw new Error("itch.io: the download response was not JSON.");
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`itch.io: ${payload.errors.map((entry) => String(entry)).join(", ")}`);
  }
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("itch.io: the download URL was missing from the response.");
  }

  return { url, external: payload.external === true };
}
