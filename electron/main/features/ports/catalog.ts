/**
 * PCGamingWiki "List of unofficial ports" scraper.
 *
 * Why the MediaWiki API instead of the rendered page: the public HTML sits
 * behind a Cloudflare challenge that a plain HTTP client cannot pass, while
 * `action=parse` answers with the same table markup as JSON.
 *
 * Live-fetch policy (the product decision): every page open asks the wiki
 * again, with a short in-memory TTL so a re-render or a second tab does not
 * hammer it. If the network fails, the last successful payload on disk is
 * served with `stale: true` so the tab still works offline.
 */
import fs from "node:fs";
import path from "node:path";

import { httpJson } from "../../lib/http";
import { cachePath } from "../../lib/paths";
import { PORTS_SOURCE_URL, type PortsCatalog } from "../../../../src/types/port";
import { parsePortsHtml } from "./parse";

const API_URL =
  "https://www.pcgamingwiki.com/w/api.php?action=parse&page=List_of_unofficial_ports&prop=text&format=json&formatversion=2";
const MEMORY_TTL_MS = 10 * 60_000;

interface WikiParseResponse {
  parse?: { text?: string };
}

let memory: { at: number; catalog: PortsCatalog } | null = null;

function catalogFile(): string {
  return cachePath("ports", "catalog.json");
}

function writeDisk(catalog: PortsCatalog): void {
  try {
    const file = catalogFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(catalog), "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    console.warn("[ports] could not persist catalog:", error);
  }
}

function readDisk(): PortsCatalog | null {
  try {
    const raw = fs.readFileSync(catalogFile(), "utf8");
    const parsed = JSON.parse(raw) as PortsCatalog;
    if (!parsed || !Array.isArray(parsed.projects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Live catalog with a disk fallback. `refresh` bypasses the memory cache. */
export async function fetchPortsCatalog(refresh = false): Promise<PortsCatalog> {
  if (!refresh && memory && Date.now() - memory.at < MEMORY_TTL_MS) {
    return memory.catalog;
  }

  try {
    const payload = await httpJson<WikiParseResponse>(API_URL, {
      timeoutMs: 20_000,
      retries: 1,
    });
    const html = payload?.parse?.text;
    if (!html) throw new Error("the wiki returned no table markup");

    const projects = parsePortsHtml(html);
    if (projects.length === 0) throw new Error("no port rows were parsed");

    const catalog: PortsCatalog = {
      source: PORTS_SOURCE_URL,
      fetchedAt: Date.now(),
      stale: false,
      projects,
    };
    memory = { at: Date.now(), catalog };
    writeDisk(catalog);
    return catalog;
  } catch (error) {
    const disk = readDisk();
    if (disk) return { ...disk, stale: true };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not load the unofficial ports list from PCGamingWiki (${message}). Check your connection and try again.`,
    );
  }
}
