/**
 * Epic owned-library fetch using the persisted launcher tokens.
 *
 * Library items are returned by `library-service`, which only carries
 * identifiers. Titles and cover art come from the catalog bulk endpoint, one
 * request per unique item (bounded concurrency, failures degrade to a readable
 * fallback title).
 */
import { httpJson } from "../../lib/http";
import { refreshEpicIfNeeded } from "./epicAuth";
import type { EpicSyncedGame } from "../../../../src/types/epic";

const LIBRARY_URL =
  "https://library-service.live.use1a.on.epicgames.com/library/api/public/items";
const CATALOG_URL =
  "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace";
const USER_AGENT =
  "UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit";

interface EpicLibraryRecord {
  namespace?: unknown;
  catalogItemId?: unknown;
  appName?: unknown;
  productId?: unknown;
}

interface EpicLibraryResponse {
  records?: unknown;
  responseMetadata?: { nextCursor?: unknown };
}

interface EpicCatalogItem {
  title?: unknown;
  keyImages?: Array<{ type?: unknown; url?: unknown }>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanize(appName: string): string {
  return appName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function coverFrom(item: EpicCatalogItem | null | undefined): string | undefined {
  const images = Array.isArray(item?.keyImages) ? item!.keyImages : [];
  const order = [
    "DieselGameBoxTall",
    "Thumbnail",
    "OfferImageTall",
    "DieselGameBox",
    "OfferImageWide",
    "DieselStoreFrontWide",
  ];
  for (const type of order) {
    const match = images.find((image) => text(image.type) === type && text(image.url));
    if (match) return text(match.url);
  }
  return images.map((image) => text(image.url)).find(Boolean) || undefined;
}

async function fetchCatalog(
  token: string,
  namespace: string,
  catalogItemId: string,
): Promise<EpicCatalogItem | null> {
  const url =
    `${CATALOG_URL}/${encodeURIComponent(namespace)}/bulk/items` +
    `?id=${encodeURIComponent(catalogItemId)}` +
    "&includeDLCDetails=false&includeMainGameDetails=false&country=US&locale=en-US";
  try {
    const response = await httpJson<Record<string, EpicCatalogItem>>(url, {
      headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
      timeoutMs: 20_000,
    });
    return response[catalogItemId] ?? null;
  } catch {
    return null;
  }
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

export interface EpicLibraryFetch {
  games: EpicSyncedGame[];
  errors: string[];
}

/** Owned Epic games (installed flags are filled in by the caller). */
export async function fetchEpicLibrary(): Promise<EpicLibraryFetch> {
  const tokens = await refreshEpicIfNeeded();
  if (!tokens) {
    throw new Error("Epic is not authenticated — connect your Epic account first.");
  }
  const headers = {
    authorization: `Bearer ${tokens.accessToken}`,
    "user-agent": USER_AGENT,
  };

  const raw: EpicLibraryRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL(LIBRARY_URL);
    url.searchParams.set("includeMetadata", "true");
    url.searchParams.set("platform", "Windows");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await httpJson<EpicLibraryResponse>(url.toString(), {
      headers,
      timeoutMs: 30_000,
    });
    const records = Array.isArray(response.records) ? response.records : [];
    for (const record of records) raw.push((record ?? {}) as EpicLibraryRecord);
    const nextCursor = text(response.responseMetadata?.nextCursor);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  const seen = new Set<string>();
  const items: Array<{
    namespace: string;
    catalogItemId: string;
    appName: string;
    productId: string;
  }> = [];
  for (const record of raw) {
    const namespace = text(record.namespace);
    const catalogItemId = text(record.catalogItemId);
    if (!namespace || !catalogItemId) continue;
    const key = `${namespace}:${catalogItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      namespace,
      catalogItemId,
      appName: text(record.appName),
      productId: text(record.productId),
    });
  }

  let metadataMissing = 0;
  const games = await mapLimit(items, 8, async (item) => {
    const catalog = await fetchCatalog(tokens.accessToken, item.namespace, item.catalogItemId);
    if (!catalog) metadataMissing += 1;
    const title =
      text(catalog?.title) ||
      humanize(item.appName || item.productId || item.catalogItemId);
    return {
      id: `epic-${item.namespace}-${item.catalogItemId}`,
      title,
      namespace: item.namespace,
      catalogItemId: item.catalogItemId,
      isInstalled: false,
      coverUrl: coverFrom(catalog),
    } satisfies EpicSyncedGame;
  });

  const errors: string[] = [];
  if (metadataMissing > 0) {
    errors.push(
      `${metadataMissing} of ${items.length} owned games returned no catalog metadata — using readable fallback titles.`,
    );
  }
  return { games, errors };
}
