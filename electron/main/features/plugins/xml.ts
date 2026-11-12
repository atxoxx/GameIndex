/**
 * RSS 2.0 / Torznab feed parser behind the sandbox's `httpGetXml` global.
 *
 * Mirrors the fixed shape produced by `parse_torznab_xml` in
 * `src-tauri/src/plugins/runtime.rs`:
 *
 * ```
 * { title, link, description,                 // null when absent
 *   items: [{ title, link, guid, pubDate, description, size,
 *             enclosure: { url, length, type } | null,
 *             attrs: { seeders: "12", infohash: "…" } | null }] }
 * ```
 *
 * Parsing happens in the host, never in the sandbox: QuickJS has no XML
 * parser, and regex-parsing feeds inside plugins is fragile.
 */
import * as cheerio from "cheerio";

export interface ParsedFeedEnclosure {
  url?: string;
  length?: string;
  type?: string;
}

export interface ParsedFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  size?: string;
  enclosure: ParsedFeedEnclosure | null;
  attrs: Record<string, string> | null;
}

export interface ParsedFeed {
  title: string | null;
  link: string | null;
  description: string | null;
  items: ParsedFeedItem[];
}

function localName(tagName: string | undefined): string {
  if (!tagName) return "";
  const lower = tagName.toLowerCase();
  const colon = lower.indexOf(":");
  return colon >= 0 ? lower.slice(colon + 1) : lower;
}

/**
 * Parse an RSS/Torznab document. Throws a descriptive error when the document
 * cannot be loaded, which the sandbox surfaces as a normal JS exception.
 */
export function parseFeed(xml: string): ParsedFeed {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new Error("httpGetXml: empty feed body");
  }
  const $ = cheerio.load(xml, { xmlMode: true });

  const channelText = (name: string): string | null => {
    const scoped = $(`channel > ${name}`).first().text().trim();
    if (scoped) return scoped;
    const rootLevel = $(`rss > ${name}`).first().text().trim();
    return rootLevel ? rootLevel : null;
  };

  const items: ParsedFeedItem[] = [];
  $("item").each((_index, element) => {
    const item: ParsedFeedItem = { enclosure: null, attrs: null };
    const attrs: Record<string, string> = {};
    let hasAttrs = false;

    $(element)
      .children()
      .each((_childIndex, child) => {
        const name = localName(child.tagName);
        const attribs = (child as { attribs?: Record<string, string> }).attribs ?? {};

        if (name === "attr") {
          const attrName = attribs.name ?? "";
          const attrValue = attribs.value ?? "";
          if (attrName && attrValue && !(attrName in attrs)) {
            attrs[attrName] = attrValue;
            hasAttrs = true;
          }
          return;
        }

        if (name === "enclosure") {
          if (item.enclosure === null) {
            const enclosure: ParsedFeedEnclosure = {};
            if (attribs.url) enclosure.url = attribs.url;
            if (attribs.length) enclosure.length = attribs.length;
            if (attribs.type) enclosure.type = attribs.type;
            item.enclosure = enclosure;
          }
          return;
        }

        // First occurrence of each item child element wins (feeds repeat
        // `<title>`; the Rust parser ignored later duplicates).
        if (name in item) return;
        const text = $(child).text().trim();
        if (!text) return;
        if (
          name === "title" ||
          name === "link" ||
          name === "guid" ||
          name === "pubdate" ||
          name === "description" ||
          name === "size"
        ) {
          const key = name === "pubdate" ? "pubDate" : name;
          (item as unknown as Record<string, string>)[key] = text;
        }
      });

    if (hasAttrs) item.attrs = attrs;
    items.push(item);
  });

  return {
    title: channelText("title"),
    link: channelText("link"),
    description: channelText("description"),
    items,
  };
}
