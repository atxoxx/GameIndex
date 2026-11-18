/**
 * itch.io HTML parsers.
 *
 * The store has no public catalogue API, so the Deals page reads its own
 * markup. Everything in this file is pure (html in, data out) so the shapes can
 * be unit-tested against saved pages without touching the network.
 *
 * Grid markup (`/games`, `/search`):
 *   div.game_cell[data-game_id] > .game_thumb img[data-lazy_src]
 *     .game_title .title[href] + .price_tag .price_value / .sale_tag
 *     .game_text, .game_author a, .game_genre, .game_platform .icon[title]
 *
 * Detail markup (`/<author>/<game>`):
 *   meta[name="itch:path"] (game id), JSON-LD Product (rating, price)
 *   .formatted_description, .screenshot_list, .game_info_panel_widget rows
 *   div[data-iframe] inside .game_frame — the ready-made playable iframe
 *   .upload_list_widget a.download_btn[data-upload_id]
 */
import * as cheerio from "cheerio";
import type {
  ItchGameDetail,
  ItchGameSummary,
  ItchInfoRow,
  ItchUpload,
} from "../../../../src/types/itch";

export interface ItchGridParse {
  games: ItchGameSummary[];
  total: number | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  "download for windows": "Windows",
  "download for mac": "macOS",
  "download for macos": "macOS",
  "download for linux": "Linux",
  "download for android": "Android",
  "download for ios": "iOS",
  "play in browser": "HTML5",
  "play in your browser": "HTML5",
};

function parseMoney(raw: string): number | null {
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parsePercent(raw: string): number | null {
  const match = raw.match(/(\d+)\s*%/);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function platformLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return PLATFORM_LABELS[key] ?? (raw.startsWith("Download for") ? raw.replace(/^Download for /i, "") : null);
}

/** `https://author.itch.io/game` → `author/game`. */
export function itchSlugFromUrl(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const author = parsed.hostname.replace(/\.itch\.io$/i, "");
    return parts[0] ? `${author}/${parts[0]}` : author;
  } catch {
    return "";
  }
}

function normaliseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `https://itch.io${raw}`;
  return raw;
}

function coverFromCell(cell: cheerio.Cheerio<never>): string | null {
  const img = cell.find(".game_thumb img").first();
  const candidates = [
    img.attr("data-lazy_src"),
    img.attr("src"),
    (img.attr("srcset") ?? "").split(",")[0]?.trim().split(" ")[0],
  ];
  for (const candidate of candidates) {
    if (candidate && !candidate.startsWith("data:")) return candidate;
  }
  const style = cell.find(".game_thumb").first().attr("style") ?? "";
  const background = style.match(/url\((['"]?)([^'")]+)\1\)/);
  return background?.[2] ? background[2] : null;
}

export function parseItchGrid(html: string): ItchGridParse {
  const $ = cheerio.load(html);
  const games: ItchGameSummary[] = [];
  const seen = new Set<string>();

  $(".game_cell").each((_, element) => {
    const cell = $(element) as unknown as cheerio.Cheerio<never>;
    const link = cell.find(".game_title .title, .title.game_link").first();
    const href = normaliseUrl(link.attr("href"));
    const title = link.text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;

    const id = cell.attr("data-game_id") ?? href;
    if (seen.has(id)) return;
    seen.add(id);

    const slug = itchSlugFromUrl(href);
    const authorAnchor = cell.find(".game_author a").first();
    const priceValue = parseMoney(cell.find(".price_value").first().text());
    const discountPercent = parsePercent(cell.find(".sale_tag").first().text()) ?? 0;
    const platforms = cell
      .find(".game_platform .icon")
      .map((__, icon) => platformLabel($(icon).attr("title")))
      .get()
      .filter((value): value is string => Boolean(value));

    games.push({
      id,
      slug,
      url: href,
      title,
      author: authorAnchor.text().replace(/\s+/g, " ").trim(),
      authorUrl: normaliseUrl(authorAnchor.attr("href")),
      coverUrl: coverFromCell(cell),
      blurb:
        cell.find(".game_text").first().attr("title")?.trim() ||
        cell.find(".game_text").first().text().replace(/\s+/g, " ").trim() ||
        null,
      price: priceValue,
      originalPrice:
        priceValue !== null && discountPercent > 0
          ? Math.round((priceValue / (1 - discountPercent / 100)) * 100) / 100
          : priceValue,
      discountPercent,
      onSale: discountPercent > 0,
      genre: cell.find(".game_genre").first().text().trim() || null,
      platforms,
      playableInBrowser: platforms.includes("HTML5"),
    });
  });

  const countText = $(".game_count").first().text().replace(/\s+/g, " ");
  const countMatch = countText.replace(/,/g, "").match(/(\d+)/);
  const total = countMatch?.[1] ? Number.parseInt(countMatch[1], 10) : null;

  return { games, total: Number.isFinite(total ?? NaN) ? total : null };
}

function ldProducts(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const parsed = JSON.parse($(script).text()) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        if (entry && typeof entry === "object" && (entry as Record<string, unknown>)["@type"] === "Product") {
          out.push(entry as Record<string, unknown>);
        }
      }
    } catch {
      /* malformed JSON-LD is not fatal — the DOM parse still works */
    }
  });
  return out;
}

/** The `src` of the iframe itch pre-builds for browser play. */
function playableIframe(html: string, $: cheerio.CheerioAPI): string | null {
  const dataIframe = $(".game_frame [data-iframe]").first().attr("data-iframe");
  if (dataIframe) {
    const match = dataIframe.match(/src=["']([^"']+)["']/i);
    if (match?.[1]) return normaliseUrl(match[1]);
  }
  const direct = html.match(
    /https:\/\/(?:html-classic|html|static)\.itch\.zone\/html\/[^"'\s&<>]+/i,
  );
  return direct?.[0] ?? null;
}

function infoRows($: cheerio.CheerioAPI): ItchInfoRow[] {
  const rows: ItchInfoRow[] = [];
  $(".game_info_panel_widget tr").each((_, row) => {
    const cells = $(row).find("td, .table_cell");
    if (cells.length < 2) return;
    const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
    const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
    if (label && value) rows.push({ label, value });
  });
  return rows;
}

function infoValue(rows: ItchInfoRow[], label: string): string | null {
  const row = rows.find((entry) => entry.label.toLowerCase() === label.toLowerCase());
  return row?.value ?? null;
}

export function parseItchDetail(html: string, url: string): ItchGameDetail {
  const $ = cheerio.load(html);
  const rows = infoRows($);
  const products = ldProducts(html);
  const product = products[0] ?? {};
  const offer = (product.offers ?? {}) as Record<string, unknown>;
  const aggregate = (product.aggregateRating ?? {}) as Record<string, unknown>;

  const pathId = $('meta[name="itch:path"]').attr("content") ?? "";
  const id = pathId.split("/").filter(Boolean).pop() ?? pathId;

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const title =
    $(".game_title").first().text().replace(/\s+/g, " ").trim() ||
    String(product.name ?? "") ||
    host;

  const author = infoValue(rows, "Author") ?? host.replace(/\.itch\.io$/i, "");
  const priceText = $(".buy_row [itemprop='price']").first().text();
  const originalText = $(".buy_row .original_price").first().text();
  const saleText = $(".sale_rate").first().text();
  const price =
    parseMoney(priceText) ?? parseMoney(String(offer.price ?? "")) ?? null;
  const originalPrice = parseMoney(originalText);
  const discountPercent =
    parsePercent(saleText) ??
    (price !== null && originalPrice !== null && originalPrice > price
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : 0);

  const ratingFromPanel = infoValue(rows, "Rating") ?? "";
  const ratingMatch = ratingFromPanel.match(/([\d.]+)\s*out of\s*5/i);
  const ratingCountMatch = ratingFromPanel.match(/\(([\d,]+)\s*total ratings?\)/i);
  const rating =
    (aggregate.ratingValue !== undefined ? Number(aggregate.ratingValue) : null) ??
    (ratingMatch?.[1] ? Number.parseFloat(ratingMatch[1]) : null);
  const ratingCount =
    (aggregate.ratingCount !== undefined ? Number(aggregate.ratingCount) : null) ??
    (ratingCountMatch?.[1] ? Number.parseInt(ratingCountMatch[1].replace(/,/g, ""), 10) : null);

  const tags = new Set<string>();
  const tagRow = infoValue(rows, "Tags");
  if (tagRow) {
    for (const tag of tagRow.split(",")) {
      const clean = tag.trim();
      if (clean) tags.add(clean);
    }
  }
  $(".game_info_panel_widget a[href*='/tag-']").each((_, anchor) => {
    const text = $(anchor).text().replace(/\s+/g, " ").trim();
    if (text) tags.add(text);
  });

  const platforms = (infoValue(rows, "Platforms") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const uploads: ItchUpload[] = [];
  $(".upload_list_widget .upload").each((_, element) => {
    const upload = $(element);
    const button = upload.find("[data-upload_id]").first();
    const uploadId = button.attr("data-upload_id");
    if (!uploadId) return;
    uploads.push({
      id: uploadId,
      name:
        upload.find(".upload_name .name").first().attr("title")?.trim() ||
        upload.find(".upload_name .name").first().text().replace(/\s+/g, " ").trim() ||
        `upload-${uploadId}`,
      size: upload.find(".file_size").first().text().replace(/\s+/g, " ").trim() || null,
      platforms: upload
        .find(".download_platforms .icon")
        .map((__, icon) => platformLabel($(icon).attr("title")) ?? "")
        .get()
        .filter(Boolean),
    });
  });

  const screenshots = $(".screenshot_list a[href]")
    .map((_, anchor) => normaliseUrl($(anchor).attr("href")))
    .get()
    .filter((value): value is string => Boolean(value));

  const trailer =
    normaliseUrl($(".video_embed_widget iframe").first().attr("src")) ??
    (() => {
      const code = $(".embed_preload").first().attr("data-embed_code");
      const match = code?.match(/src=["']([^"']+)["']/i);
      return normaliseUrl(match?.[1] ?? null);
    })();

  const descriptionHtml = $(".formatted_description").first().html()?.trim() || null;

  return {
    id,
    slug: itchSlugFromUrl(url),
    url,
    title,
    author,
    authorUrl: host ? `https://${host}` : null,
    coverUrl: normaliseUrl($('meta[property="og:image"]').attr("content")),
    blurb:
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      null,
    price,
    originalPrice: originalPrice ?? price,
    discountPercent,
    onSale: discountPercent > 0,
    genre: infoValue(rows, "Genre"),
    platforms,
    playableInBrowser: platforms.includes("HTML5"),
    descriptionHtml,
    screenshots,
    trailerUrl: trailer ?? null,
    tags: [...tags],
    info: rows,
    uploads,
    playUrl: playableIframe(html, $),
    purchaseUrl: normaliseUrl($("a.buy_btn").first().attr("href")),
    rating: Number.isFinite(rating ?? NaN) ? rating : null,
    ratingCount: Number.isFinite(ratingCount ?? NaN) ? ratingCount : null,
    status: infoValue(rows, "Status"),
    updated: infoValue(rows, "Updated"),
    released: infoValue(rows, "Release date") ?? infoValue(rows, "Released"),
    devlogCount: $(".game_devlog li").length,
    commentCount: $(".game_comments_widget .community_post").length,
    currency: String(offer.priceCurrency ?? "USD"),
  };
}

/** Meta CSRF token itch puts on every page; required for the download POST. */
export function parseItchCsrfToken(html: string): string | null {
  const match = html.match(/<meta name="csrf_token" value="([^"]+)"/i);
  return match?.[1] ?? null;
}
