//! Mod DB client.
//!
//! Mod DB has no public API, so this scrapes the site with the shared
//! `scraper` crate. A game's mods come from `/games/{slug}/mods`, while a
//! standalone mod (which Mod DB hosts as a *mod*, not a game — e.g.
//! S.T.A.L.K.E.R. Anomaly) is browsed through its file list at
//! `/mods/{slug}/downloads`.
//!
//! The resolved target is encoded in the external id as `g:<slug>` or
//! `m:<slug>` so browse/detail/download know which page to hit. Bare
//! slugs from older mappings are treated as games.
//!
//! Downloads are handled by the site itself (their download pages gate
//! the file), so the download action always returns an `external` plan.

use super::*;
use scraper::{Html, Selector};
use std::collections::HashMap;

fn client_page(url: &str) -> impl std::future::Future<Output = Result<String, String>> {
    let url = url.to_string();
    async move {
        let resp = http_client()
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("moddb fetch: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("moddb fetch: HTTP {}", resp.status()));
        }
        resp.text().await.map_err(|e| format!("moddb body: {e}"))
    }
}

/// Split an external id into `("g" | "m", slug)`.
fn parse_external_id(id: &str) -> (&str, &str) {
    if let Some(rest) = id.strip_prefix("m:") {
        ("m", rest)
    } else if let Some(rest) = id.strip_prefix("g:") {
        ("g", rest)
    } else {
        ("g", id)
    }
}

/// Nav slugs that look like game/mod slugs but aren't.
fn is_reserved(slug: &str) -> bool {
    matches!(
        slug,
        "top" | "latest" | "add" | "popular" | "search" | "new"
    )
}

pub async fn resolve_game(candidates: &[String]) -> Result<Option<GameRef>, String> {
    // 1) Direct slug probe — a game page, else a standalone mod page.
    for candidate in candidates.iter().take(3) {
        let slug = slugify(candidate);
        if slug.is_empty() {
            continue;
        }
        for (kind, segment) in [("g", "games"), ("m", "mods")] {
            let url = format!("https://www.moddb.com/{segment}/{slug}");
            if let Ok(html) = client_page(&url).await {
                let lower = html.to_lowercase();
                if lower.contains("<title>") && !lower.contains("page not found") {
                    return Ok(Some(GameRef {
                        external_id: format!("{kind}:{slug}"),
                        label: candidate.clone(),
                    }));
                }
            }
        }
    }

    // 2) Search fallback — match both game and mod links.
    for candidate in candidates.iter().take(3) {
        let url = format!(
            "https://www.moddb.com/search?q={}",
            urlencoding::encode(candidate)
        );
        let Ok(html) = client_page(&url).await else {
            continue;
        };
        let doc = Html::parse_document(&html);
        let mut best: Option<(i32, GameRef)> = None;
        for (kind, selector) in [("g", "a[href^='/games/']"), ("m", "a[href^='/mods/']")] {
            let sel = Selector::parse(selector).unwrap();
            let mut seen = std::collections::HashSet::new();
            for a in doc.select(&sel) {
                let href = a.value().attr("href").unwrap_or("");
                let path = href.trim_end_matches('/');
                let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
                if parts.len() != 2 {
                    continue;
                }
                let slug = parts[1].to_string();
                if slug.is_empty() || is_reserved(&slug) || !seen.insert(slug.clone()) {
                    continue;
                }
                let text: String = a.text().collect::<Vec<_>>().join(" ");
                let label = if text.trim().is_empty() {
                    slug.replace('-', " ")
                } else {
                    text.trim().to_string()
                };
                let score = best_score(candidates, &[&label, &slug]);
                if score >= MATCH_FLOOR && score > best.as_ref().map(|b| b.0).unwrap_or(0) {
                    best = Some((
                        score,
                        GameRef {
                            external_id: format!("{kind}:{slug}"),
                            label,
                        },
                    ));
                }
            }
        }
        if let Some((_, g)) = best {
            return Ok(Some(g));
        }
    }
    Ok(None)
}

/// Mods listed on a game's page (`/games/{slug}/mods`).
async fn browse_game_mods(slug: &str) -> Result<Vec<RemoteModSummary>, String> {
    let url = format!("https://www.moddb.com/games/{slug}/mods");
    let html = client_page(&url).await?;
    let doc = Html::parse_document(&html);
    let mod_sel = Selector::parse("a[href^='/mods/']").unwrap();
    let img_sel = Selector::parse("img").unwrap();
    let mut results: Vec<RemoteModSummary> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for a in doc.select(&mod_sel) {
        let href = a.value().attr("href").unwrap_or("");
        let path = href.trim_end_matches('/');
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        if parts.len() != 2 || parts[0] != "mods" {
            continue;
        }
        let mod_slug = parts[1].to_string();
        if mod_slug.is_empty() || is_reserved(&mod_slug) || !seen.insert(mod_slug.clone()) {
            continue;
        }
        let text: String = a.text().collect::<Vec<_>>().join(" ");
        let name = if text.trim().is_empty() {
            mod_slug.replace('-', " ")
        } else {
            text.trim().to_string()
        };
        let thumb = a.ancestors().find_map(|node| {
            let el = scraper::ElementRef::wrap(node)?;
            el.select(&img_sel)
                .next()
                .and_then(|img| img.value().attr("src").map(str::to_string))
        });
        results.push(RemoteModSummary {
            source: SOURCE_MODDB.to_string(),
            id: mod_slug.clone(),
            name,
            author: None,
            summary: None,
            version: None,
            downloads: None,
            endorsements: None,
            updated_at: None,
            created_at: None,
            thumbnail_url: thumb,
            url: format!("https://www.moddb.com/mods/{mod_slug}"),
            category: None,
            tags: Vec::new(),
            file_count: None,
        });
    }
    Ok(results)
}

/// Collect a mod's files from `/mods/{slug}/downloads` as `slug → name`
/// (the page links each file twice — an image anchor and a title anchor —
/// so we keep the longest text).
fn collect_mod_files(doc: &Html, slug: &str) -> HashMap<String, String> {
    let prefix = format!("/mods/{slug}/downloads/");
    let sel = Selector::parse("a[href]").unwrap();
    let mut map: HashMap<String, String> = HashMap::new();
    for a in doc.select(&sel) {
        let href = a.value().attr("href").unwrap_or("");
        if !href.starts_with(&prefix) {
            continue;
        }
        let rest = &href[prefix.len()..];
        if rest.is_empty()
            || rest.contains('/')
            || rest.starts_with('?')
            || rest == "add"
            || rest.starts_with("feed")
        {
            continue;
        }
        let text: String = a.text().collect::<Vec<_>>().join(" ");
        let text = text.trim().to_string();
        let entry = map.entry(rest.to_string()).or_default();
        if text.len() > entry.len() {
            *entry = text;
        }
    }
    map
}

/// A standalone mod's files, shown as the browse results.
async fn browse_mod_files(slug: &str) -> Result<Vec<RemoteModSummary>, String> {
    let url = format!("https://www.moddb.com/mods/{slug}/downloads");
    let html = client_page(&url).await?;
    let doc = Html::parse_document(&html);
    let files = collect_mod_files(&doc, slug);
    let img_sel = Selector::parse("img").unwrap();
    // Thumbnails: map file slug → preview image.
    let mut thumbs: HashMap<String, String> = HashMap::new();
    let prefix = format!("/mods/{slug}/downloads/");
    let a_sel = Selector::parse("a[href]").unwrap();
    for a in doc.select(&a_sel) {
        let href = a.value().attr("href").unwrap_or("");
        if !href.starts_with(&prefix) {
            continue;
        }
        let rest = &href[prefix.len()..];
        if rest.is_empty() || rest.contains('/') || thumbs.contains_key(rest) {
            continue;
        }
        if let Some(src) = a
            .select(&img_sel)
            .next()
            .and_then(|img| img.value().attr("src"))
        {
            thumbs.insert(rest.to_string(), src.to_string());
        }
    }
    Ok(files
        .into_iter()
        .map(|(fileslug, name)| {
            let name = if name.is_empty() {
                fileslug.replace('-', " ")
            } else {
                name
            };
            RemoteModSummary {
                source: SOURCE_MODDB.to_string(),
                id: fileslug.clone(),
                name,
                author: None,
                summary: None,
                version: None,
                downloads: None,
                endorsements: None,
                updated_at: None,
                created_at: None,
                thumbnail_url: thumbs.get(&fileslug).cloned(),
                url: format!("https://www.moddb.com/mods/{slug}/downloads/{fileslug}"),
                category: None,
                tags: Vec::new(),
                file_count: None,
            }
        })
        .collect())
}

pub async fn browse(
    external_id: &str,
    query: &str,
    _sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let (kind, slug) = parse_external_id(external_id);
    let mut results = if kind == "m" {
        browse_mod_files(slug).await?
    } else {
        match browse_game_mods(slug).await {
            Ok(r) => r,
            // A bare slug may name a standalone mod rather than a game.
            Err(_) => browse_mod_files(slug).await?,
        }
    };

    let q = normalize_name(query);
    if !q.is_empty() {
        results.retain(|m| normalize_name(&m.name).contains(&q));
    }

    let total = results.len() as i64;
    let start = ((page.saturating_sub(1)) * page_size) as usize;
    let end = (start + page_size as usize).min(results.len());
    let page_results = if start < results.len() {
        results[start..end].to_vec()
    } else {
        Vec::new()
    };
    Ok(RemoteModSearch {
        source: SOURCE_MODDB.to_string(),
        query: query.to_string(),
        results: page_results,
        page,
        total: Some(total),
        has_more: end < results.len(),
    })
}

async fn mod_files(slug: &str) -> Vec<RemoteModFile> {
    let url = format!("https://www.moddb.com/mods/{slug}/downloads");
    let Ok(html) = client_page(&url).await else {
        return Vec::new();
    };
    let doc = Html::parse_document(&html);
    collect_mod_files(&doc, slug)
        .into_iter()
        .enumerate()
        .map(|(i, (fileslug, name))| {
            let name = if name.is_empty() {
                fileslug.replace('-', " ")
            } else {
                name
            };
            RemoteModFile {
                id: fileslug.clone(),
                name,
                version: None,
                size_bytes: None,
                uploaded_at: None,
                category: None,
                is_primary: i == 0,
                download_kind: "external".to_string(),
                download_url: Some(format!(
                    "https://www.moddb.com/mods/{slug}/downloads/{fileslug}"
                )),
                file_name: None,
            }
        })
        .collect()
}

struct ModPage {
    name: String,
    description: Option<String>,
    gallery: Vec<String>,
}

/// Parse a mod summary page synchronously — the scraper types aren't held
/// across the later await, which keeps the command future `Send`.
fn parse_mod_page(html: &str, fallback_slug: &str) -> ModPage {
    let doc = Html::parse_document(html);
    let name = doc
        .select(&Selector::parse("h1").unwrap())
        .next()
        .map(|h| h.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_slug.replace('-', " "));
    let description = doc
        .select(&Selector::parse("#moddescr, .article-content, #about, .summary").unwrap())
        .next()
        .map(|d| d.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty());
    let mut gallery: Vec<String> = doc
        .select(&Selector::parse("#media img, .media img, .img img").unwrap())
        .filter_map(|img| img.value().attr("src").map(str::to_string))
        .collect();
    gallery.dedup();
    ModPage {
        name,
        description,
        gallery,
    }
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let (kind, slug) = parse_external_id(external_id);
    // For a standalone mod the external id names the mod; for a game the
    // mod id does.
    let mut mod_slug = if kind == "m" { slug } else { mod_id };
    let mut url = format!("https://www.moddb.com/mods/{mod_slug}");
    let mut html = client_page(&url).await;
    // A game-mapped slug that isn't a mod id may itself be a standalone
    // mod slug (e.g. a manually-entered bare slug).
    if html.is_err() && kind == "g" && slug != mod_id {
        mod_slug = slug;
        url = format!("https://www.moddb.com/mods/{mod_slug}");
        html = client_page(&url).await;
    }
    let html = html?;
    let ModPage {
        name,
        description,
        gallery,
    } = parse_mod_page(&html, mod_slug);

    let files = mod_files(mod_slug).await;

    let summary = RemoteModSummary {
        source: SOURCE_MODDB.to_string(),
        id: mod_slug.to_string(),
        name,
        author: None,
        summary: description.clone(),
        version: None,
        downloads: None,
        endorsements: None,
        updated_at: None,
        created_at: None,
        thumbnail_url: gallery.first().cloned(),
        url: url.clone(),
        category: None,
        tags: Vec::new(),
        file_count: Some(files.len() as i64),
    };
    let links = vec![RemoteModLink {
        label: "Mod DB".to_string(),
        url: url.clone(),
    }];
    Ok(RemoteModDetail {
        summary,
        description,
        gallery,
        files,
        links,
    })
}

pub async fn download(
    external_id: &str,
    mod_id: &str,
    file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    let (kind, slug) = parse_external_id(external_id);
    let url = if kind == "m" {
        match file_id.filter(|f| !f.is_empty()) {
            Some(file) => format!("https://www.moddb.com/mods/{slug}/downloads/{file}"),
            None => format!("https://www.moddb.com/mods/{slug}/downloads"),
        }
    } else {
        format!("https://www.moddb.com/mods/{mod_id}")
    };
    Ok(RemoteDownload {
        kind: "external".to_string(),
        url,
        filename: None,
        referer: None,
        headers: Vec::new(),
        message: Some("Mod DB downloads go through the site — open the page.".into()),
    })
}
