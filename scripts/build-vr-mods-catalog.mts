/**
 * Build the bundled VR mods catalog snapshot.
 *
 *   npm run build:vr-catalog
 *
 * Sources:
 *  - vrportnews.com: the entire catalog is embedded as escaped JSON in the
 *    server-rendered RSC payload, so one GET yields every record (no API,
 *    no pagination, no client rendering needed).
 *  - pcvrcentral.com: the /mods listing is client-rendered, so we walk the
 *    sitemap's /mods/{slug} URLs and read the server-rendered detail pages.
 *
 * Run with Node 22+ (TypeScript is stripped natively). The generated JSON is
 * committed to git and read by the renderer; this script never ships to users.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

import {
  cleanText,
  classifyKind,
  dedupeLinks,
  makeLink,
  normalizeGameKey,
} from "../src/pages/ports/vrMods/vrModData.ts";
import type {
  VrModEntry,
  VrModsCatalog,
  VrSourceSummary,
} from "../src/types/vrMod.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTPUT = path.join(ROOT, "src", "data", "vr-mods.catalog.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 GameIndex-CatalogBuilder/1.0";
const MAX_PAGES = Number(process.env.VR_MODS_LIMIT ?? "0"); // 0 = all
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.VR_MODS_CONCURRENCY ?? "6")));

function log(message: string): void {
  process.stdout.write(`[vr-catalog] ${message}\n`);
}

async function getText(url: string, timeoutMs = 25_000): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html, application/json;q=0.9, */*;q=0.5" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Pull an escaped JSON array out of an RSC payload served inside a JS string. */
function extractEscapedArray(html: string, needle: string): string | null {
  const start = html.indexOf(needle);
  if (start < 0) return null;
  const arrayStart = start + needle.length - 1;
  let depth = 0;
  let inString = false;
  for (let i = arrayStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === "\\") {
      if (html[i + 1] === '"') inString = !inString;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(arrayStart, i + 1);
    }
  }
  return null;
}

interface VrpRecord {
  id?: string;
  name?: string;
  url?: string;
  artwork?: string;
  artworkFallback?: string;
  created_at?: string;
  updated_at?: string;
  platform?: string;
  targets?: string[];
  kind?: string;
  compatibility?: string;
  sourceDate?: string;
}

function isoDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function platformLabels(targets: unknown): string[] {
  if (!Array.isArray(targets)) return [];
  const map: Record<string, string> = {
    pcvr: "PCVR",
    quest: "Quest",
    pico: "Pico",
    standalone: "Standalone",
    steamframe: "Steam Frame",
  };
  return targets
    .map((value) => cleanText(value))
    .filter(Boolean)
    .map((value) => map[value.toLowerCase()] ?? value);
}

async function harvestVrPortNews(): Promise<{ entries: VrModEntry[]; ok: boolean; error?: string }> {
  try {
    log("fetching vrportnews.com ...");
    const html = await getText("https://vrportnews.com");
    const escaped = extractEscapedArray(html, '\\"ports\\":[');
    if (!escaped) throw new Error("could not locate the embedded ports payload");
    const records = JSON.parse(JSON.parse(`"${escaped}"`)) as VrpRecord[];
    const entries: VrModEntry[] = [];
    const seen = new Set<string>();

    for (const record of records) {
      const name = cleanText(record.name);
      if (!name) continue;
      const id = cleanText(record.id) || normalizeGameKey(name);
      if (seen.has(`vrportnews:${id}`)) continue;
      seen.add(`vrportnews:${id}`);

      const url = cleanText(record.url);
      const links = url ? [makeLink("Source", url)] : [];
      const compatibility = cleanText(record.compatibility);
      const sourceDate = cleanText(record.sourceDate);
      const descriptionParts = [
        cleanText(record.platform) ? `Platform: ${cleanText(record.platform)}` : "",
        compatibility ? `Community compatibility: ${compatibility}` : "",
        sourceDate ? `Source snapshot: ${sourceDate}` : "",
      ].filter(Boolean);
      const detailParts = [
        record.motionControls === true ? "Motion controls: supported" : "",
        cleanText(record.hasGuide) === "true" ? "An install guide is available on the source." : "",
      ].filter(Boolean);
      const image = cleanText(record.artwork) || cleanText(record.artworkFallback);

      entries.push({
        id: `vrportnews:${id}`,
        gameKey: normalizeGameKey(name),
        gameTitle: name,
        modName: name,
        description: descriptionParts.join(" · "),
        details: detailParts.join(" · "),
        links: dedupeLinks(links),
        image: image ? image.replace(/^http:\/\//, "https://") : null,
        date: isoDate(record.updated_at) ?? isoDate(record.created_at),
        kind: classifyKind(cleanText(record.kind), name),
        platforms: platformLabels(record.targets),
        sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
        author: null,
        compatibility: compatibility || null,
      });
    }
    log(`vrportnews: ${entries.length} entries`);
    return { entries, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`vrportnews failed: ${message}`);
    return { entries: [], ok: false, error: message };
  }
}

function dedupeRepeated(value: string): string {
  if (value.length % 2 === 0) {
    const half = value.slice(0, value.length / 2);
    if (half && value === half + half) return half;
  }
  return value;
}

async function harvestPcvrCentral(): Promise<{ entries: VrModEntry[]; ok: boolean; error?: string }> {
  try {
    log("fetching pcvrcentral sitemap ...");
    const sitemap = await getText("https://pcvrcentral.com/sitemap.xml", 60_000);
    const urls = [...sitemap.matchAll(/<loc>\s*([^<]*\/mods\/[^<]+)\s*<\/loc>/g)]
      .map((match) => match[1].trim())
      .filter((url) => !/\/es\/|\/pt-br\/|\/ru\/|\/de\/|\/fr\/|\/zh/i.test(url));
    const target = MAX_PAGES > 0 ? urls.slice(0, MAX_PAGES) : urls;
    log(`pcvrcentral: ${target.length} mod pages`);

    const entries: VrModEntry[] = [];
    let next = 0;
    let done = 0;
    let failed = 0;

    async function worker(): Promise<void> {
      while (next < target.length) {
        const index = next;
        next += 1;
        const url = target[index];
        try {
          const html = await getText(url);
          const $ = load(html);
          const modName = cleanText($("h1").first().text());
          const game = cleanText($('a[href^="/games/"]').first().text());
          if (!modName || !game) return;
          const slug = url.split("/mods/")[1] ?? `${index}`;
          const description = cleanText($('meta[name="description"]').attr("content"));
          const imageHref = cleanText($('link[rel="preload"][as="image"]').first().attr("href"));

          const details: string[] = [];
          let sourceUrl = "";
          $("dl div").each((_i, element) => {
            const label = cleanText($(element).find("dt").first().text());
            const cell = $(element).find("dd").first();
            const value = cleanText(cell.text());
            if (!label || !value) return;
            details.push(`${label}: ${value}`);
            if (label === "Source") sourceUrl = cleanText(cell.find("a").first().attr("href"));
          });

          const titleText = cleanText($("h1").first().parent().parent().text());
          const authorMatch = titleText.match(/·\s*by\s+([^·]+)/i);
          const author = authorMatch ? dedupeRepeated(cleanText(authorMatch[1])) : "";
          const links = sourceUrl ? [makeLink("Source", new URL(sourceUrl, url).toString())] : [];
          links.push(makeLink("PCVR Central", url));

          entries.push({
            id: `pcvrcentral:${slug}`,
            gameKey: normalizeGameKey(game),
            gameTitle: game,
            modName,
            description,
            details: details.join("\n"),
            links: dedupeLinks(links),
            image: imageHref ? new URL(imageHref, url).toString() : null,
            date: null,
            kind: classifyKind(cleanText($("h1").first().parent().text()), modName),
            platforms: ["PCVR"],
            sources: [{ id: "pcvrcentral", name: "PCVR Central", url }],
            author: author || null,
            compatibility: null,
          });
        } catch {
          failed += 1;
        } finally {
          done += 1;
          if (done % 100 === 0) log(`pcvrcentral: ${done}/${target.length}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    log(`pcvrcentral: ${entries.length} entries (${failed} failed)`);
    return { entries, ok: entries.length > 0, error: failed > 0 ? `${failed} detail pages failed` : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`pcvrcentral failed: ${message}`);
    return { entries: [], ok: false, error: message };
  }
}

const [vrPortNews, pcvrCentral] = await Promise.all([
  harvestVrPortNews(),
  harvestPcvrCentral(),
]);

const uniqueEntries = new Map<string, VrModEntry>();
for (const entry of [...vrPortNews.entries, ...pcvrCentral.entries]) {
  if (!uniqueEntries.has(entry.id)) uniqueEntries.set(entry.id, entry);
}
const entries = [...uniqueEntries.values()];

const sources: VrSourceSummary[] = [
  {
    id: "vrportnews",
    name: "VR Port News",
    url: "https://vrportnews.com",
    count: vrPortNews.entries.length,
    ok: vrPortNews.ok,
    ...(vrPortNews.error ? { error: vrPortNews.error } : {}),
  },
  {
    id: "pcvrcentral",
    name: "PCVR Central",
    url: "https://pcvrcentral.com/mods",
    count: pcvrCentral.entries.length,
    ok: pcvrCentral.ok,
    ...(pcvrCentral.error ? { error: pcvrCentral.error } : {}),
  },
];

const catalog: VrModsCatalog = {
  source: "vrportnews.com + pcvrcentral.com",
  generatedAt: Date.now(),
  stale: sources.some((source) => !source.ok),
  entries,
  sources,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
const tmp = `${OUTPUT}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(catalog), "utf8");
fs.renameSync(tmp, OUTPUT);
log(`wrote ${OUTPUT}`);
log(`${entries.length} entries, ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2)} MB`);
