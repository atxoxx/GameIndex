/**
 * CrackWatch status from gamestatus.info.
 *
 * Ported from `src-tauri/src/crackwatch.rs`. The site renders its game rows
 * into a Nuxt `__NUXT_DATA__` payload, so no browser is needed — but it sits
 * behind an Anubis proof-of-work / metarefresh gate, which this module solves
 * before reading the page.
 *
 * Cache contract (24 h TTL, file `extras-cache.json`):
 *   • a resolved status is cached,
 *   • an explicit "site has no page for this title" negative is cached too,
 *   • an outage is never cached, and the last stale value is returned instead.
 *
 * The renderer treats `null` as "no status"; no fabricated CRACKED/UNCRACKED
 * badge is ever produced from a failed lookup.
 */
import crypto from "node:crypto";

import { httpText } from "../../lib/http";
import { cacheLookup, cacheStore, EXTRA_TTL } from "./cache";

export interface CrackWatchStatus {
  isCracked: boolean;
  crackDate: string | null;
  crackGroup: string | null;
  protection: string | null;
}

type LookupOutcome =
  | { kind: "found"; status: CrackWatchStatus }
  | { kind: "notFound" }
  | { kind: "unavailable" };

const SITE = "https://gamestatus.info";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function deaccent(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** gamestatus.info slug rules (apostrophes removed, ™/®/© transliterated). */
export function crackwatchSlug(name: string): string {
  const normalized = deaccent(name)
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/™/g, "tm")
    .replace(/®/g, "r")
    .replace(/©/g, "c");
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .split("-")
    .filter(Boolean)
    .join("-");
}

function slugTokens(name: string): string[] {
  return crackwatchSlug(name).split("-").filter(Boolean);
}

const STRIP_PREFIX_TOKENS = new Set(["marvels", "sonys", "ubisofts", "eas"]);

const EDITION_WORDS = new Set([
  "edition",
  "deluxe",
  "ultimate",
  "complete",
  "gold",
  "enhanced",
  "remastered",
  "remaster",
  "remake",
  "definitive",
  "anniversary",
  "collectors",
  "collector",
  "standard",
  "goty",
  "game-of-the-year",
  "premium",
  "digital",
]);

const ROMAN: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
  xvii: "17",
  xviii: "18",
  xix: "19",
  xx: "20",
};

const DIGIT_TO_ROMAN: Record<string, string> = Object.fromEntries(
  Object.entries(ROMAN).map(([roman, digit]) => [digit, roman]),
);

function swapNumeralTokens(slug: string): string {
  return slug
    .split("-")
    .map((token) => ROMAN[token] ?? DIGIT_TO_ROMAN[token] ?? token)
    .join("-");
}

function stripLeadIns(title: string): string {
  const tokens = slugTokens(title);
  while (tokens[0] === "the") tokens.shift();
  if (tokens[0] && STRIP_PREFIX_TOKENS.has(tokens[0])) tokens.shift();
  return tokens.join("-");
}

function stripEditionWords(title: string): string {
  return slugTokens(title)
    .filter((token) => !EDITION_WORDS.has(token))
    .join("-");
}

/** Progressive slug candidates, most-specific first (max five). */
export function crackwatchCandidateSlugs(title: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  const leadStripped = stripLeadIns(title);
  const stripped = stripEditionWords(leadStripped);
  push(crackwatchSlug(title));
  push(leadStripped);
  push(stripped);
  push(swapNumeralTokens(stripped));
  push(crackwatchSlug(title.replace(/&/g, " and ")));
  return out.slice(0, 5);
}

function numeralToken(token: string): string {
  return ROMAN[token] ?? token;
}

/** Whether an input title plausibly names the same game as a page title. */
export function crackwatchTitlesMatch(input: string, pageTitle: string): boolean {
  const a = stripEditionWords(input).split("-").filter(Boolean).map(numeralToken);
  const b = stripEditionWords(pageTitle).split("-").filter(Boolean).map(numeralToken);
  if (a.length === 0 || b.length === 0) return false;
  const isNumeral = (token: string) => /^\d+$/.test(token);
  const subset = (left: string[], right: string[]) => left.every((token) => right.includes(token));
  const containedOk = (left: string[], right: string[]) =>
    left.length >= 2 &&
    subset(left, right) &&
    !right.some((token) => isNumeral(token) && !left.includes(token));
  return (
    a.join("-") === b.join("-") ||
    containedOk(a, b) ||
    containedOk(b, a)
  );
}

// ── Nuxt payload ───────────────────────────────────────────────────────

function resolveNuxtRef(value: unknown, arr: unknown[], cache: Map<number, unknown>): unknown {
  if (typeof value === "number") {
    const index = value;
    if (index >= 0 && index < arr.length) {
      if (cache.has(index)) return cache.get(index);
      cache.set(index, null);
      const resolved = resolveNuxtRef(arr[index], arr, cache);
      cache.set(index, resolved);
      return resolved;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (typeof value[0] === "string") {
      if (value[0] === "ShallowReactive" || value[0] === "Reactive") {
        return resolveNuxtRef(value[1], arr, cache);
      }
      if (value[0] === "Set") return [];
      if (value[0] === "EmptyRef") return null;
    }
    return value.map((entry) => resolveNuxtRef(entry, arr, cache));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveNuxtRef(entry, arr, cache);
    }
    return out;
  }
  return value;
}

function extractNuxtData(html: string): string | null {
  const match = /<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  return match ? match[1] : null;
}

interface GamePayload {
  title: string;
  steamProdId: number | null;
  crackDate: string | null;
  protections: string | null;
  hackedGroups: string | null;
  readableStatus: string | null;
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseGamePayload(html: string): GamePayload | null {
  const json = extractNuxtData(html);
  if (!json) return null;
  let arr: unknown[];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    arr = parsed;
  } catch {
    return null;
  }
  const payload = arr[1];
  if (!payload || typeof payload !== "object") return null;
  const dataRef = (payload as Record<string, unknown>).data;
  const data = resolveNuxtRef(dataRef, arr, new Map());
  if (!data || typeof data !== "object") return null;
  const dataMap = data as Record<string, unknown>;
  const gameKey = Object.keys(dataMap).find(
    (key) => key.startsWith("game-") && key.endsWith("-en"),
  );
  if (!gameKey) return null;
  const gameObj = resolveNuxtRef(dataMap[gameKey], arr, new Map());
  if (!gameObj || typeof gameObj !== "object") return null;
  const game = gameObj as Record<string, unknown>;
  const title = stringField(game, "title");
  if (!title) return null;
  const steamRaw = game.steam_prod_id;
  const steamProdId =
    typeof steamRaw === "number"
      ? Math.trunc(steamRaw)
      : typeof steamRaw === "string" && /^\d+$/.test(steamRaw.trim())
        ? Number.parseInt(steamRaw.trim(), 10)
        : null;
  return {
    title,
    steamProdId,
    crackDate: stringField(game, "crack_date"),
    protections: stringField(game, "protections"),
    hackedGroups: stringField(game, "hacked_groups_en"),
    readableStatus: stringField(game, "readable_status"),
  };
}

function isCracked(payload: GamePayload): boolean {
  if (payload.crackDate) return true;
  const status = payload.readableStatus?.toLowerCase();
  if (!status) return false;
  if (status.includes("не взломана") || status.includes("not cracked")) return false;
  return status.includes("взломана") || status.includes("cracked");
}

function statusFromPayload(payload: GamePayload): CrackWatchStatus {
  const sceneGroup = payload.hackedGroups
    ? payload.hackedGroups.split(" — ")[0].trim() || null
    : null;
  return {
    isCracked: isCracked(payload),
    crackDate: payload.crackDate,
    crackGroup: sceneGroup,
    protection: payload.protections,
  };
}

/** Fixture entry point for the harness: parse a saved game page. */
export function parseCrackwatchFixture(html: string): CrackWatchStatus | null {
  const payload = parseGamePayload(html);
  return payload ? statusFromPayload(payload) : null;
}

// ── Anubis gate ────────────────────────────────────────────────────────

interface AnubisChallenge {
  rules?: { algorithm?: string; difficulty?: number };
  challenge?: {
    id?: string;
    randomData?: string;
    issuedAt?: string;
    method?: string;
    difficulty?: number;
  };
}

function extractChallenge(html: string): AnubisChallenge | null {
  const match = /<script[^>]*id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as AnubisChallenge;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function solvePow(randomData: string, difficulty: number): Promise<{ nonce: number; hash: string } | null> {
  const zeroBytes = Math.floor(difficulty / 2);
  const odd = difficulty % 2 !== 0;
  for (let nonce = 0; nonce < 20_000_000; nonce += 1) {
    if (nonce > 0 && nonce % 20_000 === 0) await new Promise((resolve) => setImmediate(resolve));
    const digest = crypto.createHash("sha256").update(`${randomData}${nonce}`, "utf8").digest();
    let ok = true;
    for (let index = 0; index < zeroBytes; index += 1) {
      if (digest[index] !== 0) {
        ok = false;
        break;
      }
    }
    if (ok && odd && (digest[zeroBytes] & 0xf0) !== 0) ok = false;
    if (ok) return { nonce, hash: digest.toString("hex") };
  }
  return null;
}

async function solveGate(
  challenge: AnubisChallenge,
  pageUrl: string,
): Promise<boolean> {
  const inner = challenge.challenge;
  if (!inner?.id || !inner.randomData) return false;
  const algorithm = challenge.rules?.algorithm ?? inner.method ?? "fast";
  const difficulty = challenge.rules?.difficulty ?? inner.difficulty ?? 1;

  if (algorithm === "metarefresh") {
    let waitMs = difficulty * 800 + 1000;
    if (inner.issuedAt) {
      const issued = Date.parse(inner.issuedAt);
      if (Number.isFinite(issued)) {
        waitMs = Math.max(0, issued + difficulty * 800 - Date.now()) + 1000;
      }
    }
    await sleep(Math.min(waitMs, 30_000));
    const passUrl =
      `${SITE}/.within.website/x/cmd/anubis/api/pass-challenge` +
      `?redir=${encodeURIComponent(pageUrl)}` +
      `&challenge=${encodeURIComponent(inner.randomData)}` +
      `&id=${encodeURIComponent(inner.id)}`;
    const response = await httpText(passUrl, {
      timeoutMs: 20_000,
      redirect: "manual",
      cookies: "crackwatch",
      headers: { "user-agent": USER_AGENT },
    });
    return response.ok || (response.status >= 300 && response.status < 400);
  }

  const solved = await solvePow(inner.randomData, Math.min(8, Math.max(1, difficulty)));
  if (!solved) return false;
  const passUrl =
    `${SITE}/.within.website/x/cmd/anubis/api/pass-challenge` +
    `?id=${encodeURIComponent(inner.id)}` +
    `&response=${encodeURIComponent(solved.hash)}` +
    `&nonce=${solved.nonce}` +
    `&redir=${encodeURIComponent(pageUrl)}` +
    "&elapsedTime=1234";
  const response = await httpText(passUrl, {
    timeoutMs: 20_000,
    redirect: "manual",
    cookies: "crackwatch",
    headers: { "user-agent": USER_AGENT },
  });
  return response.ok || (response.status >= 300 && response.status < 400);
}

async function fetchPageHtml(pageUrl: string): Promise<string | null> {
  try {
    const first = await httpText(pageUrl, {
      timeoutMs: 20_000,
      cookies: "crackwatch",
      headers: { "user-agent": USER_AGENT },
    });
    if (!first.text.includes("anubis_challenge")) {
      // A 404 body simply has no Nuxt game payload — the caller then tries the
      // next slug candidate. Server errors/rate limits mean "unavailable".
      if (first.status >= 400 && first.status !== 404) return null;
      return first.text;
    }
    const challenge = extractChallenge(first.text);
    if (!challenge) return null;
    if (!(await solveGate(challenge, pageUrl))) return null;
    const second = await httpText(pageUrl, {
      timeoutMs: 20_000,
      cookies: "crackwatch",
      headers: { "user-agent": USER_AGENT },
    });
    if (second.status >= 400 && second.status !== 404) return null;
    return second.text;
  } catch {
    return null;
  }
}

async function lookup(title: string, appId: string | null): Promise<LookupOutcome> {
  const wantedAppId = appId && /^\d+$/.test(appId.trim()) ? Number.parseInt(appId.trim(), 10) : null;
  for (const slug of crackwatchCandidateSlugs(title)) {
    const html = await fetchPageHtml(`${SITE}/${slug}/en`);
    if (!html) return { kind: "unavailable" };
    const payload = parseGamePayload(html);
    if (!payload) continue;
    if (wantedAppId !== null && payload.steamProdId !== null) {
      if (wantedAppId === payload.steamProdId) {
        return { kind: "found", status: statusFromPayload(payload) };
      }
      continue;
    }
    if (crackwatchTitlesMatch(title, payload.title)) {
      return { kind: "found", status: statusFromPayload(payload) };
    }
  }
  return { kind: "notFound" };
}

function cacheKeyFor(title: string, appId: string | null): string {
  const slug = crackwatchSlug(title);
  return appId ? `crackwatch:${slug}:${appId}` : `crackwatch:${slug}`;
}

function freshStatus(key: string): { hit: boolean; status: CrackWatchStatus | null } {
  const hit = cacheLookup<CrackWatchStatus | null>(key);
  if (!hit) return { hit: false, status: null };
  if (Date.now() - hit.at >= EXTRA_TTL.crackwatch) return { hit: false, status: null };
  return { hit: true, status: hit.value };
}

async function resolveStatus(title: string, appId: string | null): Promise<CrackWatchStatus | null> {
  if (!crackwatchSlug(title)) return null;
  const key = cacheKeyFor(title, appId);
  const fresh = freshStatus(key);
  if (fresh.hit) return fresh.status;

  const stale = cacheLookup<CrackWatchStatus | null>(key);
  const outcome = await lookup(title, appId);
  if (outcome.kind === "found") {
    cacheStore(key, outcome.status);
    return outcome.status;
  }
  if (outcome.kind === "notFound") {
    cacheStore(key, null);
    return null;
  }
  // Outage: do not cache a guess. Serve the last known value if there is one.
  return stale ? stale.value : null;
}

/** `fetch_crackwatch_status` — `null` when unresolved or offline. */
export async function fetchCrackwatchStatus(
  gameName: unknown,
  appId: unknown,
): Promise<CrackWatchStatus | null> {
  const name = typeof gameName === "string" ? gameName.trim() : "";
  if (!name) return null;
  const id = typeof appId === "string" || typeof appId === "number" ? String(appId) : null;
  return resolveStatus(name, id);
}

/** `fetch_crackwatch_status_batch` — only games with a resolved status. */
export async function fetchCrackwatchStatusBatch(
  gameNames: unknown,
): Promise<Record<string, CrackWatchStatus>> {
  const names = Array.isArray(gameNames)
    ? [...new Set(gameNames.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))]
    : [];
  const resolved: Record<string, CrackWatchStatus> = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, names.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= names.length) return;
      const name = names[index];
      try {
        const status = await resolveStatus(name, null);
        if (status) resolved[name] = status;
      } catch {
        /* a single failed lookup must not fail the batch */
      }
    }
  });
  await Promise.all(workers);
  return resolved;
}
