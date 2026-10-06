# GameIndex plugins

GameIndex search plugins are small JavaScript files that teach the launcher
where to look for games. Each plugin queries one site (or meta-search) and
returns a list of normalized results that the app merges into a single search
view alongside Steam, GOG, Epic and the rest of the library.

A plugin is **one `.js` file**. It declares a manifest by calling
`definePlugin(...)` exactly once and exposes a `search(query)` function. It is
evaluated in a sandboxed JavaScript engine — never with Node, never in the
webview, never with access to the filesystem.

```
plugins/
  my-source.js          ← one plugin per file
```

## Contents

- [How plugins work](#how-plugins-work)
- [Lifecycle: import → install → toggle](#lifecycle-import--install--toggle)
- [Security model](#security-model)
- [The API at a glance](#the-api-at-a-glance)
- [Worked example](#worked-example)
- [Result fields](#result-fields)
- [Manifest fields](#manifest-fields)
- [Authoring checklist](#authoring-checklist)
- [Sibling files](#sibling-files)

---

## How plugins work

1. The host reads a plugin's source text and evaluates it once in a fresh
   sandbox to extract its manifest. This **import validation** proves the file
   parses, calls `definePlugin` exactly once, and declares a `search`
   function.
2. When the user runs a search, the host evaluates the same source again in a
   **brand-new sandbox** and calls `search(query)`. The returned array is
   parsed into the app's result model and merged with every other enabled
   source.
3. Results flow into the normal download pipeline: magnets and `.torrent`
   URLs go to the torrent engine, `directUrls` go to the direct downloader,
   and `url` is offered as an open-in-browser fallback.

Because every search gets a fresh runtime, **plugins are stateless**. Anything
stored on `globalThis`, in a module-level variable, or in a closure is gone by
the next query. Do all caching in the host (via `cacheTtlSecs`) or re-derive
state on each call.

## Lifecycle: import → install → toggle

| Stage      | What happens | Where |
|------------|--------------|-------|
| **Import** | The host evaluates the source in a fresh sandbox and extracts the manifest. A file that does not call `definePlugin` exactly once, or has no callable `search`, is rejected. | Sources screen → *Import plugin* |
| **Install** | The validated source is persisted so it can be re-evaluated on demand. The manifest (`id`, `name`, `version`, `platformCategory`, …) is recorded. | Sources screen |
| **Toggle** | An installed plugin is enabled or disabled per user. Disabled plugins are skipped entirely — no evaluation, no network. | Sources screen |

The `id` in the manifest is the plugin's stable identity. Changing it after
install is treated as a different plugin.

## Security model

Plugins are **untrusted third-party code**. The sandbox is deliberately
minimal:

- **Fresh runtime per search.** No state is shared between calls, so one
  plugin can never observe another plugin's data or a previous query.
- **GET-by-default networking.** `httpGet`/`httpGetJson`/`httpGetXml`/`httpGetAll`
  issue GET requests only, and only to `http://` or `https://` URLs —
  `file://`, `ftp://` and friends are rejected up front. Transport errors and
  HTTP 5xx are retried twice; 4xx fails fast. `httpRequest` can carry a body
  when a source genuinely needs it.
- **20-second wall clock.** The whole evaluation is wrapped in a timeout, so a
  plugin stuck in a busy loop can stall only its own worker thread.
- **64 MiB memory cap.** QuickJS counts all JS heap allocations; a runaway
  `JSON.parse` cannot exhaust the app.
- **Instruction budget.** An interrupt handler stops `while (true) {}` within
  milliseconds.
- **No ambient power.** There is **no `setTimeout`**, **no `fetch`**, **no
  filesystem**, **no `require`/`import`**, and **no DOM**. The only I/O is the
  injected HTTP globals, and the only parsing aid is `parseHtml` plus the
  runtime's own Torznab/RSS parser behind `httpGetXml`.
- **Secrets never reach plugins.** Store credentials live in the OS keychain
  and are not exposed to the sandbox.

Treat everything a plugin fetches as hostile input: bound your loops, guard
your `JSON.parse` calls, and never `eval` remote content.

## The API at a glance

Every sandbox pre-declares these globals. Full signatures and types live in
[`api.d.ts`](./api.d.ts).

| Global | Returns | Notes |
|--------|---------|-------|
| `httpGet(url, referer?)` | `string` | Blocking GET; throws on failure. Optional `Referer` header. |
| `httpGetJson(url, referer?)` | `any` | `JSON.parse(httpGet(...))`. |
| `httpGetXml(url, referer?)` | `object` | Parses an RSS 2.0 / Torznab feed into a plain object. |
| `httpGetAll(urlsOrRequests, referers?)` | `string[]` | Parallel GET; bodies aligned with input, failures become `""`. |
| `httpRequest(url, options?)` | `string` | Lower-level request (GET by default). |
| `httpRequestJson(url, options?)` | `any` | `JSON.parse(httpRequest(...))`. |
| `httpHead(url, referer?)` | `{status, finalUrl, contentType, contentLength}` | Response metadata without a full body. |
| `httpGetBytes(url, referer?)` | `string` | Binary body, base64-encoded. |
| `httpGetTorrent(url, referer?)` | `{name, totalSize, infohash, files}` | Fetch/parse a `.torrent` (or resolve a magnet). |
| `parseHtml(html, selector, limit?)` | `{text, html, attrs}[]` | CSS-selector HTML extraction. |
| `sleep(ms)` | `void` | Block the current search briefly. |
| `definePlugin(descriptor)` | `void` | Register the manifest + `search`. Call exactly once. |

`httpGetXml` returns a fixed shape:

```js
{
  title, link, description,            // channel-level (null when absent)
  items: [{
    title, link, guid, pubDate, description, size,
    enclosure: { url, length, type } | null,
    attrs: { seeders: "12", infohash: "…", … } | null
  }]
}
```

## Worked example

A minimal plugin that searches a hypothetical JSON API, shapes the results,
and fails soft:

```js
definePlugin({
  id: "example",
  name: "Example",
  version: "1.0.0",
  author: "You",
  description: "Example JSON search source",
  sourceUrl: "https://example.com",
  platformCategory: "pc",

  search: function (query) {
    var q = String(query == null ? "" : query).trim();
    if (!q) return [];

    var url = "https://example.com/api/search?q=" + encodeURIComponent(q);
    var data;
    try {
      data = httpGetJson(url);
    } catch (e) {
      return []; // one source down must never break the whole search
    }
    if (!data || !Array.isArray(data.items)) return [];

    var out = [];
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i];
      if (!it || !it.id) continue;
      out.push({
        id: String(it.id),
        title: String(it.title || ""),
        url: it.pageUrl || null,
        size: it.sizeLabel || null,
        sizeBytes: it.sizeBytes != null ? Number(it.sizeBytes) : null,
        infohash: it.infohash || null,
        magnet: it.magnet || null,
        seeds: it.seeders != null ? Number(it.seeders) : null,
        peers: it.leechers != null ? Number(it.leechers) : null,
        uploadDateIso: it.publishedAt || null,
        verified: it.trusted === true,
        category: it.category || null,
        platform: it.platform || "PC"
      });
    }
    return out;
  }
});
```

A heavier example that opens several game pages in parallel:

```js
var pages = httpGetAll(pageUrls);
for (var i = 0; i < pages.length; i++) {
  var html = pages[i];       // "" when that fetch failed
  if (!html) continue;
  // parse html[i] into a result…
}
```

For a commented starter you can copy, see
[`template.js`](./template.js).

## Result fields

`search` must return an **array**. Every field is optional, but populating
more lets the host merge, sort and download more accurately.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Stable id for the hit (often the infohash or page URL). |
| `title` | string | Display title. |
| `size` | string \| number | Human-readable size, e.g. `"1.5 GB"`. |
| `sizeBytes` | number | Exact size in bytes (sorting/filtering). |
| `infohash` | string | BitTorrent v1 infohash (lowercase hex). |
| `magnet` | string | `magnet:` URI. |
| `torrentUrl` | string | Direct `.torrent` URL. |
| `seeds` | number | Seeders. |
| `peers` | number | Leechers. |
| `uploadDate` | number | Upload time, Unix seconds. |
| `uploadDateIso` | string | Upload time, ISO-8601. |
| `verified` | boolean | Source vouches for the file. |
| `url` | string | Page URL / open-in-browser fallback. |
| `category` | string | Category label (`"Repack"`, `"ROM"`, …). |
| `platform` | string | Target platform/console (`"Nintendo Switch"`, `"PC"`). |
| `directUrls` | string[] | Direct HTTP mirrors (non-torrent). |
| `provenance` | string | Upstream site a meta-search hit came from. |
| `referer` | string | `Referer` the downloader must send for this hit. |
| `matchTitle` | string | Matched title when distinct from `title`. |
| `fileList` | `{name, size}[]` | Files contained in the release. |
| `checksums` | `{algo, value}[]` | Checksums computed by the plugin. |
| `version` | string | Build / release version. |
| `region` | string | Region code (`"USA"`, `"EUR"`, `"JPN"`). |
| `coverUrl` | string | Cover-art URL. |
| `description` | string | Long-form description. |
| `releaseGroup` | string | Release / scene group. |
| `recommended` | boolean | Host should recommend this hit. |

## Manifest fields

The object passed to `definePlugin`. See
[`manifest.schema.json`](./manifest.schema.json) for the machine-readable
schema.

| Field | Required | Type | Notes |
|-------|:--------:|------|-------|
| `id` | ✅ | string | Must match `^[a-z0-9-]+$`. Stable identity. |
| `name` | ✅ | string | Display name. |
| `version` | ✅ | string | Semver, e.g. `"1.0.0"`. |
| `author` | ✅ | string | Maintainer. |
| `description` | ✅ | string | One-line summary. |
| `sourceUrl` | ✅ | string | Canonical site queried. |
| `platformCategory` | ✅ | `"pc"` \| `"console"` \| `"hybrid"` | Broad platform class. |
| `allowedHosts` | | string[] | Egress allow-list, when enforced. |
| `rateLimitMs` | | number | Minimum delay between requests. |
| `cacheTtlSecs` | | number | Result cache TTL. |
| `icon` | | string | Icon URL or built-in name. |
| `homepage` | | string | Project homepage. |
| `capabilities` | | string[] | Declared capability flags. |
| `config` | | object | JSON-Schema-like user settings. |
| `search` | ✅ | function | `search(query, config) -> PluginResult[]`. |

## Authoring checklist

- [ ] `definePlugin` is called **exactly once**.
- [ ] `id` matches `^[a-z0-9-]+$` and is unique.
- [ ] `platformCategory` is `pc`, `console` or `hybrid`.
- [ ] `search` returns an array and returns `[]` for empty/unmatched queries.
- [ ] Every network call is wrapped in `try/catch` and fails soft.
- [ ] Loops are bounded; no unbounded `while` over remote data.
- [ ] No reliance on state persisting between searches.
- [ ] `node scripts/lint-plugins.mjs` passes.
- [ ] `node --check plugins/your-plugin.js` passes.

## Sibling files

- [`api.d.ts`](./api.d.ts) — ambient TypeScript declarations for every global,
  the manifest and the result shape. Reference it from your plugin for
  autocomplete.
- [`template.js`](./template.js) — a heavily-commented starter plugin.
- [`manifest.schema.json`](./manifest.schema.json) — JSON Schema (draft
  2020-12) for the descriptor.
- `scripts/lint-plugins.mjs` — static checks for the rules above.
- `scripts/test-plugins.mjs` — runs a plugin's `search` against the live
  network outside the app.
