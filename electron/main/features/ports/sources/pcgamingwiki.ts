/**
 * PCGamingWiki "List of unofficial ports" adapter.
 *
 * The public HTML sits behind a Cloudflare challenge, but the MediaWiki API
 * (`action=parse`) serves the same table markup as JSON.
 */
import { httpJson } from "../../../lib/http";
import type { PortSourceProject } from "../../../../../src/types/port";
import { parsePortsHtml } from "../parse";

const API_URL =
  "https://www.pcgamingwiki.com/w/api.php?action=parse&page=List_of_unofficial_ports&prop=text&format=json&formatversion=2";

interface WikiParseResponse {
  parse?: { text?: string };
}

export async function fetchPcgamingwikiProjects(): Promise<PortSourceProject[]> {
  const payload = await httpJson<WikiParseResponse>(API_URL, {
    timeoutMs: 20_000,
    retries: 1,
  });
  const html = payload?.parse?.text;
  if (!html) throw new Error("the wiki returned no table markup");
  const projects = parsePortsHtml(html);
  if (projects.length === 0) throw new Error("no port rows were parsed");
  return projects;
}
