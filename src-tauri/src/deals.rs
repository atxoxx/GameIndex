//! Backend support for the `/deals` page.
//!
//! Two data sources power the Deals tab:
//!   1. Xbox GamePass catalog  — `fetch_gamepass_catalog`
//!   2. IsThereAnyDeal specials — `fetch_isthereanydeal_deals`
//!
//! ## GamePass
//!
//! The public Microsoft catalog is fetched in two steps (mirrors the
//! approach used by `darklinkpower/PlayniteExtensionsCollection`
//! GamePassCatalogBrowser and the `Playnite_XCloud_Library`
//! `XBoxHelper`):
//!
//!   1. `https://catalog.gamepass.com/sigls/v2?id={GUID}&market=...&language=...`
//!      returns a JSON array of `{ "id": "..." }` entries.
//!   2. `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=...`
//!      fetches full product metadata. We batch the IDs in groups of
//!      25 to keep the URL short.
//!
//! ## IsThereAnyDeal
//!
//! ITAD's homepage at <https://isthereanydeal.com/> is server-rendered
//! (Svelte SSR), so we can scrape the deal cards directly with
//! `reqwest` + `scraper` — no API key required.
//!
//! Each deal card on the page is an `<a class="deal ..." href="https://itad.link/UUID/">`
//! block. The game title is a sibling `<a class="title ..." href="/game/{slug}/info/">`
//! in the same wrapper. Inside the deal card:
//!   - `<span class="cut">-90%</span>` for the discount percent
//!   - `<span class="price">1,59</span>` for the current price (EU format, EUR)
//!   - `<div class="shop">Steam</div>` for the store display name
//!
//! The `itad.link` URL is a tracking redirect; we follow it in
//! parallel (HEAD, 5 s timeout, 8 concurrent) to resolve the direct
//! store URL (Steam, Epic, etc.). On failure we fall back to the
//! itad.link URL.

use futures::stream::{self, StreamExt};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// ─── Data types ─────────────────────────────────────────────────────────────

/// A single Xbox GamePass catalog entry.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GamePassGame {
    /// Stable product id from the Microsoft catalog.
    pub id: String,
    /// Human-readable title.
    pub title: String,
    /// Optional marketing blurb.
    pub description: Option<String>,
    /// Square/poster image URL (already prefixed with `https:` and
    /// reformatted to a reasonable size).
    pub cover_image: Option<String>,
    /// Developer name (split from the catalog's combined string).
    pub developer: Option<String>,
    /// Publisher name (split from the catalog's combined string).
    pub publisher: Option<String>,
    /// Category / genre names attached to the product.
    pub categories: Vec<String>,
    /// Platform names ("Xbox", "PC", "Cloud").
    pub platforms: Vec<String>,
    /// ISO 8601 release date string.
    pub release_date: Option<String>,
    /// Microsoft ProductId (used for Xbox store deeplink).
    pub product_id: Option<String>,
    /// Direct Xbox store URL.
    pub deeplink: Option<String>,
}

/// A single IsThereAnyDeal row scraped from the homepage.
///
/// `deal_price` is the current price in EUR. The original price is
/// not present in the homepage scrape, so we don't expose it.
/// `thumbnail` and `expiration` are likewise unavailable from the
/// homepage; the frontend uses a fallback icon for the former and
/// hides the "ends in" badge when the latter is `None`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DealItem {
    /// Composite deal id (the ITAD link UUID).
    pub id: String,
    /// Game title.
    pub game_title: String,
    /// Store display name (e.g. "Steam", "Epic Game Store").
    pub store_name: String,
    /// Direct store URL (resolved from the itad.link redirect).
    pub store_url: String,
    /// Current price in EUR.
    pub deal_price: f64,
    /// Discount percent (0-100).
    pub discount_percent: i32,
    /// ISO 8601 expiration timestamp (always `None` from the homepage).
    pub expiration: Option<String>,
    /// Platform name (always "Windows" — the homepage doesn't expose it).
    pub platform: String,
    /// Square thumbnail (always `None` — the homepage has no images).
    pub thumbnail: Option<String>,
}

/// Filters for the GamePass catalog. Empty/`None` fields = no filter.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamePassFilters {
    pub region: Option<String>,
    pub categories: Option<Vec<String>>,
    pub platform: Option<String>,
}

/// Filters for IsThereAnyDeal. Empty/`None` fields = no filter.
///
/// `platform` is kept for API compatibility with the frontend but is
/// ignored — the ITAD homepage doesn't expose per-deal platform
/// information, so we can't filter on it. Use `store` for
/// storefront-specific filtering.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DealsFilters {
    pub platform: Option<String>,
    pub min_discount: Option<i32>,
    pub store: Option<String>,
}

/// A single free game from the ITAD giveaways list.
///
/// ITAD's `/giveaways/` page is powered by a JSON API
/// (`/giveaways/api/list/?tab=live`). Each entry in the response is
/// a "giveaway" that bundles one or more free games behind a single
/// claim URL (e.g. "The Life and Suffering of Sir Brante free on
/// Steam"). We flatten every entry's `games` array into one
/// `Giveaway` per individual game so the frontend can show a card
/// per title, with the parent giveaway's title kept for context.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Giveaway {
    /// Composite id (`"{giveawayId}-{gameId}"`) — unique per card.
    pub id: String,
    /// Individual game title (e.g. "The Life and Suffering of Sir Brante").
    pub title: String,
    /// Parent giveaway title (e.g. "...free on Steam") for context.
    pub bundle_title: String,
    /// Storefront display name derived from the claim URL host
    /// (e.g. "Steam", "Humble Bundle", "Epic Game Store").
    pub store_name: String,
    /// Box-art / cover image URL. `None` when ITAD doesn't expose
    /// one — the frontend shows a fallback icon.
    pub image_url: Option<String>,
    /// Direct claim URL (the giveaway's `url`, already the real
    /// store/claim page — no affiliate redirect to resolve).
    pub deal_url: String,
    /// 18+ flag.
    pub is_mature: bool,
    /// ISO 8601 expiration timestamp. `None` when no expiry is set.
    pub expiry: Option<String>,
}

// ─── Shared HTTP helpers ────────────────────────────────────────────────────

/// Build a shared HTTP client that mimics a real browser. Without
/// browser-like headers, both Microsoft and ITAD will block us.
/// The cookie store is enabled so the giveaways API can reuse the
/// `sess2` session cookie set by the `/giveaways/` page.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(30))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

// ─── GamePass: Step 1 (list of IDs) ─────────────────────────────────────────

/// Catalog GUID hardcoded in xbox.com and used by all third-party
/// GamePass catalog scrapers. Identifies "Game Pass" itself.
const GAMEPASS_CATALOG_GUID: &str = "29a81209-df6f-41fd-a528-2ae6b91f719c";

/// Maximum number of `bigIds` to request in a single
/// `displaycatalog.mp.microsoft.com` call. Microsoft's docs do not
/// publish a hard cap, but 25 keeps the URL well under 8 KB and is
/// what the reference implementations use.
const GAMEPASS_BATCH_SIZE: usize = 25;

#[derive(Debug, Deserialize)]
struct SiglsResponseEntry {
    id: Option<String>,
}

/// Fetch the list of Game Pass product IDs for a given market.
async fn fetch_gamepass_ids(
    client: &reqwest::Client,
    market: &str,
    language: &str,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://catalog.gamepass.com/sigls/v2?id={}&market={}&language={}",
        GAMEPASS_CATALOG_GUID, market, language
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GamePass sigls request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GamePass sigls returned status {}",
            resp.status()
        ));
    }
    let parsed: Vec<SiglsResponseEntry> = resp
        .json()
        .await
        .map_err(|e| format!("GamePass sigls parse error: {}", e))?;
    Ok(parsed.into_iter().filter_map(|e| e.id).collect())
}

// ─── GamePass: Step 2 (metadata in batches) ─────────────────────────────────

#[derive(Debug, Deserialize)]
struct DisplayImage {
    #[serde(rename = "ImagePurpose")]
    image_purpose: Option<String>,
    // The v7.0 catalog uses PascalCase `Uri`; without the rename
    // this silently deserializes to `None` and every image is
    // dropped from the grid.
    #[serde(rename = "Uri")]
    uri: Option<String>,
    #[serde(rename = "Width")]
    width: Option<u32>,
    #[serde(rename = "Height")]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct DisplayLocalizedProps {
    #[serde(rename = "ProductTitle")]
    product_title: Option<String>,
    #[serde(rename = "ShortDescription")]
    short_description: Option<String>,
    #[serde(rename = "DeveloperName")]
    developer_name: Option<String>,
    #[serde(rename = "PublisherName")]
    publisher_name: Option<String>,
    // The v7.0 catalog uses PascalCase `Images`; without the rename
    // every card would render the placeholder instead of a cover.
    #[serde(rename = "Images")]
    images: Option<Vec<DisplayImage>>,
}

#[derive(Debug, Deserialize)]
struct DisplayProduct {
    #[serde(rename = "ProductId")]
    product_id: Option<String>,
    #[serde(rename = "ProductBSchema")]
    product_b_schema: Option<String>,
    #[serde(rename = "LocalizedProperties")]
    localized_properties: Option<Vec<DisplayLocalizedProps>>,
    #[serde(rename = "MarketProperties")]
    market_properties: Option<Vec<DisplayMarketProps>>,
    #[serde(rename = "Properties")]
    properties: Option<DisplayProperties>,
}

#[derive(Debug, Deserialize)]
struct DisplayMarketProps {
    #[serde(rename = "OriginalReleaseDate")]
    original_release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DisplayProperties {
    // `Properties.Categories` has shipped in two shapes across the
    // v7.0 catalog: a JSON array of `{ "name": "..." }` objects
    // and a plain comma-separated string. We accept the raw JSON
    // value and normalize in `extract_categories` so the rest of
    // the code can treat both shapes uniformly without panicking
    // on a string-where-array mismatch.
    #[serde(rename = "Categories")]
    categories: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct DisplayCatalogResponse {
    // The displaycatalog v7.0 response wraps the product list under
    // a capital-P `Products` key. Without this rename serde silently
    // hits the `default` branch and returns an empty Vec — which
    // is exactly the bug that drove the empty-grid symptom.
    #[serde(rename = "Products", default)]
    products: Vec<DisplayProduct>,
}

/// Fetch full metadata for a batch of Game Pass IDs.
async fn fetch_gamepass_metadata_batch(
    client: &reqwest::Client,
    ids: &[String],
    market: &str,
    language: &str,
) -> Result<Vec<DisplayProduct>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let big_ids = ids.join(",");
    let url = format!(
        "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={}&market={}&languages={}&MS-CV=F.1",
        urlencoding::encode(&big_ids),
        urlencoding::encode(market),
        urlencoding::encode(language),
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GamePass displaycatalog request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GamePass displaycatalog returned status {}",
            resp.status()
        ));
    }
    let parsed: DisplayCatalogResponse = resp
        .json()
        .await
        .map_err(|e| format!("GamePass displaycatalog parse error: {}", e))?;
    Ok(parsed.products)
}

// ─── GamePass: cover image URL helper ───────────────────────────────────────

/// Pick the best cover image for a product. The reference plugin
/// prefers the `Poster` purpose; we fall back through the catalog
/// of known purpose values to maximize hit rate.
fn best_cover_for(product: &DisplayProduct) -> Option<String> {
    // Preferred order — matches the ImagePurpose enum used by the
    // Playnite reference plugin.
    const PREFERRED: &[&str] = &[
        "Poster",
        "BoxArt",
        "TitledHeroArt",
        "HeroArt",
        "SuperHeroArt",
        "Screenshot",
    ];
    let images = product
        .localized_properties
        .as_ref()
        .and_then(|lp| lp.first())
        .and_then(|lp0| lp0.images.as_ref())?;

    for purpose in PREFERRED {
        if let Some(img) = images.iter().find(|i| {
            i.image_purpose
                .as_deref()
                .map(|p| p.eq_ignore_ascii_case(purpose))
                .unwrap_or(false)
        }) {
            if let Some(url) = normalize_image_url(&img.uri, img.width, img.height) {
                return Some(url);
            }
        }
    }
    // Final fallback — any image with a URI.
    images
        .iter()
        .find_map(|i| normalize_image_url(&i.uri, i.width, i.height))
}

/// Microsoft returns naked paths like
/// `//store-images.s-microsoft.com/image/apps.9999.123/banner.jpg`
/// — prefix with `https:` and append a sane size hint so the
/// browser doesn't pull the full-resolution original.
fn normalize_image_url(
    raw: &Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<String> {
    let raw = raw.as_deref()?.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.starts_with("//") {
        format!("https:{}", raw)
    } else if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with('/') {
        format!("https://store-images.s-microsoft.com{}", raw)
    } else {
        format!("https://{}", raw)
    };
    // Don't double-append format params.
    if with_scheme.contains('?') {
        return Some(with_scheme);
    }
    let w = width.unwrap_or(480);
    let h = height.unwrap_or(480);
    Some(format!("{}?w={}&h={}", with_scheme, w, h))
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Fetch the Xbox GamePass catalog, optionally narrowed by region /
/// category / platform filters. The fetch is best-effort: on failure
/// we return a string error so the frontend can show a message.
#[tauri::command]
pub async fn fetch_gamepass_catalog(
    filters: GamePassFilters,
) -> Result<Vec<GamePassGame>, String> {
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return Err(e),
    };

    // Microsoft uses the short market code (e.g. "US") and the full
    // locale string (e.g. "en-US"). Derive the locale from the
    // market so we get reasonable defaults.
    let market = filters.region.as_deref().unwrap_or("US");
    let language = locale_for_market(market);

    // Step 1: list of IDs
    let ids = fetch_gamepass_ids(&client, market, &language).await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: metadata in batches, fired in parallel. A 500-game
    // catalog would otherwise mean 20 round-trips in series; with
    // join_all we collapse to a single round-trip's worth of
    // wall-clock time. Individual batch failures are logged and
    // skipped — one bad batch doesn't fail the whole fetch.
    let batch_futures = ids
        .chunks(GAMEPASS_BATCH_SIZE)
        .map(|chunk| fetch_gamepass_metadata_batch(&client, chunk, market, &language))
        .collect::<Vec<_>>();
    let batch_results = futures::future::join_all(batch_futures).await;
    let mut all_products: Vec<DisplayProduct> = Vec::with_capacity(ids.len());
    for result in batch_results {
        match result {
            Ok(mut batch) => all_products.append(&mut batch),
            Err(e) => eprintln!("[deals] GamePass batch failed: {}", e),
        }
    }

    // Step 3: map into our DTO and apply category filter.
    let mut games: Vec<GamePassGame> = Vec::with_capacity(all_products.len());
    for p in all_products {
        // Filter out DLC / add-ons — they have ProductBSchema
        // "ProductAddOn;3" and the user wants base games.
        if let Some(ref schema) = p.product_b_schema {
            if schema.starts_with("ProductAddOn") {
                continue;
            }
        }

        let lp0 = match p.localized_properties.as_ref().and_then(|lp| lp.first()) {
            Some(lp) => lp,
            None => continue,
        };

        let title = match lp0.product_title.as_deref() {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => continue,
        };

        // Category filter — applies against the Properties.Categories
        // list (the same source the rest of the XBOX UI uses). Each
        // chip is first expanded via `category_aliases` (e.g. "RPG"
        // → "Role playing", "Sports & racing" → "Sports" + "Racing &
        // flying") and then matched case-insensitively as either an
        // exact match or a prefix. The prefix branch covers any
        // future verbose variants the catalog might ship without
        // needing to update the alias map.
        if let Some(ref want_cats) = filters.categories {
            if !want_cats.is_empty() {
                let cats = extract_categories(p.properties.as_ref());
                let matches_any = want_cats.iter().any(|want| {
                    let aliases = category_aliases(want);
                    cats.iter().any(|pc| {
                        let pc_lc = pc.to_ascii_lowercase();
                        aliases.iter().any(|alias| {
                            let alias_lc = alias.to_ascii_lowercase();
                            pc_lc == alias_lc || pc_lc.starts_with(&alias_lc)
                        })
                    })
                });
                if !matches_any {
                    continue;
                }
            }
        }

        let cover = best_cover_for(&p);
        let categories = extract_categories(p.properties.as_ref());
        let platforms = platforms_for(filters.platform.as_deref());
        // The Xbox store URL requires a slug derived from the title,
        // not just the productId. The bare `/games/store/{pid}` shape
        // 404s for most titles; the canonical
        // `/games/store/{slug}/{pid}` format (used by the Microsoft
        // Store itself) is what resolves to the correct product page.
        // We verified all three shapes against a live API call — only
        // `/games/store/{slug}/{pid}` and `/games/store/x/{pid}` return
        // 200, and the slug form produces the canonical product page
        // rather than a redirect.
        let deeplink = p.product_id.as_deref().map(|pid| {
            let slug = slugify(&title);
            if slug.is_empty() {
                format!("https://www.xbox.com/en-US/games/store/x/{}", pid)
            } else {
                format!("https://www.xbox.com/en-US/games/store/{}/{}", slug, pid)
            }
        });
        let release_date = p
            .market_properties
            .as_ref()
            .and_then(|mp| mp.first())
            .and_then(|mp0| mp0.original_release_date.clone());

        games.push(GamePassGame {
            id: p.product_id.clone().unwrap_or_default(),
            title,
            description: lp0.short_description.clone(),
            cover_image: cover,
            developer: split_first(&lp0.developer_name),
            publisher: split_first(&lp0.publisher_name),
            categories,
            platforms,
            release_date,
            product_id: p.product_id,
            deeplink,
        });
    }

    Ok(games)
}

/// Fetch current deals from IsThereAnyDeal by scraping the homepage
/// HTML directly. No API key required.
///
/// Implementation:
///   1. GET `https://isthereanydeal.com/` (server-rendered Svelte).
///   2. Parse the deal cards (`a.deal`) with the `scraper` crate.
///   3. Apply the user's `min_discount` and `store` filters.
///   4. Follow each `itad.link` redirect in parallel (HEAD, 5 s
///      timeout, 8 concurrent) to get the direct store URL.
///
/// On any network or parse failure we return a string error so the
/// frontend can display a message. Empty results are not errors.
#[tauri::command]
pub async fn fetch_isthereanydeal_deals(
    filters: DealsFilters,
) -> Result<Vec<DealItem>, String> {
    let client = http_client()?;

    // Step 1: fetch the homepage.
    let html = fetch_itad_homepage(&client).await?;

    // Step 2: parse the deal cards out of the HTML.
    let mut deals = parse_itad_deals(&html)?;

    // Step 3: apply user filters BEFORE resolving redirects so we
    // don't waste HTTP round-trips on deals we're going to drop.
    let min_discount = filters.min_discount.unwrap_or(0);
    let want_store = filters
        .store
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    deals.retain(|d| d.discount_percent >= min_discount);
    if !want_store.is_empty() && want_store != "all" {
        deals.retain(|d| d.store_name.to_ascii_lowercase().contains(&want_store));
    }
    // `filters.platform` is intentionally ignored — see `DealsFilters`.

    // Sort highest discount first (matches the previous behavior).
    deals.sort_by(|a, b| b.discount_percent.cmp(&a.discount_percent));

    // Step 4: resolve `itad.link` redirects in parallel.
    resolve_redirects(&client, &mut deals).await;

    Ok(deals)
}

/// Open a URL in the user's default browser. We delegate to the
/// `tauri-plugin-opener` plugin (already wired into the builder) so
/// behavior is consistent with the rest of the app. We restrict to
/// `http(s)` schemes as a defense-in-depth check — URLs are sourced
/// from an untrusted ITAD scrape. Scheme matching is case-insensitive
/// per RFC 3986 §3.1.
#[tauri::command]
pub fn open_deal_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Cannot open an empty URL".to_string());
    }
    let scheme = trimmed
        .split_once(':')
        .map(|(s, _)| s.to_ascii_lowercase());
    if !matches!(scheme.as_deref(), Some("http") | Some("https")) {
        return Err(format!(
            "Refusing to open URL with disallowed scheme: {}",
            trimmed
        ));
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

// ─── ITAD scraper ───────────────────────────────────────────────────────────

/// ITAD homepage URL. Server-rendered (Svelte SSR) so a plain GET
/// returns all the deal cards in the HTML — no JavaScript execution
/// required.
const ITAD_HOMEPAGE: &str = "https://isthereanydeal.com/";

/// Maximum number of concurrent `itad.link` redirect resolutions.
/// 8 strikes a balance between wall-clock latency and not hammering
/// the ITAD redirector (which ultimately points at Steam / Epic /
/// GOG / etc., so we want to be polite).
const REDIRECT_CONCURRENCY: usize = 8;

/// Per-request timeout for resolving a single `itad.link` redirect.
/// Short enough that a slow upstream doesn't stall the whole fetch.
const REDIRECT_TIMEOUT_SECS: u64 = 5;

/// Fetch the raw HTML of the ITAD homepage.
async fn fetch_itad_homepage(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .get(ITAD_HOMEPAGE)
        .send()
        .await
        .map_err(|e| format!("ITAD request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("ITAD returned status {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("ITAD body read failed: {}", e))
}

/// Parse the ITAD homepage HTML into a list of `DealItem`s.
///
/// Selectors are anchored on the stable class names ITAD uses
/// (Svelte adds a scope hash like `svelte-1lrr027`, but the base
/// `deal`, `title`, `cut`, `price`, `shop` class names are part of
/// the component contract and survive every rebuild).
///
/// Returns an empty Vec when the page is empty or the structure
/// changes; the caller treats that as "no current deals" rather
/// than an error. A genuine parse error (e.g. malformed HTML) is
/// caught by the scraper crate and yields an empty Vec — ITAD
/// redesigns would show up as "no deals" rather than a hard crash.
fn parse_itad_deals(html: &str) -> Result<Vec<DealItem>, String> {
    // The function body is wrapped in an inner block so we can
    // short-circuit on the "0 deals parsed" case and emit a
    // diagnostic log without duplicating the empty-return
    // statement. The scraper crate never returns an `Err` for a
    // missing selector match — it just yields an empty iterator
    // — so the only way to detect an ITAD redesign from here is
    // to count what we actually found.
    let document = Html::parse_document(html);
    let deal_sel = Selector::parse("a.deal").map_err(|e| format!("bad selector a.deal: {:?}", e))?;
    let title_sel = Selector::parse("a.title").map_err(|e| format!("bad selector a.title: {:?}", e))?;
    let cut_sel = Selector::parse("span.cut").map_err(|e| format!("bad selector span.cut: {:?}", e))?;
    let price_sel = Selector::parse("span.price").map_err(|e| format!("bad selector span.price: {:?}", e))?;
    let shop_sel = Selector::parse("div.shop").map_err(|e| format!("bad selector div.shop: {:?}", e))?;

    let mut deals = Vec::new();
    // We track whether we ever saw an `a.deal` element at all
    // so we can distinguish "ITAD has no current deals" (legit
    // empty) from "our scraper broke because ITAD redesigned"
    // (silent regression). The frontend treats both as "no
    // deals", but the latter is debuggable from stderr.
    let mut raw_deal_count = 0usize;
    for deal_a in document.select(&deal_sel) {
        raw_deal_count += 1;
        // Game title — sibling `a.title` inside the same parent.
        // HTML forbids `<a>` inside `<a>`, so the title MUST be
        // outside the deal `<a>`; the parent is a wrapper `<div>`
        // containing both. `ElementRef::parent()` returns a
        // `NodeRef<Node>` (from the `ego_tree` crate), and the
        // `select` method only exists on `ElementRef` — so we
        // wrap the node first. `ElementRef::wrap` yields `None`
        // if the parent happens to be a non-element node (text,
        // comment, etc.), which is the correct signal to skip
        // this card.
        let game_title = deal_a
            .parent()
            .and_then(ElementRef::wrap)
            .and_then(|p| p.select(&title_sel).next())
            .map(|t| t.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let game_title = match game_title {
            Some(t) => t,
            None => continue,
        };

        // Discount % — `<span class="cut">-90%</span>`.
        let discount_percent: i32 = deal_a
            .select(&cut_sel)
            .next()
            .and_then(|e| {
                let s: String = e.text().collect();
                parse_discount_percent(&s)
            })
            .unwrap_or(0);
        if discount_percent <= 0 {
            // A 0% deal isn't really a deal — skip it.
            continue;
        }

        // Current price — `<span class="price">1,59</span>` (EU
        // number format with a comma decimal separator).
        let deal_price: f64 = deal_a
            .select(&price_sel)
            .next()
            .and_then(|e| {
                let s: String = e.text().collect();
                parse_price_eur(&s)
            })
            .unwrap_or(0.0);

        // Store name — `<div class="shop"><span>Steam</span></div>`.
        // We read the whole text content of the wrapper so we get
        // just the store name (the wrapper also contains an inline
        // color swatch `<span class="mark">` with no text).
        let store_name: String = deal_a
            .select(&shop_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s: &String| !s.is_empty())
            .unwrap_or_else(|| "Unknown Store".to_string());

        // Deal URL and id — pulled from the `href` of the deal `<a>`.
        let raw_url = deal_a
            .value()
            .attr("href")
            .unwrap_or("")
            .trim()
            .to_string();
        if raw_url.is_empty() {
            continue;
        }
        // The id is the trailing UUID in the itad.link URL.
        let id = raw_url
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or(&raw_url)
            .to_string();

        deals.push(DealItem {
            id,
            game_title,
            store_name,
            store_url: raw_url,
            deal_price,
            discount_percent,
            expiration: None,
            // ITAD's homepage doesn't expose a per-deal platform
            // list. All deals are Windows PC unless the user
            // follows the link and inspects the destination store.
            platform: "Windows".to_string(),
            thumbnail: None,
        });
    }
    // Sanity check: if we saw deal `<a>` elements but parsed zero
    // of them into a DealItem, the page structure has almost
    // certainly changed (every deal was dropped by one of the
    // `continue` guards above). Log enough of the page to make
    // the next redesign debuggable from stderr.
    if raw_deal_count > 0 && deals.is_empty() {
        let snippet: String = html
            .chars()
            .filter(|c| !c.is_control())
            .take(800)
            .collect();
        eprintln!(
            "[deals] Saw {} deal <a> elements but parsed 0 — ITAD page structure may have changed. First 800 chars: {}",
            raw_deal_count, snippet
        );
    }
    Ok(deals)
}

/// Parse an ITAD discount string like `"-90%"` or `"-51 %"` into
/// an integer percent. Returns `None` for any input that doesn't
/// contain at least one digit — the caller treats that as "no
/// discount" and drops the deal.
fn parse_discount_percent(raw: &str) -> Option<i32> {
    let digits: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// Parse an ITAD price string into an `f64`. Accepts both EU format
/// (`"1,59"`, comma decimal) and US format (`"1.59"`, dot decimal) —
/// the first separator wins. Strips currency glyphs, whitespace,
/// and any other non-numeric noise. Returns `None` if no digits
/// are present.
///
/// ITAD's homepage ships EU-format prices like `"1,59"` and
/// `"0,00"`; the US-format tolerance is a safety net for any
/// future ITAD locale change.
fn parse_price_eur(raw: &str) -> Option<f64> {
    // Keep only digits, one decimal point, and a leading minus.
    let mut cleaned = String::with_capacity(raw.len());
    let mut seen_dot = false;
    for c in raw.chars() {
        if c.is_ascii_digit() {
            cleaned.push(c);
        } else if (c == ',' || c == '.') && !seen_dot {
            // Treat the FIRST separator as the decimal point,
            // whether it's a comma (EU) or a dot (US). This makes
            // the parser tolerant of ITAD formatting changes.
            cleaned.push('.');
            seen_dot = true;
        } else if c == '-' && cleaned.is_empty() {
            cleaned.push('-');
        }
    }
    cleaned.parse().ok()
}

/// Follow each `itad.link` URL in `deals` and replace it with the
/// final store URL (the redirect target). Runs up to
/// `REDIRECT_CONCURRENCY` requests in parallel. Failures fall back
/// to the original `itad.link` URL and log a warning.
async fn resolve_redirects(client: &reqwest::Client, deals: &mut [DealItem]) {
    // Snapshot the indices and URLs we need to resolve so the
    // borrow checker is happy (we mutate `deals` at the end).
    let tasks: Vec<(usize, String)> = deals
        .iter()
        .enumerate()
        .map(|(i, d)| (i, d.store_url.clone()))
        .collect();

    let resolved: Vec<(usize, String)> = stream::iter(tasks)
        .map(|(i, url)| async move {
            let final_url = resolve_single_redirect(client, &url).await;
            (i, final_url)
        })
        .buffer_unordered(REDIRECT_CONCURRENCY)
        .collect()
        .await;

    for (i, final_url) in resolved {
        if !final_url.is_empty() {
            deals[i].store_url = final_url;
        }
    }
}

/// Follow the redirect for a single URL. Returns the final URL
/// (post-redirect) on success; returns the original URL on any
/// failure (timeout, non-2xx, network error).
///
/// We try HEAD first (cheaper — no body download). Some redirect
/// servers return 405 for HEAD, in which case we fall back to a
/// GET and ignore the body. This is the only practical way to
/// resolve a tracking redirect without downloading the target
/// page's full HTML.
///
/// Unlike the previous version, this does NOT short-circuit on
/// `itad.link/` — it transparently follows redirects for any
/// URL (itad.link, humblebundleinc.sjv.io, awin1.com, etc.). For
/// URLs that don't redirect, reqwest returns the same URL back
/// from `response.url()`, so the call is always safe to make.
async fn resolve_single_redirect(client: &reqwest::Client, url: &str) -> String {
    // Attempt 1: HEAD. Cheap, no body. ITAD's link shortener
    // sometimes rejects HEAD with 405 — in that case reqwest
    // surfaces an error and we move to the GET fallback.
    let head_result = client
        .head(url)
        .timeout(Duration::from_secs(REDIRECT_TIMEOUT_SECS))
        .send()
        .await;
    if let Ok(resp) = head_result {
        if resp.status().is_success() || resp.status().is_redirection() {
            return resp.url().as_str().to_string();
        }
    }
    // Attempt 2: GET fallback. Downloads the body but we discard
    // it — reqwest follows redirects by default, so `resp.url()`
    // already reflects the final destination. The body is closed
    // when `resp` drops at the end of this block.
    let get_result = client
        .get(url)
        .timeout(Duration::from_secs(REDIRECT_TIMEOUT_SECS))
        .send()
        .await;
    match get_result {
        Ok(resp) => resp.url().as_str().to_string(),
        Err(e) => {
            eprintln!("[deals] Failed to resolve {}: {}", url, e);
            url.to_string()
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Map a frontend platform filter to the platform strings we attach
/// to each GamePass card. The Microsoft catalog doesn't expose a
/// per-product platform list on the public surface, so we infer
/// from the user-selected filter to keep the UI accurate.
fn platforms_for(filter: Option<&str>) -> Vec<String> {
    match filter.unwrap_or("all") {
        "xbox" => vec!["Xbox".to_string()],
        "pc" => vec!["PC".to_string()],
        "cloud" => vec!["Cloud".to_string()],
        _ => vec!["Xbox".to_string(), "PC".to_string(), "Cloud".to_string()],
    }
}

/// Map a market code (e.g. "US", "UK") to a best-guess locale
/// string (e.g. "en-US", "en-GB"). Falls back to `en-US`.
fn locale_for_market(market: &str) -> String {
    match market.to_ascii_uppercase().as_str() {
        "US" => "en-US",
        "UK" | "GB" => "en-GB",
        "CA" => "en-CA",
        "AU" | "NZ" => "en-AU",
        "DE" | "AT" | "CH" => "de-DE",
        "FR" | "BE" | "LU" => "fr-FR",
        "JP" => "ja-JP",
        "BR" => "pt-BR",
        "MX" => "es-MX",
        "ES" => "es-ES",
        "IT" => "it-IT",
        _ => "en-US",
    }
    .to_string()
}

/// Split a combined developer / publisher string ("Studio A and Studio
/// B") and return the first entry. The Microsoft catalog often
/// concatenates multiple companies with ` and `, `,`, `/`, `+`, or
/// `&` — we only want the first one for the card display.
fn split_first(raw: &Option<String>) -> Option<String> {
    let s = raw.as_deref()?.trim();
    if s.is_empty() {
        return None;
    }
    // Try common delimiters in order; pick the first chunk.
    for delim in [" and ", " / ", " + ", " & ", ","] {
        if let Some(idx) = s.find(delim) {
            let head = s[..idx].trim();
            if !head.is_empty() {
                return Some(head.to_string());
            }
        }
    }
    Some(s.to_string())
}

/// Slugify a product title for use in the Xbox store web URL. The
/// store's URL format is `https://www.xbox.com/en-US/games/store/{slug}/{productId}`
/// and the slug must be ASCII-only (the server 404s on paths that
/// contain spaces or non-ASCII letters).
///
/// Examples:
///   "1000xRESIST"                       -> "1000xresist"
///   "33 Immortals"                      -> "33-immortals"
///   "A Game About Digging A Hole"       -> "a-game-about-digging-a-hole"
fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Map a user-facing category chip to the actual category strings
/// the Microsoft catalog ships. The catalog uses verbose names like
/// "Role playing" (not "RPG") and splits "Sports & racing" into
/// separate "Sports" and "Racing & flying" buckets — neither of
/// which match the familiar short names users expect in the UI.
/// This map keeps the chip labels user-friendly while still
/// matching the real catalog strings.
///
/// Chips not listed here pass through unchanged and are matched
/// via prefix against the catalog (so e.g. "Music" still hits
/// "Music" exactly, and any future verbose variant like "Music &
/// audio" would also match via prefix).
///
/// Source: a live sample of 200 catalog entries (US, en-US). If
/// Microsoft renames a category, update this map.
fn category_aliases(chip: &str) -> Vec<String> {
    match chip {
        "RPG" => vec!["Role playing".to_string()],
        "Sports & racing" => vec![
            "Sports".to_string(),
            "Racing & flying".to_string(),
        ],
        _ => vec![chip.to_string()],
    }
}

/// Normalize `Properties.Categories` to a flat list of category
/// names. The v7.0 catalog has shipped three shapes — an array of
/// plain strings (current, e.g. `["Action & adventure"]`), an
/// array of `{ "name": "..." }` objects (older), and a
/// comma-separated string (rare). We accept all three; anything
/// else yields an empty list rather than panicking.
fn extract_categories(props: Option<&DisplayProperties>) -> Vec<String> {
    let Some(props) = props else {
        return Vec::new();
    };
    let Some(value) = props.categories.as_ref() else {
        return Vec::new();
    };
    match value {
        // Array of plain strings (current v7.0 shape).
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| match v {
                // Plain string in the array.
                serde_json::Value::String(s) => Some(s.clone()),
                // Object with a name field (older shape, e.g. {"name": "Action"}).
                serde_json::Value::Object(obj) => {
                    obj.get("name").and_then(|n| n.as_str()).map(String::from)
                }
                _ => None,
            })
            .collect(),
        // Comma-separated string (rare fallback).
        serde_json::Value::String(s) => s
            .split(',')
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

// ─── Giveaways (free games) ───────────────────────────────────────────

/// ITAD's giveaways are served by a JSON endpoint behind the
/// `/giveaways/` page. We first GET the page to obtain a session
/// cookie (`sess2`) and the anonymous `g.user.token`, then POST to
/// the list API. The API session cookie is captured automatically
/// by the shared client's cookie store.
const GIVEAWAYS_PAGE_URL: &str = "https://isthereanydeal.com/giveaways/";

/// The list endpoint used by ITAD's own giveaways page. Mirrors the
/// request the Lacro59 playnite-isthereanydeal-plugin makes.
const GIVEAWAYS_API_URL: &str =
    "https://isthereanydeal.com/giveaways/api/list/?tab=live";

/// Body sent to the list endpoint. `offset` pages results; `sort`
/// and `filter` are `null` for the default (newest) live view.
const GIVEAWAYS_API_BODY: &str = r#"{"offset":0,"sort":null,"filter":null}"#;

/// How many pages of results to pull. Each page returns up to ~20
/// giveaways; 3 pages comfortably covers everything currently live.
const GIVEAWAYS_MAX_PAGES: u32 = 3;

/// Fetch the current free games from ITAD.
///
/// Algorithm:
///   1. GET `/giveaways/` to seed the `sess2` cookie + grab the
///      anonymous `g.user.token`.
///   2. POST `/giveaways/api/list/?tab=live` (with the token header
///      and the captured cookie) — paginating until `done`.
///   3. Flatten every giveaway's `games` array into one `Giveaway`
///      per individual game (the user wants the actual games, not
///      the parent bundle).
///   4. Drop entries that have already expired.
///   5. Sort by expiry ascending (soonest-to-expire first).
///
/// On any network or parse failure we return a string error so the
/// frontend can show a message. One malformed giveaway is logged
/// and skipped — it doesn't fail the whole request.
#[tauri::command]
pub async fn fetch_giveaways() -> Result<Vec<Giveaway>, String> {
    let client = http_client()?;

    // Step 1 — seed the session cookie and read the anonymous token.
    let page_resp = client
        .get(GIVEAWAYS_PAGE_URL)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Giveaways page request failed: {}", e))?;
    let page_html = page_resp
        .text()
        .await
        .map_err(|e| format!("Giveaways page body read failed: {}", e))?;
    let token = extract_session_token(&page_html);

    // Step 2 — paginate the list API.
    let mut all_giveaways: Vec<Giveaway> = Vec::new();
    let mut offset: u32 = 0;
    for _ in 0..GIVEAWAYS_MAX_PAGES {
        let mut api_req = client
            .post(GIVEAWAYS_API_URL)
            .timeout(Duration::from_secs(15))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(GIVEAWAYS_API_BODY.replace("\"offset\":0", &format!("\"offset\":{}", offset)));
        if let Some(t) = &token {
            api_req = api_req.header("ITAD-SessionToken", t.clone());
        }
        let resp = api_req
            .send()
            .await
            .map_err(|e| format!("Giveaways API request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Giveaways API returned status {}", resp.status()));
        }
        let payload: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Giveaways API JSON parse failed: {}", e))?;

        let data = payload
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "No 'data' array in giveaways API response".to_string())?;

        for datum in data {
            match parse_giveaway_datum(datum) {
                Ok(mut games) => all_giveaways.append(&mut games),
                Err(e) => eprintln!("[deals] Skipping giveaway: {}", e),
            }
        }

        let done = payload.get("done").and_then(|v| v.as_bool()).unwrap_or(true);
        if done {
            break;
        }
        offset += data.len() as u32;
    }

    // Step 3 — drop expired entries. `expiry == None` is treated as
    // "no expiry set, keep it". A parse failure fails closed (drop).
    let now = chrono::Utc::now().timestamp();
    all_giveaways.retain(|g| {
        g.expiry
            .as_deref()
            .map(|iso| {
                chrono::DateTime::parse_from_rfc3339(iso)
                    .map(|dt| dt.timestamp() > now)
                    .unwrap_or(false)
            })
            .unwrap_or(true)
    });

    // Step 4 — soonest-expiring first.
    all_giveaways.sort_by(|a, b| a.expiry.cmp(&b.expiry));

    Ok(all_giveaways)
}

/// Extract the anonymous session token from the `/giveaways/` page's
/// inline `var g = {...}` config. The token lives at `g.user.token`
/// and is sent as the `ITAD-SessionToken` header on the API call.
fn extract_session_token(html: &str) -> Option<String> {
    let start = html.find("var g = ")?;
    let after = start + "var g = ".len();
    // The object ends at the first `;` that closes the statement.
    let end = html[after..].find(';')? + after;
    let obj: serde_json::Value = serde_json::from_str(&html[after..end]).ok()?;
    obj.get("user")
        .and_then(|u| u.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Parse one giveaway datum from the list API into one `Giveaway`
/// per individual game inside its `games` array. The parent
/// giveaway's `title` is kept as `bundle_title` for context, and
/// its `url` is the claim link for every game it contains.
fn parse_giveaway_datum(datum: &serde_json::Value) -> Result<Vec<Giveaway>, String> {
    let giveaway_id = datum
        .get("id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "giveaway missing id".to_string())?;
    let bundle_title = datum
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let deal_url = datum
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_mature = datum
        .get("isMature")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let expiry = ts_to_iso(datum.get("expiry").and_then(|v| v.as_i64()));
    let store_name = store_name_from_url(&deal_url);

    let games = datum
        .get("games")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "giveaway missing games array".to_string())?;

    let mut result = Vec::new();
    for g in games {
        let game_id = g
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = g
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if title.is_empty() {
            continue;
        }
        let image_url = g
            .get("assets")
            .and_then(|a| a.get("boxart"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        result.push(Giveaway {
            id: format!("{}-{}", giveaway_id, game_id),
            title,
            bundle_title: bundle_title.clone(),
            store_name: store_name.clone(),
            image_url,
            deal_url: deal_url.clone(),
            is_mature,
            expiry: expiry.clone(),
        });
    }

    if result.is_empty() {
        return Err("giveaway had no usable games".to_string());
    }
    Ok(result)
}

/// Derive a friendly storefront name from a claim URL's host.
fn store_name_from_url(url: &str) -> String {
    let host = url
        .split("://")
        .nth(1)
        .map(|s| s.split('/').next().unwrap_or(""))
        .unwrap_or("")
        .to_lowercase();
    if host.contains("steampowered") || host.contains("steamcommunity") {
        "Steam".to_string()
    } else if host.contains("gog.com") {
        "GOG".to_string()
    } else if host.contains("epicgames") {
        "Epic Games".to_string()
    } else if host.contains("humble") {
        "Humble Bundle".to_string()
    } else if host.contains("fanatical") {
        "Fanatical".to_string()
    } else if host.contains("itch.io") {
        "itch.io".to_string()
    } else if host.contains("ubisoft") {
        "Ubisoft".to_string()
    } else if host.contains("ea.com") {
        "EA App".to_string()
    } else if host.contains("microsoft") || host.contains("xbox") {
        "Microsoft Store".to_string()
    } else if host.is_empty() {
        "Unknown Store".to_string()
    } else {
        // Title-case the bare host (drop the TLD) as a fallback.
        let bare = host
            .split('.')
            .nth_back(1)
            .unwrap_or(&host)
            .to_string();
        let mut c = bare.chars();
        match c.next() {
            Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            None => bare,
        }
    }
}

/// Convert a Unix timestamp (seconds) to an ISO 8601 string.
/// Returns `None` for 0 or invalid timestamps.
fn ts_to_iso(ts: Option<i64>) -> Option<String> {
    let ts = ts?;
    if ts <= 0 {
        return None;
    }
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
}

// ─── Playtester (playtests / demos / betas) ─────────────────────────────────

/// Playtester.io is a Next.js server-rendered catalog of upcoming
/// game alphas, betas, playtests, and demos. There is no public JSON
/// API (`/api/` is disallowed and reserved for authenticated routes),
/// so we scrape the rendered HTML with the `scraper` crate — the same
/// approach used for IsThereAnyDeal.
///
/// The homepage lists the ~12 latest entries; each category page
/// (`/categories/{slug}`) lists the ~12 latest entries in that
/// category. We scrape the homepage plus a handful of popular category
/// pages, dedupe by slug, and sort by most-recently-added so the
/// subtab has a meaningful catalog to filter/sort against.

/// Homepage ("latest") — always the first page of the feed.
const PLAYTESTER_HOMEPAGE: &str = "https://playtester.io/";

/// The categories sitemap lists every category slug — our source for the
/// full paginated catalog (fetched once per request; it's small).
const PLAYTESTER_CATEGORIES_SITEMAP: &str =
    "https://playtester.io/categories-sitemap.xml";

/// Fallback category set when the sitemap can't be reached.
const PLAYTESTER_CATEGORIES: &[&str] = &[
    "cozy",
    "horror",
    "multiplayer",
    "roguelike",
    "rpg",
    "survival",
];

/// A single playtest / demo / beta entry shown on a card.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterGame {
    /// Stable slug from the card URL (unique per game).
    pub id: String,
    /// URL slug — used to build the detail URL and thumbnail.
    pub slug: String,
    /// Human-readable title.
    pub title: String,
    /// Short marketing blurb shown on the card (may be missing).
    pub description: Option<String>,
    /// Cover thumbnail. Playtester serves these at a predictable
    /// `cdn.playtester.io/thumbnails/{slug}.webp` path (verified against
    /// the sitemaps), so we derive it from the slug.
    pub thumbnail: Option<String>,
    /// Primary platform badge on the card ("Steam", "itch.io", …).
    pub platform: String,
    /// Every platform the game is available on ("Steam", "itch.io", …).
    pub platforms: Vec<String>,
    /// Displayed genres (the card shows the two featured categories).
    pub genres: Vec<String>,
    /// Offer type ("Demo", "Open Beta", "Closed Beta", …).
    pub kind: String,
    /// Availability status ("Active" / "Inactive").
    pub status: String,
    /// ISO 8601 timestamp when the entry was added.
    pub date_added: Option<String>,
    /// Absolute URL of the game page on Playtester.
    pub url: String,
}

/// A page of the Playtester feed, plus cursor info for "load more".
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterFeed {
    pub games: Vec<PlaytesterGame>,
    pub has_more: bool,
    pub next_offset: u32,
    /// Total number of listing pages (homepage + category pages).
    pub total: u32,
}

/// One platform link (name + store URL) on a game detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterPlatformLink {
    pub name: String,
    pub url: String,
}

/// One system-requirement row (label + value).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterRequirement {
    pub label: String,
    pub value: String,
}

/// A screenshot / gallery image on a game detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterPhoto {
    pub url: String,
    pub caption: Option<String>,
}

/// A trailer / gameplay video on a game detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterVideo {
    pub name: Option<String>,
    pub thumbnail_url: Option<String>,
    /// Playable media URL (HLS manifest or direct file).
    pub content_url: Option<String>,
    /// Embeddable player URL (Cloudflare Stream iframe).
    pub embed_url: Option<String>,
    pub duration: Option<String>,
}

/// Full metadata for a single game, scraped on demand from its detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaytesterGameDetail {
    pub slug: String,
    pub title: String,
    /// Availability status text (e.g. "Active Now").
    pub status: Option<String>,
    pub studio: Option<String>,
    pub studio_url: Option<String>,
    /// ISO timestamp when the entry was added.
    pub added: Option<String>,
    /// Short description.
    pub description: Option<String>,
    /// Offer type ("Demo", "Beta", …).
    pub kind: Option<String>,
    pub release_date: Option<String>,
    pub languages: Option<String>,
    pub controller: Option<String>,
    pub platforms: Vec<PlaytesterPlatformLink>,
    pub system_requirements: Vec<PlaytesterRequirement>,
    /// Screenshots (from the page's VideoGame JSON-LD).
    pub photos: Vec<PlaytesterPhoto>,
    /// Trailers / gameplay videos (from the page's VideoGame JSON-LD).
    pub videos: Vec<PlaytesterVideo>,
    /// Primary CTA target (e.g. the Steam store page).
    pub demo_url: Option<String>,
    /// `steam://install/…` deep link, when available.
    pub install_url: Option<String>,
    pub steamdb_url: Option<String>,
    pub thumbnail: Option<String>,
    /// Absolute URL of the game page on Playtester.
    pub url: String,
}

/// Fetch the raw text body of a Playtester page, returning a string
/// error on non-2xx responses so the frontend can surface it.
async fn fetch_playtester_page(
    client: &reqwest::Client,
    url: &str,
) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Playtester request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Playtester returned status {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Playtester body read failed: {}", e))
}

/// Extract `/categories/{slug}` entries from the categories sitemap.
fn parse_category_slugs(xml: &str) -> Vec<String> {
    let mut slugs: Vec<String> = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("/categories/") {
        let after = &rest[start + "/categories/".len()..];
        let end = after.find('<').unwrap_or(after.len());
        let slug = after[..end].trim();
        if !slug.is_empty() && !slugs.iter().any(|s| s == slug) {
            slugs.push(slug.to_string());
        }
        rest = &after[end..];
    }
    slugs
}

/// Fetch the full category list from the sitemap, falling back to the
/// curated set when the request fails.
async fn fetch_playtester_categories(
    client: &reqwest::Client,
) -> Vec<String> {
    match fetch_playtester_page(client, PLAYTESTER_CATEGORIES_SITEMAP).await {
        Ok(xml) => {
            let slugs = parse_category_slugs(&xml);
            if slugs.is_empty() {
                PLAYTESTER_CATEGORIES.iter().map(|s| s.to_string()).collect()
            } else {
                slugs
            }
        }
        Err(e) => {
            eprintln!("[deals] Playtester categories sitemap failed: {}", e);
            PLAYTESTER_CATEGORIES.iter().map(|s| s.to_string()).collect()
        }
    }
}

/// Derive the thumbnail URL from a slug. Playtester serves card art at
/// `https://cdn.playtester.io/thumbnails/{slug}.webp` (confirmed by the
/// playtests sitemaps and the Next.js image `srcSet`).
fn playtester_thumbnail(slug: &str) -> String {
    format!("https://cdn.playtester.io/thumbnails/{}.webp", slug)
}

/// Order platform names deterministically so the "primary" badge is a
/// known storefront (Steam first, then itch.io, …) rather than whatever
/// order the JSON object's keys happen to deserialize in.
fn order_platforms(mut platforms: Vec<String>) -> Vec<String> {
    const PREFERRED: &[&str] = &[
        "Steam",
        "itch.io",
        "Epic Games",
        "GOG",
        "PlayStation",
        "Xbox",
        "Nintendo Switch",
    ];
    platforms.sort_by(|a, b| {
        let pa = PREFERRED.iter().position(|p| p == a).unwrap_or(usize::MAX);
        let pb = PREFERRED.iter().position(|p| p == b).unwrap_or(usize::MAX);
        pa.cmp(&pb).then_with(|| a.cmp(b))
    });
    platforms
}

/// Map a raw `type` + `open_playtest` pair to the label the site
/// renders on the card. Mirrors Playtester's `formatPlaytestType`:
/// only "Alpha" and "Beta" gain an Open/Closed prefix.
fn format_playtest_type(kind: &str, open_playtest: Option<bool>) -> String {
    if kind == "Alpha" || kind == "Beta" {
        match open_playtest {
            Some(true) => format!("Open {}", kind),
            Some(false) => format!("Closed {}", kind),
            _ => kind.to_string(),
        }
    } else {
        kind.to_string()
    }
}

/// Decode a JS string literal's escape sequences (`\"`, `\\`, `\/`,
/// `\n`, `\t`, `\r`; `\uXXXX` is copied through for serde_json).
fn unescape_js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('/') => out.push('/'),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('u') => {
                    out.push_str("\\u");
                    for _ in 0..4 {
                        if let Some(h) = chars.next() {
                            out.push(h);
                        }
                    }
                }
                Some(other) => out.push(other),
                None => break,
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The shape of one game inside the Next.js flight payload's
/// `initialData.games` array. Field names match the server data (not
/// our camelCase DTO).
#[derive(Debug, Deserialize)]
struct FlightGame {
    #[serde(rename = "type", default)]
    kind: String,
    title: String,
    #[serde(rename = "short_description", default)]
    short_description: Option<String>,
    slug: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(rename = "categories_featured", default)]
    categories_featured: Vec<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    platforms: std::collections::HashMap<String, String>,
    #[serde(rename = "open_playtest", default)]
    open_playtest: Option<bool>,
    #[serde(rename = "date_added", default)]
    date_added: Option<String>,
}

/// Parse the embedded `initialData.games` array out of a Playtester
/// listing page's Next.js flight payload.
///
/// This is the authoritative data source: unlike the rendered card
/// markup it carries the *full* platform map (a game can be on Steam
/// and itch.io at once) and the raw `type` + `open_playtest` fields
/// needed to reproduce the Open/Closed label. Returns `None` when the
/// payload can't be located or parsed, so callers fall back to the
/// HTML card parser.
fn parse_playtester_flight(html: &str) -> Option<Vec<PlaytesterGame>> {
    // The games array is embedded as `\"games\":[{...}]` inside a JS
    // string literal.
    let marker = "games\\\":[";
    let start = html.find(marker)? + marker.len();

    // Scan for the matching `]`, decoding `\"` as a JSON string
    // delimiter and other escapes as string content.
    let bytes = html.as_bytes();
    let mut depth = 1i32;
    let mut i = start;
    let mut in_string = false;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '\\' {
            if i + 1 < bytes.len() {
                let next = bytes[i + 1] as char;
                if next == '"' {
                    in_string = !in_string;
                }
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        if in_string {
            i += 1;
            continue;
        }
        match c {
            '[' => {
                depth += 1;
                i += 1;
            }
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    if depth != 0 {
        return None;
    }

    let decoded = unescape_js_string(&html[start..i]);
    let games: Vec<FlightGame> = serde_json::from_str(&decoded).ok()?;

    Some(
        games
            .into_iter()
            .filter(|g| !g.slug.is_empty() && !g.title.is_empty())
            .map(|g| {
                let platforms = order_platforms(g.platforms.keys().cloned().collect());
                let primary = platforms.first().cloned().unwrap_or_default();
                let kind = format_playtest_type(&g.kind, g.open_playtest);
                let genres = if g.categories_featured.is_empty() {
                    g.categories.iter().take(2).cloned().collect()
                } else {
                    g.categories_featured.clone()
                };
                PlaytesterGame {
                    id: g.slug.clone(),
                    thumbnail: Some(playtester_thumbnail(&g.slug)),
                    slug: g.slug.clone(),
                    title: g.title,
                    description: g.short_description.filter(|s| !s.is_empty()),
                    platform: primary,
                    platforms,
                    genres,
                    kind,
                    status: g.status.unwrap_or_else(|| "Active".to_string()),
                    date_added: g.date_added,
                    url: format!("https://playtester.io/{}", g.slug),
                }
            })
            .collect(),
    )
}

/// Parse the rendered game cards out of a Playtester listing page.
///
/// The card is an `<a class="focus-ring-lg" href="/{slug}">` block that
/// contains the title (`<h3>`), a status dot, a thumbnail `<img>`, a
/// platform badge `<img alt="Steam" src="/icons/steam.svg">`, the
/// description (`.line-clamp-2`), and a footer with genres, type, and
/// a `<time datetime>` stamp. Non-game links that share the
/// `focus-ring-lg` class (e.g. `/categories`, `/studios`, `/about`) are
/// filtered out by prefix.
fn parse_playtester_cards(html: &str) -> Vec<PlaytesterGame> {
    let document = Html::parse_document(html);
    let Ok(card_sel) = Selector::parse("a.focus-ring-lg") else {
        return Vec::new();
    };
    let Ok(h3_sel) = Selector::parse("h3") else {
        return Vec::new();
    };
    let Ok(status_sel) = Selector::parse("[role=\"status\"][aria-label]") else {
        return Vec::new();
    };
    let Ok(icon_sel) = Selector::parse("img[src^=\"/icons/\"]") else {
        return Vec::new();
    };
    let Ok(genre_sel) = Selector::parse("span.min-w-0") else {
        return Vec::new();
    };
    let Ok(kind_sel) = Selector::parse("span.shrink-0") else {
        return Vec::new();
    };
    let Ok(time_sel) = Selector::parse("time[datetime]") else {
        return Vec::new();
    };
    let Ok(desc_sel) = Selector::parse(".line-clamp-2") else {
        return Vec::new();
    };

    const NON_GAME_PREFIXES: &[&str] = &[
        "/studios", "/categories", "/search", "/about", "/blog", "/contact",
        "/faqs", "/privacy", "/terms", "/@", "/select", "/redirect",
    ];

    let mut games = Vec::new();
    for card in document.select(&card_sel) {
        let Some(href) = card.value().attr("href") else {
            continue;
        };
        let href = href.trim();
        if !href.starts_with('/')
            || NON_GAME_PREFIXES
                .iter()
                .any(|p| href.starts_with(p))
        {
            continue;
        }
        let slug = href.trim_start_matches('/').to_string();
        if slug.is_empty() || slug.contains('/') {
            continue;
        }

        let title = card
            .select(&h3_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let Some(title) = title else {
            continue;
        };

        let status = card
            .select(&status_sel)
            .next()
            .and_then(|e| e.value().attr("aria-label"))
            .map(|s| s.trim().to_string())
            .map(|s| s.strip_prefix("Status: ").unwrap_or(&s).to_string())
            .unwrap_or_else(|| "Active".to_string());

        let platform = card
            .select(&icon_sel)
            .next()
            .and_then(|e| e.value().attr("alt"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let genres: Vec<String> = card
            .select(&genre_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| {
                s.split(',')
                    .map(|g| g.trim().to_string())
                    .filter(|g| !g.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        // The type ("Demo", "Open Beta", …) is the first `span.shrink-0`
        // that isn't a bullet (`aria-hidden`) — the bullets between the
        // genre / type / date segments are marked aria-hidden.
        let kind = card
            .select(&kind_sel)
            .find(|e| e.value().attr("aria-hidden").is_none())
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_default();

        let date_added = card
            .select(&time_sel)
            .next()
            .and_then(|e| e.value().attr("datetime"))
            .map(|s| s.trim().to_string());

        let description = card
            .select(&desc_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        games.push(PlaytesterGame {
            id: slug.clone(),
            thumbnail: Some(playtester_thumbnail(&slug)),
            slug: slug.clone(),
            title,
            description,
            platform: platform.clone(),
            platforms: vec![platform],
            genres,
            kind,
            status,
            date_added,
            url: format!("https://playtester.io/{}", slug),
        });
    }

    games
}

/// Fetch a page of the Playtester catalog.
///
/// The feed is the homepage ("latest") plus one page per category slug
/// (from the categories sitemap). `offset`/`limit` select which listing
/// pages to scrape this call, so the frontend can implement a
/// "load more" that progressively walks the full catalog — mirroring
/// the site's infinite scroll without relying on its (build-specific)
/// Next.js server actions.
///
/// Pages in the batch are fetched with bounded concurrency (8 at a
/// time) to stay polite to the origin. Individual page failures are
/// logged and skipped. Results are deduped by slug within the batch
/// and sorted newest-first; the frontend dedupes across batches.
#[tauri::command]
pub async fn fetch_playtester_games(
    offset: u32,
    limit: u32,
) -> Result<PlaytesterFeed, String> {
    let client = http_client()?;
    let categories = fetch_playtester_categories(&client).await;

    let mut urls: Vec<String> = vec![PLAYTESTER_HOMEPAGE.to_string()];
    urls.extend(
        categories
            .iter()
            .map(|c| format!("https://playtester.io/categories/{}", c)),
    );

    let limit = limit.clamp(1, 50) as usize;
    let offset = (offset as usize).min(urls.len());
    let end = (offset + limit).min(urls.len());
    let batch = &urls[offset..end];

    let client_ref = &client;
    let tasks: Vec<String> = batch.iter().cloned().collect();
    let results: Vec<Result<String, String>> = stream::iter(tasks)
        .map(|url| async move { fetch_playtester_page(client_ref, &url).await })
        .buffer_unordered(8)
        .collect()
        .await;

    let mut games: Vec<PlaytesterGame> = Vec::new();
    for (idx, result) in results.into_iter().enumerate() {
        match result {
            Ok(html) => {
                // Prefer the embedded flight data (full platform map +
                // raw type/open_playtest). Fall back to the rendered card
                // markup when the payload is missing or unparseable.
                let parsed = match parse_playtester_flight(&html) {
                    Some(g) if !g.is_empty() => g,
                    _ => {
                        if idx == 0 && offset == 0 {
                            eprintln!(
                                "[deals] Playtester homepage flight parse failed — falling back to HTML cards."
                            );
                        }
                        parse_playtester_cards(&html)
                    }
                };
                games.extend(parsed);
            }
            Err(e) => eprintln!("[deals] Playtester page failed: {}", e),
        }
    }

    // Dedupe by slug (a game appears on the homepage and in several
    // category pages). Keep the first occurrence.
    let mut seen = std::collections::HashSet::new();
    games.retain(|g| seen.insert(g.slug.clone()));

    // Newest first; entries without a date sink to the bottom.
    games.sort_by(|a, b| {
        let ta = a.date_added.as_deref().unwrap_or("");
        let tb = b.date_added.as_deref().unwrap_or("");
        tb.cmp(ta)
    });

    Ok(PlaytesterFeed {
        games,
        has_more: end < urls.len(),
        next_offset: end as u32,
        total: urls.len() as u32,
    })
}

/// Sanitize a user-supplied slug so we only ever request a bare
/// `/{slug}` path on playtester.io.
fn sanitize_playtester_slug(slug: &str) -> String {
    slug.trim()
        .trim_start_matches('/')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect()
}

/// Parse the first `application/ld+json` script on a detail page into a
/// JSON value. The detail page ships a `VideoGame` schema block that
/// carries the screenshots (`image`) and trailers (`subjectOf`) — richer
/// than the rendered gallery markup, which is hydrated client-side.
fn parse_playtester_ld_json(html: &str) -> Option<serde_json::Value> {
    let anchor = "application/ld+json";
    let start = html.find(anchor)?;
    let open = html[start..].find('>')? + start + 1;
    let close = html[open..].find("</script>")? + open;
    serde_json::from_str(&html[open..close]).ok()
}

/// Read an optional string field off a JSON-LD object.
fn ld_string(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Scrape a single game's detail page and return its full metadata.
///
/// The detail page is server-rendered, so a single GET yields
/// everything: the title + status, the studio link, the short
/// description, the details list (Type / Release date / Languages /
/// Controller / Platforms), system requirements, and the external
/// links (store CTA, `steam://install`, SteamDB, studio).
#[tauri::command]
pub async fn fetch_playtester_game_detail(
    slug: String,
) -> Result<PlaytesterGameDetail, String> {
    let slug = sanitize_playtester_slug(&slug);
    if slug.is_empty() {
        return Err("Invalid game slug".to_string());
    }

    let client = http_client()?;
    let url = format!("https://playtester.io/{}", slug);
    let html = fetch_playtester_page(&client, &url).await?;

    let document = Html::parse_document(&html);
    // The title is the first `<span>` inside `<h1>` (the status badge is
    // a sibling span and would otherwise leak into the title text).
    let title_sel = Selector::parse("h1 span")
        .map_err(|e| format!("bad selector h1 span: {:?}", e))?;
    let status_sel = Selector::parse("[role=\"status\"][aria-label^=\"Status:\"]")
        .map_err(|e| format!("bad selector status: {:?}", e))?;
    let studio_sel = Selector::parse("a[href^=\"/studios/\"]")
        .map_err(|e| format!("bad selector studios: {:?}", e))?;
    let studio_name_sel = Selector::parse("[role=\"img\"][aria-label]")
        .map_err(|e| format!("bad selector studio name: {:?}", e))?;
    let time_sel = Selector::parse("time[datetime]")
        .map_err(|e| format!("bad selector time: {:?}", e))?;
    let desc_sel = Selector::parse("#game-short-description")
        .map_err(|e| format!("bad selector desc: {:?}", e))?;
    let detail_li_sel = Selector::parse("aside[aria-label=\"Game details\"] li")
        .map_err(|e| format!("bad selector detail li: {:?}", e))?;
    let label_sel = Selector::parse("span.text-neutral-400")
        .map_err(|e| format!("bad selector label: {:?}", e))?;
    let value_sel = Selector::parse("span.text-right")
        .map_err(|e| format!("bad selector value: {:?}", e))?;
    let platform_link_sel = Selector::parse("a[href]")
        .map_err(|e| format!("bad selector platform link: {:?}", e))?;
    let platform_img_sel = Selector::parse("img[alt]")
        .map_err(|e| format!("bad selector platform img: {:?}", e))?;
    let cta_sel = Selector::parse("a.bg-primary[href]")
        .map_err(|e| format!("bad selector cta: {:?}", e))?;
    let install_sel = Selector::parse("a[href^=\"steam://\"]")
        .map_err(|e| format!("bad selector install: {:?}", e))?;
    let steamdb_sel = Selector::parse("a[href^=\"https://steamdb.info\"]")
        .map_err(|e| format!("bad selector steamdb: {:?}", e))?;
    let dl_sel = Selector::parse("dl")
        .map_err(|e| format!("bad selector dl: {:?}", e))?;
    let dt_sel = Selector::parse("dt").map_err(|e| format!("bad selector dt: {:?}", e))?;
    let dd_sel = Selector::parse("dd").map_err(|e| format!("bad selector dd: {:?}", e))?;

    let title = document
        .select(&title_sel)
        .next()
        .map(|e| e.text().collect::<String>())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slug.clone());

    let status = document
        .select(&status_sel)
        .next()
        .and_then(|e| e.value().attr("aria-label"))
        .map(|s| s.trim().to_string())
        .map(|s| s.strip_prefix("Status: ").unwrap_or(&s).to_string());

    let studio_link = document.select(&studio_sel).next();
    let studio = studio_link
        .as_ref()
        .and_then(|a| a.select(&studio_name_sel).next())
        .and_then(|e| e.value().attr("aria-label"))
        .map(|s| s.trim().to_string());
    let studio_url = studio_link
        .as_ref()
        .and_then(|a| a.value().attr("href"))
        .map(|h| format!("https://playtester.io{}", h.trim_start_matches('/')));
    // Fall back to the studio slug (title-cased) when the avatar `aria-label`
    // is absent (some studio pages use a logo image instead).
    let studio = studio.or_else(|| {
        studio_url.as_ref().map(|u| {
            u.rsplit('/')
                .next()
                .unwrap_or("")
                .split('-')
                .filter(|w| !w.is_empty())
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        Some(first) => {
                            first.to_uppercase().collect::<String>() + c.as_str()
                        }
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
    })
    .filter(|s| !s.is_empty());

    let added = document
        .select(&time_sel)
        .next()
        .and_then(|e| e.value().attr("datetime"))
        .map(|s| s.trim().to_string());

    let description = document
        .select(&desc_sel)
        .next()
        .map(|e| e.text().collect::<String>())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut kind = None;
    let mut release_date = None;
    let mut languages = None;
    let mut controller = None;
    let mut platforms: Vec<PlaytesterPlatformLink> = Vec::new();

    for li in document.select(&detail_li_sel) {
        let label = li
            .select(&label_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_ascii_lowercase())
            .unwrap_or_default();

        if label == "platforms" {
            for a in li.select(&platform_link_sel) {
                let Some(url) = a.value().attr("href") else {
                    continue;
                };
                let name = a
                    .select(&platform_img_sel)
                    .next()
                    .and_then(|img| img.value().attr("alt"))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| "Platform".to_string());
                platforms.push(PlaytesterPlatformLink {
                    name,
                    url: url.trim().to_string(),
                });
            }
            continue;
        }

        let value = li
            .select(&value_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        match label.as_str() {
            "type" => kind = value,
            "release date" => release_date = value,
            "languages" => languages = value,
            "controller" => controller = value,
            _ => {}
        }
    }

    // System requirements live in a `<dl>`; pick the one with the most
    // dt/dd pairs (the requirements block has ~6 rows).
    let mut system_requirements: Vec<PlaytesterRequirement> = Vec::new();
    let mut best_count = 0usize;
    for dl in document.select(&dl_sel) {
        let dts: Vec<String> = dl
            .select(&dt_sel)
            .map(|e| e.text().collect::<String>())
            .collect();
        let dds: Vec<String> = dl
            .select(&dd_sel)
            .map(|e| e.text().collect::<String>())
            .collect();
        let count = dts.len().min(dds.len());
        if count > best_count {
            best_count = count;
            system_requirements = dts
                .into_iter()
                .zip(dds.into_iter())
                .map(|(label, value)| PlaytesterRequirement {
                    label: label.trim().to_string(),
                    value: value.trim().to_string(),
                })
                .collect();
        }
    }

    let demo_url = document
        .select(&cta_sel)
        .next()
        .and_then(|e| e.value().attr("href"))
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("http"));

    let install_url = document
        .select(&install_sel)
        .next()
        .and_then(|e| e.value().attr("href"))
        .map(|s| s.trim().to_string());

    let steamdb_url = document
        .select(&steamdb_sel)
        .next()
        .and_then(|e| e.value().attr("href"))
        .map(|s| s.trim().to_string());

    // JSON-LD carries the screenshots + trailers (the rendered gallery
    // is hydrated client-side and absent from the SSR HTML).
    let ld = parse_playtester_ld_json(&html);
    let mut photos: Vec<PlaytesterPhoto> = Vec::new();
    let mut videos: Vec<PlaytesterVideo> = Vec::new();
    if let Some(ld) = ld.as_ref() {
        if let Some(image) = ld.get("image") {
            let items: Vec<&serde_json::Value> = match image {
                serde_json::Value::Array(a) => a.iter().collect(),
                other => vec![other],
            };
            for img in items {
                if let Some(url) = img.get("url").and_then(|u| u.as_str()) {
                    photos.push(PlaytesterPhoto {
                        url: url.to_string(),
                        caption: img
                            .get("caption")
                            .and_then(|c| c.as_str())
                            .map(String::from),
                    });
                }
            }
        }
        if let Some(subject_of) = ld.get("subjectOf").and_then(|s| s.as_array()) {
            for v in subject_of {
                videos.push(PlaytesterVideo {
                    name: ld_string(v, "name"),
                    thumbnail_url: ld_string(v, "thumbnailUrl"),
                    content_url: ld_string(v, "contentUrl"),
                    embed_url: ld_string(v, "embedUrl"),
                    duration: ld_string(v, "duration"),
                });
            }
        }
    }

    // Fall back to the JSON-LD description when the short-description
    // paragraph is absent from the DOM.
    let description = description.or_else(|| {
        ld.as_ref()
            .and_then(|v| ld_string(v, "description"))
    });

    Ok(PlaytesterGameDetail {
        thumbnail: Some(playtester_thumbnail(&slug)),
        slug: slug.clone(),
        title,
        status,
        studio,
        studio_url,
        added,
        description,
        kind,
        release_date,
        languages,
        controller,
        platforms,
        system_requirements,
        photos,
        videos,
        demo_url,
        install_url,
        steamdb_url,
        url,
    })
}
