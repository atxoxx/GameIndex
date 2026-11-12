/**
 * Media helpers used by the game gallery, screenshots and the artwork picker.
 *
 * Ported from `media.rs` and `game_scraper/launchbox.rs`.
 */
import { app } from "electron";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

import { httpText } from "../../lib/http";
import { cached, TTL } from "./cache";
import { collapse } from "./text";

const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/**
 * `read_media_file` — raw bytes, not a data URL.
 *
 * The renderer wraps the returned buffer in a Blob URL (see
 * `useMediaFallbackSrc`), so returning a 33 %-larger base64 string would only
 * waste heap. An `ArrayBuffer` survives Electron's structured clone exactly.
 */
export async function readMediaFile(filePath: string): Promise<ArrayBuffer> {
  if (!filePath || !path.isAbsolute(filePath)) {
    throw new Error("A capture file path is required.");
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw new Error("Capture file not found — it may have been moved or deleted.");
  }
  if (!stat.isFile()) throw new Error("That path is not a file.");
  if (stat.size > MAX_MEDIA_BYTES) throw new Error("File too large to read (64 MB limit).");
  try {
    const bytes = await fsp.readFile(filePath);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read file: ${message}`);
  }
}

function defaultScreenshotPath(): string {
  const folder = path.join(app.getPath("videos"), "Captures");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(folder, `GameIndex_${stamp}.png`);
}

/** `save_screenshot` — accepts a full data URL or a bare base64 payload. */
export async function saveScreenshot(
  filePath: string | null | undefined,
  base64Data: string,
): Promise<string> {
  const payload = (base64Data.includes(",") ? base64Data.slice(base64Data.indexOf(",") + 1) : base64Data).trim();
  if (!payload) throw new Error("Screenshot payload is empty.");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode screenshot data: ${message}`);
  }
  if (bytes.length === 0) throw new Error("Screenshot data decoded to zero bytes.");

  const target = filePath?.trim() ? filePath : defaultScreenshotPath();
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write screenshot: ${message}`);
  }
  return target;
}

export interface LaunchBoxImageResult {
  category: string;
  region: string | null;
  resolution: string;
  url: string;
}

/** Parse "DOOM - Box - Front (World) - 1440x2160" into region + resolution. */
export function parseLaunchboxImageAlt(alt: string): {
  region: string | null;
  resolution: string;
} {
  let region: string | null = null;
  const open = alt.lastIndexOf("(");
  if (open >= 0) {
    const close = alt.indexOf(")", open);
    if (close > open) {
      const value = alt.slice(open + 1, close).trim();
      if (value && value !== "null") region = value;
    }
  }
  let resolution = "";
  for (const part of alt.split(" - ").reverse()) {
    const value = part.trim();
    const match = value.match(/^(\d+)\s*x\s*(\d+)$/);
    if (match) {
      resolution = value;
      break;
    }
  }
  return { region, resolution };
}

async function launchboxDetailHref(gameName: string): Promise<string | null> {
  const search = await httpText(
    `https://gamesdb.launchbox-app.com/games/results/${encodeURIComponent(gameName)}`,
    { timeoutMs: 20_000, retries: 1 },
  );
  if (!search.ok) throw new Error(`LaunchBox search returned HTTP ${search.status}.`);

  const $ = cheerio.load(search.text);
  const hrefs: { first?: string; windows?: string } = {};
  $(".games-grid-card").slice(0, 12).each((_index, element) => {
    const card = $(element);
    const href = card.find("a.list-item").first().attr("href");
    if (!href) return;
    if (!hrefs.first) hrefs.first = href;
    const platform = collapse(card.find(".cardTitle p").first().text());
    if (platform.toLowerCase() === "windows") hrefs.windows = href;
  });
  const href = hrefs.windows ?? hrefs.first;
  if (!href) return null;
  return href.startsWith("http") ? href : `https://gamesdb.launchbox-app.com${href}`;
}

function parseLaunchboxImages(html: string): LaunchBoxImageResult[] {
  const $ = cheerio.load(html);
  const results: LaunchBoxImageResult[] = [];
  $("article").each((_index, element) => {
    const article = $(element);
    const category = collapse(article.find("h3").first().text());
    if (!category || category === "Overview" || category === "Media") return;
    article.find("img[loading='lazy']").each((_imageIndex, image) => {
      const src = $(image).attr("src") ?? "";
      if (!src.includes("launchbox")) return;
      const alt = $(image).attr("alt") ?? "";
      const { region, resolution } = parseLaunchboxImageAlt(alt);
      results.push({ category, region, resolution, url: src });
    });
  });
  return results;
}

/** `search_launchbox_images` — categorized LaunchBox media for a title. */
export async function searchLaunchboxImages(gameName: string): Promise<LaunchBoxImageResult[]> {
  return cached("launchbox", gameName.trim().toLowerCase(), TTL.launchbox, async () => {
    const detailUrl = await launchboxDetailHref(gameName);
    if (!detailUrl) return [];
    const detail = await httpText(detailUrl, { timeoutMs: 20_000, retries: 1 });
    if (!detail.ok) throw new Error(`LaunchBox detail page returned HTTP ${detail.status}.`);
    return parseLaunchboxImages(detail.text);
  });
}

/** Exported for the harness. */
export function parseLaunchboxImagesFixture(html: string): LaunchBoxImageResult[] {
  return parseLaunchboxImages(html);
}
