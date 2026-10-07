//! Mod DB client.
//!
//! Mod DB has no public API, so this scrapes the site with the shared
//! `scraper` crate. Browsing and detail work; downloads are handled by
//! the site itself (embedded browser / external page), so the download
//! action always returns an `external` plan.

use super::*;
use scraper::{Html, Selector};

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

pub async fn resolve_game(title: &str) -> Result<Option<GameRef>, String> {
    let url = format!(
        "https://www.moddb.com/search?q={}",
        urlencoding::encode(title)
    );
    let html = client_page(&url).await?;
    let doc = Html::parse_document(&html);
    let sel = Selector::parse("a[href^='/games/']").unwrap();
    let norm = normalize_name(title);
    let mut best: Option<(i32, GameRef)> = None;
    let mut seen = std::collections::HashSet::new();
    for a in doc.select(&sel) {
        let href = a.value().attr("href").unwrap_or("");
        let path = href.trim_end_matches('/');
        // Only direct game pages: /games/{slug}
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        if parts.len() != 2 || parts[0] != "games" {
            continue;
        }
        let slug = parts[1].to_string();
        if !seen.insert(slug.clone()) {
            continue;
        }
        let text: String = a.text().collect::<Vec<_>>().join(" ");
        let label = if text.trim().is_empty() {
            slug.replace('-', " ")
        } else {
            text.trim().to_string()
        };
        let cn = normalize_name(&label);
        if cn.is_empty() {
            continue;
        }
        let score = if cn == norm {
            100
        } else if cn.contains(&norm) || norm.contains(&cn) {
            60
        } else {
            0
        };
        if score > best.as_ref().map(|b| b.0).unwrap_or(0) {
            best = Some((score, GameRef { external_id: slug, label }));
        }
    }
    Ok(best.filter(|(s, _)| *s >= 60).map(|(_, g)| g))
}

pub async fn browse(
    external_id: &str,
    query: &str,
    _sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let url = format!("https://www.moddb.com/games/{external_id}/mods");
    let html = client_page(&url).await?;
    let doc = Html::parse_document(&html);
    let mod_sel = Selector::parse("a[href^='/mods/']").unwrap();
    let img_sel = Selector::parse("img").unwrap();
    let q = normalize_name(query);
    let mut results: Vec<RemoteModSummary> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for a in doc.select(&mod_sel) {
        let href = a.value().attr("href").unwrap_or("");
        let path = href.trim_end_matches('/');
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        if parts.len() < 2 || parts[0] != "mods" {
            continue;
        }
        let slug = parts[1].to_string();
        if slug.is_empty() || !seen.insert(slug.clone()) {
            continue;
        }
        let text: String = a.text().collect::<Vec<_>>().join(" ");
        let name = if text.trim().is_empty() {
            slug.replace('-', " ")
        } else {
            text.trim().to_string()
        };
        if !q.is_empty() && !normalize_name(&name).contains(&q) {
            continue;
        }
        // Pull the nearest thumbnail from an ancestor row, if any.
        let thumb = a
            .ancestors()
            .find_map(|node| {
                let el = scraper::ElementRef::wrap(node)?;
                el.select(&img_sel)
                    .next()
                    .and_then(|img| img.value().attr("src").map(str::to_string))
            });
        results.push(RemoteModSummary {
            source: SOURCE_MODDB.to_string(),
            id: slug.clone(),
            name,
            author: None,
            summary: None,
            version: None,
            downloads: None,
            endorsements: None,
            updated_at: None,
            created_at: None,
            thumbnail_url: thumb,
            url: format!("https://www.moddb.com/mods/{slug}"),
            category: None,
            tags: Vec::new(),
            file_count: None,
        });
    }
    // Mod DB lists a game's mods on a single page; there is no reliable
    // pagination to scrape, so we return what the page holds.
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
        has_more: false,
    })
}

pub async fn detail(_external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let url = format!("https://www.moddb.com/mods/{mod_id}");
    let html = client_page(&url).await?;
    let doc = Html::parse_document(&html);
    let title_sel = Selector::parse("h1").unwrap();
    let name = doc
        .select(&title_sel)
        .next()
        .map(|h| h.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| mod_id.replace('-', " "));

    let desc_sel = Selector::parse("#moddescr, .article-content, #about, .summary").unwrap();
    let description = doc
        .select(&desc_sel)
        .next()
        .map(|d| d.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty());

    let img_sel = Selector::parse("#media img, .media img, .img img").unwrap();
    let mut gallery: Vec<String> = doc
        .select(&img_sel)
        .filter_map(|img| img.value().attr("src").map(str::to_string))
        .collect();
    gallery.dedup();

    let file_sel = Selector::parse("a[href*='/downloads/']").unwrap();
    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for a in doc.select(&file_sel) {
        let href = a.value().attr("href").unwrap_or("");
        if href.is_empty() || !seen.insert(href.to_string()) {
            continue;
        }
        let text: String = a.text().collect::<Vec<_>>().join(" ");
        let fname = if text.trim().is_empty() {
            "Download".to_string()
        } else {
            text.trim().to_string()
        };
        let abs = if href.starts_with("http") {
            href.to_string()
        } else {
            format!("https://www.moddb.com{}", if href.starts_with('/') { href.to_string() } else { format!("/{href}") })
        };
        files.push(RemoteModFile {
            id: href.to_string(),
            name: fname,
            version: None,
            size_bytes: None,
            uploaded_at: None,
            category: None,
            is_primary: files.is_empty(),
            download_kind: "external".to_string(),
            download_url: Some(abs),
            file_name: None,
        });
    }

    let summary = RemoteModSummary {
        source: SOURCE_MODDB.to_string(),
        id: mod_id.to_string(),
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
    _external_id: &str,
    mod_id: &str,
    _file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    Ok(RemoteDownload {
        kind: "external".to_string(),
        url: format!("https://www.moddb.com/mods/{mod_id}"),
        filename: None,
        referer: None,
        headers: Vec::new(),
        message: Some("Mod DB downloads go through the site — open the page.".into()),
    })
}
