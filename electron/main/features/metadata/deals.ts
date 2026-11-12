/**
 * Deals, giveaways, Game Pass and per-game CheapShark prices.
 *
 * Ported from `deals.rs` and `price.rs`. All sources are key-less and public,
 * so the only failure mode is the provider being unreachable; commands throw
 * a short message the Deals page can show.
 */
import * as cheerio from "cheerio";

import { httpJson, httpText } from "../../lib/http";
import { cached, cacheGet, cacheSet, TTL } from "./cache";
import { collapse, decodeEntities } from "./text";

export interface DealItem {
  id: string;
  gameTitle: string;
  storeName: string;
  storeUrl: string;
  dealPrice: number;
  discountPercent: number;
  expiration?: string | null;
  platform: string;
  thumbnail?: string | null;
}

export interface Giveaway {
  id: string;
  title: string;
  bundleTitle: string;
  storeName: string;
  imageUrl?: string | null;
  dealUrl: string;
  isMature: boolean;
  expiry?: string | null;
}

export interface GamePassGame {
  id: string;
  title: string;
  description?: string | null;
  coverImage?: string | null;
  developer?: string | null;
  publisher?: string | null;
  categories: string[];
  platforms: string[];
  releaseDate?: string | null;
  productId?: string | null;
  deeplink?: string | null;
}

export interface GamePrice {
  title: string;
  salePrice: number | null;
  normalPrice: number | null;
  discountPercent: number;
  isOnSale: boolean;
  dealUrl: string | null;
  storeId: string | null;
}

// ── ITAD deals ─────────────────────────────────────────────────────────

const ITAD_HOME = "https://isthereanydeal.com/";
const REDIRECT_TIMEOUT_MS = 5_000;
const REDIRECT_CONCURRENCY = 8;

function parseDiscountPercent(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

function parsePrice(raw: string): number | null {
  let cleaned = "";
  let seenSeparator = false;
  for (const char of raw) {
    if (char >= "0" && char <= "9") cleaned += char;
    else if ((char === "," || char === ".") && !seenSeparator) {
      cleaned += ".";
      seenSeparator = true;
    } else if (char === "-" && cleaned.length === 0) cleaned += "-";
  }
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseItadDeals(html: string): DealItem[] {
  const $ = cheerio.load(html);
  const deals: DealItem[] = [];
  $("a.deal").each((_index, element) => {
    const deal = $(element);
    const titleAnchor = deal.parent().find("a.title").first();
    const gameTitle = collapse(titleAnchor.text());
    if (!gameTitle) return;
    const discountPercent = parseDiscountPercent(collapse(deal.find("span.cut").first().text()));
    if (discountPercent === null || discountPercent <= 0) return;
    const dealPrice = parsePrice(collapse(deal.find("span.price").first().text())) ?? 0;
    const storeName = collapse(deal.find("div.shop").first().text()) || "Unknown Store";
    const storeUrl = (deal.attr("href") ?? "").trim();
    if (!storeUrl) return;
    const id = storeUrl.split("/").filter(Boolean).pop() ?? storeUrl;
    deals.push({
      id,
      gameTitle,
      storeName,
      storeUrl,
      dealPrice,
      discountPercent,
      expiration: null,
      platform: "Windows",
      thumbnail: null,
    });
  });
  return deals.sort((a, b) => b.discountPercent - a.discountPercent);
}

async function resolveRedirect(url: string): Promise<string> {
  try {
    const head = await httpText(url, {
      method: "HEAD",
      timeoutMs: REDIRECT_TIMEOUT_MS,
      redirect: "follow",
    });
    if (head.ok || (head.status >= 300 && head.status < 400)) return head.url || url;
  } catch {
    /* fall through to GET */
  }
  try {
    const get = await httpText(url, {
      method: "GET",
      timeoutMs: REDIRECT_TIMEOUT_MS,
      redirect: "follow",
    });
    return get.url || url;
  } catch {
    return url;
  }
}

export interface DealsFilters {
  platform?: string | null;
  minDiscount?: number | null;
  store?: string | null;
}

/** Current ITAD homepage specials, filtered and with direct store links. */
export async function fetchIsthereanydealDeals(filters: DealsFilters): Promise<DealItem[]> {
  const minDiscount = filters.minDiscount ?? 0;
  const storeFilter = (filters.store ?? "all").trim().toLowerCase();
  const cacheKey = `deals:${minDiscount}:${storeFilter}`;

  const deals = await cached("deals", cacheKey, TTL.deals, async () => {
    const response = await httpText(ITAD_HOME, { timeoutMs: 20_000, retries: 1 });
    if (!response.ok) throw new Error(`IsThereAnyDeal returned HTTP ${response.status}.`);
    const parsed = parseItadDeals(response.text);
    if (parsed.length === 0) {
      throw new Error("IsThereAnyDeal returned no deals — the page layout may have changed.");
    }
    let queue = 0;
    const workers = Array.from({ length: Math.min(REDIRECT_CONCURRENCY, parsed.length) }, async () => {
      while (queue < parsed.length) {
        const index = queue;
        queue += 1;
        const target = parsed[index];
        target.storeUrl = await resolveRedirect(target.storeUrl);
      }
    });
    await Promise.all(workers);
    return parsed;
  });

  return deals.filter((deal) => {
    if (deal.discountPercent < minDiscount) return false;
    if (storeFilter && storeFilter !== "all" && !deal.storeName.toLowerCase().includes(storeFilter)) {
      return false;
    }
    return true;
  });
}

// ── ITAD giveaways ─────────────────────────────────────────────────────

function extractItadToken(html: string): string | null {
  const start = html.indexOf("var g = ");
  if (start < 0) return null;
  const objectStart = start + "var g = ".length;
  const end = html.indexOf(";", objectStart);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(html.slice(objectStart, end)) as {
      user?: { token?: string };
    };
    return parsed.user?.token ?? null;
  } catch {
    return null;
  }
}

function storeNameFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Unknown Store";
  }
  if (host.includes("steampowered") || host.includes("steamcommunity")) return "Steam";
  if (host.includes("gog.com")) return "GOG";
  if (host.includes("epicgames")) return "Epic Games";
  if (host.includes("humble")) return "Humble Bundle";
  if (host.includes("fanatical")) return "Fanatical";
  if (host.includes("itch.io")) return "itch.io";
  if (host.includes("ubisoft")) return "Ubisoft";
  if (host.includes("ea.com")) return "EA App";
  if (host.includes("microsoft") || host.includes("xbox")) return "Microsoft Store";
  const parts = host.split(".");
  const bare = parts.length > 1 ? parts[parts.length - 2] : host;
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : "Unknown Store";
}

function tsToIso(ts: unknown): string | null {
  if (typeof ts !== "number" || ts <= 0) return null;
  return new Date(ts * 1000).toISOString();
}

function parseGiveawayDatum(datum: unknown): Giveaway[] {
  if (!datum || typeof datum !== "object") return [];
  const record = datum as Record<string, unknown>;
  const giveawayId = typeof record.id === "number" ? record.id : null;
  if (giveawayId === null) return [];
  const bundleTitle = typeof record.title === "string" ? record.title : "";
  const dealUrl = typeof record.url === "string" ? record.url : "";
  const isMature = Boolean(record.isMature);
  const expiry = tsToIso(record.expiry);
  const storeName = storeNameFromUrl(dealUrl);
  const games = Array.isArray(record.games) ? record.games : [];
  const out: Giveaway[] = [];
  for (const rawGame of games) {
    if (!rawGame || typeof rawGame !== "object") continue;
    const game = rawGame as Record<string, unknown>;
    const gameId = typeof game.id === "string" ? game.id : "";
    const title = typeof game.title === "string" ? game.title : "";
    if (!title) continue;
    const assets = game.assets && typeof game.assets === "object"
      ? (game.assets as Record<string, unknown>)
      : null;
    const imageUrl = typeof assets?.boxart === "string" ? assets.boxart : null;
    out.push({
      id: `${giveawayId}-${gameId}`,
      title,
      bundleTitle,
      storeName,
      imageUrl,
      dealUrl,
      isMature,
      expiry,
    });
  }
  return out;
}

/** Live free-game giveaways from ITAD. */
export async function fetchGiveaways(): Promise<Giveaway[]> {
  return cached("deals", "giveaways", TTL.deals, async () => {
    const page = await httpText("https://isthereanydeal.com/giveaways/", {
      timeoutMs: 15_000,
      retries: 1,
      cookies: "itad",
    });
    if (!page.ok) throw new Error(`IsThereAnyDeal giveaways returned HTTP ${page.status}.`);
    const token = extractItadToken(page.text);

    const all: Giveaway[] = [];
    let offset = 0;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) headers["ITAD-SessionToken"] = token;
      try {
        const payload = await httpJson<{
          data?: unknown[];
          done?: boolean;
        }>("https://isthereanydeal.com/giveaways/api/list/?tab=live", {
          method: "POST",
          headers,
          body: JSON.stringify({ offset, sort: null, filter: null }),
          timeoutMs: 15_000,
          cookies: "itad",
          retries: 1,
        });
        const data = Array.isArray(payload.data) ? payload.data : [];
        for (const datum of data) all.push(...parseGiveawayDatum(datum));
        if (payload.done || data.length === 0) break;
        offset += data.length;
      } catch (error) {
        if (pageIndex === 0) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`IsThereAnyDeal giveaways failed — ${message}`);
        }
        break;
      }
    }

    const now = Date.now();
    return all
      .filter((giveaway) => {
        if (!giveaway.expiry) return true;
        const time = Date.parse(giveaway.expiry);
        return Number.isNaN(time) ? false : time > now;
      })
      .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
  });
}

// ── Xbox Game Pass catalogue ───────────────────────────────────────────

const GAMEPASS_GUID = "29a81209-df6f-41fd-a528-2ae6b91f719c";
const GAMEPASS_BATCH = 25;

export interface GamePassFilters {
  region?: string | null;
  categories?: string[] | null;
  platform?: string | null;
}

function localeForMarket(market: string): string {
  const code = market.toUpperCase();
  const map: Record<string, string> = {
    US: "en-US",
    UK: "en-GB",
    GB: "en-GB",
    CA: "en-CA",
    AU: "en-AU",
    NZ: "en-AU",
    DE: "de-DE",
    AT: "de-DE",
    CH: "de-DE",
    FR: "fr-FR",
    BE: "fr-FR",
    LU: "fr-FR",
    JP: "ja-JP",
    BR: "pt-BR",
    MX: "es-MX",
    ES: "es-ES",
    IT: "it-IT",
  };
  return map[code] ?? "en-US";
}

function platformsFor(filter: string | null | undefined): string[] {
  switch (filter ?? "all") {
    case "xbox":
      return ["Xbox"];
    case "pc":
      return ["PC"];
    case "cloud":
      return ["Cloud"];
    default:
      return ["Xbox", "PC", "Cloud"];
  }
}

function categoryAliases(chip: string): string[] {
  if (chip === "RPG") return ["Role playing"];
  if (chip === "Sports & racing") return ["Sports", "Racing & flying"];
  return [chip];
}

function extractCategories(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "name" in entry) {
          const name = (entry as { name?: unknown }).name;
          return typeof name === "string" ? name : null;
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function splitFirst(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  for (const delimiter of [" and ", " / ", " + ", " & ", ","]) {
    const index = value.indexOf(delimiter);
    if (index > 0) {
      const head = value.slice(0, index).trim();
      if (head) return head;
    }
  }
  return value;
}

function slugifyProduct(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface DisplayImage {
  ImagePurpose?: string;
  Uri?: string;
  Width?: number;
  Height?: number;
}

interface DisplayProduct {
  ProductId?: string;
  ProductBSchema?: string;
  LocalizedProperties?: {
    ProductTitle?: string;
    ShortDescription?: string;
    DeveloperName?: string;
    PublisherName?: string;
    Images?: DisplayImage[];
  }[];
  MarketProperties?: { OriginalReleaseDate?: string }[];
  Properties?: { Categories?: unknown };
}

function normalizeImageUrl(raw: string | undefined, width?: number, height?: number): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url = value;
  if (value.startsWith("//")) url = `https:${value}`;
  else if (!/^https?:\/\//i.test(value)) {
    url = value.startsWith("/")
      ? `https://store-images.s-microsoft.com${value}`
      : `https://${value}`;
  }
  if (url.includes("?")) return url;
  return `${url}?w=${width ?? 480}&h=${height ?? 480}`;
}

function bestCover(product: DisplayProduct): string | null {
  const images = product.LocalizedProperties?.[0]?.Images;
  if (!images?.length) return null;
  const preferred = ["Poster", "BoxArt", "TitledHeroArt", "HeroArt", "SuperHeroArt", "Screenshot"];
  for (const purpose of preferred) {
    const image = images.find(
      (entry) => entry.ImagePurpose?.toLowerCase() === purpose.toLowerCase(),
    );
    if (image) {
      const url = normalizeImageUrl(image.Uri, image.Width, image.Height);
      if (url) return url;
    }
  }
  for (const image of images) {
    const url = normalizeImageUrl(image.Uri, image.Width, image.Height);
    if (url) return url;
  }
  return null;
}

/** Xbox Game Pass catalogue, optionally filtered by categories / platform. */
export async function fetchGamepassCatalog(filters: GamePassFilters): Promise<GamePassGame[]> {
  const market = (filters.region ?? "US").toUpperCase();
  const language = localeForMarket(market);
  const categoryKey = [...(filters.categories ?? [])].sort().join(",");
  const cacheKey = `gamepass:${market}:${filters.platform ?? "all"}:${categoryKey}`;

  return cached("deals", cacheKey, TTL.deals, async () => {
    const idsPayload = await httpJson<{ id?: string }[]>(
      `https://catalog.gamepass.com/sigls/v2?id=${GAMEPASS_GUID}` +
        `&market=${encodeURIComponent(market)}&language=${encodeURIComponent(language)}`,
      { timeoutMs: 20_000, retries: 1 },
    );
    const ids = idsPayload.map((entry) => entry.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += GAMEPASS_BATCH) {
      batches.push(ids.slice(index, index + GAMEPASS_BATCH));
    }

    const productLists = await Promise.all(
      batches.map(async (batch) => {
        try {
          const payload = await httpJson<{ Products?: DisplayProduct[] }>(
            `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(batch.join(","))}` +
              `&market=${encodeURIComponent(market)}&languages=${encodeURIComponent(language)}&MS-CV=F.1`,
            { timeoutMs: 20_000, retries: 1 },
          );
          return Array.isArray(payload.Products) ? payload.Products : [];
        } catch (error) {
          console.warn("[metadata] Game Pass batch failed:", error);
          return [];
        }
      }),
    );

    const games: GamePassGame[] = [];
    for (const product of productLists.flat()) {
      if (product.ProductBSchema?.startsWith("ProductAddOn")) continue;
      const localized = product.LocalizedProperties?.[0];
      const title = localized?.ProductTitle?.trim();
      if (!localized || !title) continue;
      const categories = extractCategories(product.Properties?.Categories);
      if (filters.categories?.length) {
        const matches = filters.categories.some((wanted) =>
          categoryAliases(wanted).some((alias) =>
            categories.some((category) => {
              const left = category.toLowerCase();
              const right = alias.toLowerCase();
              return left === right || left.startsWith(right);
            }),
          ),
        );
        if (!matches) continue;
      }
      const productId = product.ProductId ?? null;
      const slug = slugifyProduct(title);
      const deeplink = productId
        ? slug
          ? `https://www.xbox.com/en-US/games/store/${slug}/${productId}`
          : `https://www.xbox.com/en-US/games/store/x/${productId}`
        : null;
      games.push({
        id: productId ?? "",
        title,
        description: localized.ShortDescription ?? null,
        coverImage: bestCover(product),
        developer: splitFirst(localized.DeveloperName),
        publisher: splitFirst(localized.PublisherName),
        categories,
        platforms: platformsFor(filters.platform),
        releaseDate: product.MarketProperties?.[0]?.OriginalReleaseDate ?? null,
        productId,
        deeplink,
      });
    }
    return games;
  });
}

// ── CheapShark prices ──────────────────────────────────────────────────

function normalizePriceTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

async function lookupPrice(title: string): Promise<GamePrice | null> {
  const url = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(title)}&limit=1`;
  try {
    const games = await httpJson<{ external?: string; cheapest?: string; cheapestDealID?: string }[]>(
      url,
      { timeoutMs: 15_000, retries: 1 },
    );
    const first = games[0];
    if (!first) return null;
    const cheapest = first.cheapest ? Number.parseFloat(first.cheapest) : null;
    let normalPrice: number | null = null;
    let discountPercent = 0;
    let storeId: string | null = null;

    if (first.cheapestDealID) {
      try {
        const deal = await httpJson<{
          gameInfo?: { retailPrice?: string; salePrice?: string; storeID?: string };
        }>(`https://www.cheapshark.com/api/1.0/deals?id=${encodeURIComponent(first.cheapestDealID)}`, {
          timeoutMs: 15_000,
          retries: 1,
        });
        const info = deal.gameInfo;
        if (info) {
          normalPrice = info.retailPrice ? Number.parseFloat(info.retailPrice) : null;
          storeId = info.storeID ?? null;
          const sale = info.salePrice ? Number.parseFloat(info.salePrice) : null;
          if (normalPrice && sale != null && normalPrice > 0 && sale < normalPrice) {
            discountPercent = Math.round(((normalPrice - sale) / normalPrice) * 100);
          }
        }
      } catch {
        /* the base price is still useful without the deal details */
      }
    }

    return {
      title: first.external ?? title,
      salePrice: cheapest,
      normalPrice,
      discountPercent,
      isOnSale: discountPercent > 0,
      dealUrl: first.cheapestDealID
        ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(first.cheapestDealID)}`
        : null,
      storeId,
    };
  } catch {
    return null;
  }
}

/** Batch price lookup returning `{ requested name → price }`. */
export async function fetchGamePricesBatch(gameNames: string[]): Promise<Record<string, GamePrice>> {
  const resolved: Record<string, GamePrice> = {};
  const cold: string[] = [];
  const seen = new Set<string>();

  for (const name of gameNames) {
    const normalized = normalizePriceTitle(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const hit = cacheGet<GamePrice | null>("price", normalized, TTL.price);
    if (hit !== undefined) {
      if (hit) resolved[name] = hit;
    } else {
      cold.push(name);
    }
  }

  let index = 0;
  const workers = Array.from({ length: Math.min(4, cold.length) }, async () => {
    while (index < cold.length) {
      const name = cold[index];
      index += 1;
      const price = await lookupPrice(name);
      const normalized = normalizePriceTitle(name);
      cacheSet("price", normalized, price);
      if (price) resolved[name] = price;
    }
  });
  await Promise.all(workers);
  return resolved;
}

/** Exported for the harness: parse the ITAD homepage fixture. */
export function parseItadDealsFixture(html: string): DealItem[] {
  return parseItadDeals(html);
}

/** Exported for the harness: Game Pass product title helper. */
export function gamepassTitleForTest(product: DisplayProduct): string | null {
  return decodeEntities(product.LocalizedProperties?.[0]?.ProductTitle ?? "") || null;
}
