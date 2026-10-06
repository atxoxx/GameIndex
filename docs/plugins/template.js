/// <reference path="./api.d.ts" />
//
// GameIndex plugin template
// =========================
//
// A search plugin is a single `.js` file evaluated in the GameIndex sandbox
// (QuickJS). It declares a manifest by calling `definePlugin(...)` exactly
// once, and exposes a `search(query)` function the host calls for every query.
//
// Files in this folder:
//   - README.md              how plugins work, the lifecycle + security model
//   - api.d.ts               ambient TypeScript declarations (autocomplete)
//   - template.js            this starter
//   - manifest.schema.json   JSON Schema for the descriptor
//
// Quick start
// -----------
//   1. Copy this file into the app's `plugins/` folder and rename it
//      (e.g. `my-source.js`).
//   2. Change the manifest fields — especially `id` (`^[a-z0-9-]+$`).
//   3. Implement `search()` (see the worked example below).
//   4. Validate it:  node scripts/lint-plugins.mjs
//   5. Import it from the app's Sources screen, then toggle it on.
//
// Sandbox rules to keep in mind
// -----------------------------
//   - A *fresh* runtime is created for every search: nothing you store on
//     `globalThis` or in a module-level variable survives between calls.
//   - HTTP is GET-only by default and restricted to http(s) URLs. The host
//     retries transport errors and HTTP 5xx twice; 4xx fails fast.
//   - Each search is capped at 20 s wall clock, 64 MiB of memory and an
//     instruction budget. Keep loops bounded and requests to a handful.
//   - There is NO setTimeout, fetch, filesystem, require or DOM. Use
//     `sleep(ms)` if you must yield, and `parseHtml` for HTML parsing.
//
// Result shaping
// --------------
// `search` must return an array. Every result field is optional, but the more
// you populate the better the host can merge, sort and download. The fields
// the host understands are documented in api.d.ts (PluginResult).

// ─── Manifest ───────────────────────────────────────────────────────────────

definePlugin({
  // `id` is the stable identity of the plugin. Lowercase, digits and hyphens
  // only, e.g. "my-source".
  id: "my-source",
  name: "My Source",
  version: "1.0.0",
  author: "Your Name",
  description: "What this plugin searches for, in one line",
  // The canonical site the plugin queries.
  sourceUrl: "https://example.com",
  // "pc", "console" or "hybrid" — the broad platform class covered.
  platformCategory: "pc",

  // ── Optional manifest fields ─────────────────────────────────────────────
  // Restrict egress to these hosts when the host enforces allow-lists.
  allowedHosts: ["example.com", "cdn.example.com"],
  // Minimum delay between outbound requests (politeness / anti-ban).
  rateLimitMs: 250,
  // How long a search result may be cached, in seconds.
  cacheTtlSecs: 600,
  // Icon shown in the Sources list (URL or built-in icon name).
  icon: "https://example.com/favicon.ico",
  // Project homepage.
  homepage: "https://example.com/my-source",
  // Capability flags your plugin relies on.
  capabilities: ["http", "html"],
  // Optional user-configurable settings. The host renders a form from this
  // JSON-Schema-like object and passes the resolved values to `search` as
  // its second argument.
  config: {
    type: "object",
    properties: {
      category: {
        type: "string",
        title: "Category",
        default: "games",
      },
    },
  },

  // ── Search ───────────────────────────────────────────────────────────────
  // Called once per query in a fresh sandbox. Return an array of results
  // (empty when nothing matches). `config` carries the resolved `config`
  // values declared above; it is `undefined` when no config is declared.
  search: function (query, config) {
    var q = String(query == null ? "" : query).trim();
    if (!q) return [];

    // One HTTP GET. `httpGet` throws on failure, so wrap it and fail soft —
    // a single source going down must never break the whole search.
    var url = "https://example.com/search?q=" + encodeURIComponent(q);
    var html;
    try {
      html = httpGet(url);
    } catch (e) {
      return [];
    }
    if (!html) return [];

    // Parse the response into the host's result shape.
    var items = parseSearch(html);

    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || !item.url || seen[item.url]) continue;
      seen[item.url] = true;
      results.push(shapeResult(item));
    }

    // The starter ships as a safe no-op so an installed-but-unfinished
    // plugin never pollutes the user's search results. Once `parseSearch`
    // and `shapeResult` below are implemented, change this to:
    //
    //     return results;
    //
    // (`results` is already an empty array when nothing matched.)
    return [];
  },
});

// ─── Parsing ────────────────────────────────────────────────────────────────

// Parse the raw response into lightweight intermediate objects. Keep this
// dumb: pull out just enough to identify a hit, then let shapeResult build
// the final result.
function parseSearch(html) {
  var out = [];
  // Example: pull `<a href="/item/123">Title</a>` anchors out of the page.
  // Real sources vary wildly — prefer `parseHtml` when the markup is
  // well-formed, and regex only for the small, stable fragments.
  var re = /<a href="(\/item\/\d+)"[^>]*>([^<]+)<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      url: "https://example.com" + m[1],
      title: decodeEntities(m[2]).trim(),
    });
  }
  return out;
}

// ─── Result shaping ─────────────────────────────────────────────────────────

// Build one PluginResult. Populate as many fields as the source gives you;
// the host tolerates partial results. See api.d.ts for the full field list.
function shapeResult(item) {
  return {
    id: item.url,
    title: item.title,
    url: item.url,
    category: "Games",
    platform: "PC",
    // size: "1.5 GB",          // human-readable size
    // sizeBytes: 1610612736,   // exact bytes
    // infohash: "…",           // lowercase hex
    // magnet: "magnet:?xt=…",
    // torrentUrl: "https://…/file.torrent",
    // directUrls: ["https://…/file.zip"],
    // seeds: 12,
    // peers: 3,
    // uploadDate: 1735689600,      // Unix seconds
    // uploadDateIso: "2025-01-01T00:00:00Z",
    // verified: true,
    // referer: item.url,       // Referer the downloader must send
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Minimal HTML entity decoder. `parseHtml` handles attributes/text for you,
// but a small decoder is handy when you regex raw markup.
function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(parseInt(code, 10));
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // `&amp;` last so `&amp;quot;`-style double encoding stays literal.
    .replace(/&amp;/g, "&");
}
