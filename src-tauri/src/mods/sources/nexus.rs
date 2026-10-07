//! Nexus Mods browse client.
//!
//! The v1 API has no text search: we surface the per-game
//! latest/trending feeds and filter by query client-side. Direct
//! download links require a Premium account; free accounts are pointed
//! at the mod page (where the site manages the `nxm://` handoff).

use super::*;
use serde_json::json;
use std::sync::{Mutex, OnceLock};

const API: &str = "https://api.nexusmods.com/v1";
const GRAPHQL: &str = "https://api.nexusmods.com/v2/graphql";

/// Full-catalogue search. The v2 GraphQL API pages through every mod for
/// a game (unlike the v1 feeds, which return a fixed window), and accepts
/// the same personal API key via the `apikey` header.
const MODS_QUERY: &str = r#"
query Mods($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
  mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
    totalCount
    nodes {
      modId
      name
      summary
      version
      author
      createdAt
      updatedAt
      endorsements
      downloads
      pictureUrl
      thumbnailUrl
      adultContent
      category
      game { domainName }
    }
  }
}
"#;

fn key() -> Result<String, String> {
    credential_for(SOURCE_NEXUS)?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "Nexus Mods API key not set".to_string())
}

/// The full Nexus game catalogue (`/games.json`) is stable for hours, so
/// cache it for the process lifetime — name→domain matching would
/// otherwise refetch ~1000 games on every detection.
static GAMES_CACHE: OnceLock<Mutex<Option<Vec<Value>>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<Vec<Value>>> {
    GAMES_CACHE.get_or_init(|| Mutex::new(None))
}

async fn all_games(key: &str) -> Result<Vec<Value>, String> {
    if let Some(cached) = cache().lock().ok().and_then(|g| g.clone()) {
        return Ok(cached);
    }
    let resp = http_client()
        .get(format!("{API}/games.json"))
        .header("apikey", key)
        .send()
        .await
        .map_err(|e| format!("nexus games: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("nexus games: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus games decode: {e}"))?;
    let arr = first_array(&v, &["games", "data"]).cloned().unwrap_or_default();
    if let Ok(mut guard) = cache().lock() {
        *guard = Some(arr.clone());
    }
    Ok(arr)
}

/// Match a game to its Nexus domain. Uses the stored domain when the
/// scanner already found one; otherwise looks the title up in the game
/// catalogue (needs the API key).
pub async fn resolve_game(
    candidates: &[String],
    existing: Option<&str>,
) -> Result<Option<GameRef>, String> {
    if let Some(d) = existing.filter(|d| !d.trim().is_empty()) {
        return Ok(Some(GameRef {
            external_id: d.to_string(),
            label: d.to_string(),
        }));
    }
    let key = match key() {
        Ok(k) => k,
        Err(_) => return Ok(None),
    };
    let games = match all_games(&key).await {
        Ok(g) => g,
        Err(_) => return Ok(None),
    };
    let mut best: Option<(i32, GameRef)> = None;
    for g in &games {
        let name = val_str(g, &["name"]).unwrap_or_default();
        let domain = val_str(g, &["domain_name", "domain"]).unwrap_or_default();
        if domain.is_empty() {
            continue;
        }
        let score = best_score(candidates, &[&name, &domain]);
        if score >= MATCH_FLOOR && score > best.as_ref().map(|b| b.0).unwrap_or(0) {
            let label = if name.is_empty() { domain.clone() } else { name };
            best = Some((score, GameRef { external_id: domain, label }));
        }
    }
    Ok(best.map(|(_, g)| g))
}

fn summary_from_item(domain: &str, item: &Value) -> Option<RemoteModSummary> {
    let inner = item.get("mod").unwrap_or(item);
    let id = val_i64(inner, &["mod_id", "id"])?;
    let name = val_str(inner, &["name"]).unwrap_or_else(|| id.to_string());
    Some(RemoteModSummary {
        source: SOURCE_NEXUS.to_string(),
        id: id.to_string(),
        name,
        author: val_str(inner, &["author", "uploaded_by"]),
        summary: val_str(inner, &["summary"]),
        version: val_str(inner, &["version"]),
        downloads: val_i64(inner, &["downloads", "mod_downloads"]),
        endorsements: val_i64(inner, &["endorsements", "endorsement_count"]),
        updated_at: timestamp_string(inner.get("updated_timestamp").or_else(|| inner.get("last_file_update"))),
        created_at: timestamp_string(inner.get("created_timestamp")),
        thumbnail_url: val_str(inner, &["picture_url"]),
        url: format!("https://www.nexusmods.com/{domain}/mods/{id}"),
        category: val_str(inner, &["category_name", "category"]),
        tags: Vec::new(),
        file_count: val_i64(inner, &["file_count"]),
    })
}

pub async fn browse(
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let key = key()?;
    // Prefer the v2 GraphQL catalogue (full pagination); fall back to the
    // v1 feeds if the key/endpoint isn't accepted, or if an unfiltered
    // query comes back empty (a mapped game always has mods).
    match browse_graphql(&key, external_id, query, sort, page, page_size).await {
        Ok(res) if !(res.results.is_empty() && query.trim().is_empty()) => Ok(res),
        _ => browse_feeds(&key, external_id, query, sort, page, page_size).await,
    }
}

/// POST a GraphQL query and unwrap `data`, surfacing any `errors`.
async fn graphql_post(key: &str, query: &str, variables: Value) -> Result<Value, String> {
    let body = json!({ "query": query, "variables": variables });
    let resp = http_client()
        .post(GRAPHQL)
        .header("apikey", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("nexus graphql: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("nexus graphql: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus graphql decode: {e}"))?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            let msg = errors
                .iter()
                .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(format!("nexus graphql: {msg}"));
        }
    }
    v.get("data")
        .cloned()
        .ok_or_else(|| "nexus graphql: empty data".to_string())
}

fn summary_from_graphql(domain: &str, n: &Value) -> Option<RemoteModSummary> {
    let id = val_i64(n, &["modId"])?;
    let name = val_str(n, &["name"]).unwrap_or_else(|| id.to_string());
    Some(RemoteModSummary {
        source: SOURCE_NEXUS.to_string(),
        id: id.to_string(),
        name,
        author: val_str(n, &["author"]),
        summary: val_str(n, &["summary"]),
        version: val_str(n, &["version"]),
        downloads: val_i64(n, &["downloads"]),
        endorsements: val_i64(n, &["endorsements"]),
        updated_at: val_str(n, &["updatedAt"]),
        created_at: val_str(n, &["createdAt"]),
        thumbnail_url: val_str(n, &["pictureUrl"]).or_else(|| val_str(n, &["thumbnailUrl"])),
        url: format!("https://www.nexusmods.com/{domain}/mods/{id}"),
        category: val_str(n, &["category"]),
        tags: Vec::new(),
        file_count: None,
    })
}

async fn browse_graphql(
    key: &str,
    domain: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let mut clauses = vec![json!({
        "gameDomainName": [{ "value": domain, "op": "EQUALS" }]
    })];
    let q = query.trim();
    if !q.is_empty() {
        clauses.push(json!({ "name": [{ "value": q, "op": "WILDCARD" }] }));
    }
    let filter = json!({ "op": "AND", "filter": clauses });
    let sort_value = match sort {
        "latest" => json!([{ "createdAt": { "direction": "DESC" } }]),
        "updated" => json!([{ "updatedAt": { "direction": "DESC" } }]),
        "downloads" => json!([{ "downloads": { "direction": "DESC" } }]),
        _ => {
            if q.is_empty() {
                json!([{ "endorsements": { "direction": "DESC" } }])
            } else {
                json!([{ "relevance": { "direction": "DESC" } }])
            }
        }
    };
    let offset = (page.saturating_sub(1) * page_size) as i64;
    let variables = json!({
        "filter": filter,
        "sort": sort_value,
        "offset": offset,
        "count": page_size as i64,
    });
    let data = graphql_post(key, MODS_QUERY, variables).await?;
    let mods = data.get("mods").ok_or("nexus graphql: no mods")?;
    let total = mods.get("totalCount").and_then(|x| x.as_i64());
    let nodes = mods
        .get("nodes")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    let results: Vec<RemoteModSummary> = nodes
        .iter()
        .filter_map(|n| summary_from_graphql(domain, n))
        .collect();
    let has_more = total
        .map(|t| (offset + results.len() as i64) < t)
        .unwrap_or(results.len() as u32 >= page_size);
    Ok(RemoteModSearch {
        source: SOURCE_NEXUS.to_string(),
        query: query.to_string(),
        results,
        page,
        total,
        has_more,
    })
}

/// v1 fallback: merge the three fixed feeds into one de-duped pool.
async fn browse_feeds(
    key: &str,
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    // The v1 API has no paginated "all mods" endpoint — each feed returns
    // a small fixed window. Merge the three feeds and de-dupe so the
    // browser still has a useful pool to page through.
    let endpoints = ["latest_added", "latest_updated", "trending"];
    let futures = endpoints.iter().map(|endpoint| {
        let url = format!("{API}/games/{external_id}/mods/{endpoint}.json");
        async move {
            let resp = http_client()
                .get(&url)
                .header("apikey", key)
                .send()
                .await
                .ok()?;
            if !resp.status().is_success() {
                return None;
            }
            resp.json::<Value>().await.ok()
        }
    });
    let responses = futures::future::join_all(futures).await;

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut results: Vec<RemoteModSummary> = Vec::new();
    let mut had_response = false;
    for v in responses.into_iter().flatten() {
        had_response = true;
        let arr = first_array(&v, &["mods", "results", "data"])
            .cloned()
            .unwrap_or_default();
        for item in &arr {
            if let Some(m) = summary_from_item(external_id, item) {
                if seen.insert(m.id.clone()) {
                    results.push(m);
                }
            }
        }
    }
    if !had_response {
        return Err("nexus browse: request failed".to_string());
    }

    let q = normalize_name(query);
    if !q.is_empty() {
        results.retain(|m| {
            normalize_name(&m.name).contains(&q)
                || m.summary
                    .as_deref()
                    .map(|s| normalize_name(s).contains(&q))
                    .unwrap_or(false)
                || m.author
                    .as_deref()
                    .map(|a| normalize_name(a).contains(&q))
                    .unwrap_or(false)
        });
    }

    match sort {
        "latest" => results.sort_by(|a, b| b.created_at.cmp(&a.created_at)),
        "updated" => results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at)),
        "downloads" => {
            results.sort_by(|a, b| b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)))
        }
        _ => results.sort_by(|a, b| b.endorsements.unwrap_or(0).cmp(&a.endorsements.unwrap_or(0))),
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
        source: SOURCE_NEXUS.to_string(),
        query: query.to_string(),
        results: page_results,
        page,
        total: Some(total),
        has_more: end < results.len(),
    })
}

async fn mod_files(domain: &str, mod_id: &str, key: &str) -> Vec<RemoteModFile> {
    let url = format!("{API}/games/{domain}/mods/{mod_id}/files.json");
    let Ok(resp) = http_client().get(&url).header("apikey", key).send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<Value>().await else {
        return Vec::new();
    };
    let arr = first_array(&v, &["files"]).cloned().unwrap_or_default();
    arr.iter()
        .enumerate()
        .map(|(i, f)| {
            let size_kb = val_i64(f, &["size_kb", "sizeKb"]);
            RemoteModFile {
                id: val_i64(f, &["file_id"]).map(|n| n.to_string()).unwrap_or_default(),
                name: val_str(f, &["name", "file_name"]).unwrap_or_else(|| format!("File {}", i + 1)),
                version: val_str(f, &["version", "mod_version"]),
                size_bytes: size_kb.map(|kb| kb * 1024),
                uploaded_at: timestamp_string(f.get("uploaded_timestamp")),
                category: val_str(f, &["category_name"]),
                is_primary: i == 0,
                // Upgraded to `direct` at download time for Premium.
                download_kind: "external".to_string(),
                download_url: Some(format!("https://www.nexusmods.com/{domain}/mods/{mod_id}")),
                file_name: val_str(f, &["file_name"]),
            }
        })
        .collect()
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let key = key()?;
    let url = format!("{API}/games/{external_id}/mods/{mod_id}.json");
    let resp = http_client()
        .get(&url)
        .header("apikey", &key)
        .send()
        .await
        .map_err(|e| format!("nexus detail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("nexus detail: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus detail decode: {e}"))?;
    let summary = summary_from_item(external_id, &v).ok_or("nexus: empty mod")?;
    let description = val_str(&v, &["description"]);
    let gallery = val_str(&v, &["picture_url"]).into_iter().collect();
    let files = mod_files(external_id, mod_id, &key).await;
    Ok(RemoteModDetail {
        summary,
        description,
        gallery,
        files,
        links: Vec::new(),
    })
}

pub async fn download(
    external_id: &str,
    mod_id: &str,
    file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    let key = key()?;
    // Direct links are Premium-only; check before asking for one.
    let premium = match http_client()
        .get(format!("{API}/users/validate.json"))
        .header("apikey", &key)
        .send()
        .await
    {
        Ok(r) => r
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.get("is_premium").and_then(|p| p.as_bool()))
            .unwrap_or(false),
        Err(_) => false,
    };

    let mod_page = format!("https://www.nexusmods.com/{external_id}/mods/{mod_id}");
    if !premium {
        return Ok(RemoteDownload {
            kind: "external".to_string(),
            url: mod_page,
            filename: None,
            referer: None,
            headers: Vec::new(),
            message: Some("Nexus direct downloads need a Premium account — open the page.".into()),
        });
    }
    let fid = match file_id {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => mod_files(external_id, mod_id, &key)
            .await
            .into_iter()
            .next()
            .map(|f| f.id)
            .ok_or("nexus: no files available")?,
    };
    let url = format!("{API}/games/{external_id}/mods/{mod_id}/files/{fid}/download_link.json");
    let resp = http_client()
        .get(&url)
        .header("apikey", &key)
        .send()
        .await
        .map_err(|e| format!("nexus download link: {e}"))?;
    if !resp.status().is_success() {
        return Ok(RemoteDownload {
            kind: "external".to_string(),
            url: mod_page,
            filename: None,
            referer: None,
            headers: Vec::new(),
            message: Some(format!("Nexus declined the link (HTTP {}) — open the page.", resp.status())),
        });
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus download decode: {e}"))?;
    let arr = first_array(&v, &["links", "data"]).cloned().unwrap_or_default();
    let link = arr
        .first()
        .and_then(|l| val_str(l, &["URI", "uri", "url"]))
        .ok_or("nexus: empty download link")?;
    let filename = arr
        .first()
        .and_then(|l| val_str(l, &["short_name", "name"]));
    Ok(RemoteDownload {
        kind: "direct".to_string(),
        url: link,
        filename,
        referer: Some(mod_page),
        headers: Vec::new(),
        message: None,
    })
}
