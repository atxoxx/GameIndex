//! CurseForge client — v1 REST API with an `x-api-key` header.

use super::*;
use std::sync::{Mutex, OnceLock};

const API: &str = "https://api.curseforge.com/v1";

fn key() -> Result<String, String> {
    credential_for(SOURCE_CURSEFORGE)?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "CurseForge API key not set".to_string())
}

async fn get_json(url: &str, key: &str) -> Result<Value, String> {
    let resp = http_client()
        .get(url)
        .header("x-api-key", key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("curseforge request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("curseforge request: HTTP {}", resp.status()));
    }
    resp.json()
        .await
        .map_err(|e| format!("curseforge decode: {e}"))
}

fn thumbnail(record: &Value) -> Option<String> {
    record
        .get("logo")
        .and_then(|l| val_str(l, &["thumbnailUrl", "url", "title"]))
}

fn summary_from_record(record: &Value) -> Option<RemoteModSummary> {
    let id = val_i64(record, &["id"])?;
    let name = val_str(record, &["name"]).unwrap_or_else(|| id.to_string());
    let author = record
        .get("authors")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|a| val_str(a, &["name"]));
    let url = record
        .get("links")
        .and_then(|l| val_str(l, &["websiteUrl"]))
        .unwrap_or_else(|| format!("https://www.curseforge.com/mods/{id}"));
    let (downloads, likes) = record
        .get("latestFiles")
        .map(|_| {
            (
                val_i64(record, &["downloadCount"]),
                val_i64(record, &["thumbsUpCount"]),
            )
        })
        .unwrap_or((
            val_i64(record, &["downloadCount"]),
            val_i64(record, &["thumbsUpCount"]),
        ));
    Some(RemoteModSummary {
        source: SOURCE_CURSEFORGE.to_string(),
        id: id.to_string(),
        name,
        author,
        summary: val_str(record, &["summary"]),
        version: None,
        downloads,
        endorsements: likes,
        updated_at: timestamp_string(record.get("dateModified")),
        created_at: timestamp_string(record.get("dateCreated")),
        thumbnail_url: thumbnail(record),
        url,
        category: record
            .get("categories")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| val_str(c, &["name"])),
        tags: Vec::new(),
        file_count: None,
    })
}

/// The CurseForge game catalogue changes slowly; cache it for the
/// process so repeated detections don't re-page through ~1000 games.
static GAMES_CACHE: OnceLock<Mutex<Option<Vec<Value>>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<Vec<Value>>> {
    GAMES_CACHE.get_or_init(|| Mutex::new(None))
}

async fn all_games(key: &str) -> Result<Vec<Value>, String> {
    if let Some(cached) = cache().lock().ok().and_then(|g| g.clone()) {
        return Ok(cached);
    }
    let mut all = Vec::new();
    for page in 0..16 {
        let url = format!("{API}/games?index={}&pageSize=50", page * 50);
        let v = get_json(&url, key).await?;
        let arr = first_array(&v, &["data"]).cloned().unwrap_or_default();
        if arr.is_empty() {
            break;
        }
        all.extend(arr);
        if all.len() >= 800 {
            break;
        }
    }
    if let Ok(mut guard) = cache().lock() {
        *guard = Some(all.clone());
    }
    Ok(all)
}

pub async fn resolve_game(candidates: &[String]) -> Result<Option<GameRef>, String> {
    let key = key()?;
    let games = match all_games(&key).await {
        Ok(g) => g,
        Err(_) => return Ok(None),
    };
    let mut best: Option<(i32, GameRef)> = None;
    for g in &games {
        let Some(id) = val_i64(g, &["id"]) else { continue };
        let name = val_str(g, &["name"]).unwrap_or_default();
        let slug = val_str(g, &["slug"]).unwrap_or_default();
        let score = best_score(candidates, &[&name, &slug]);
        if score >= MATCH_FLOOR && score > best.as_ref().map(|b| b.0).unwrap_or(0) {
            best = Some((score, GameRef { external_id: id.to_string(), label: name }));
        }
    }
    Ok(best.map(|(_, g)| g))
}

pub async fn browse(
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let key = key()?;
    // CurseForge Classic sortField: 2 popularity, 3 lastUpdated, 6 totalDownloads, 11 releasedDate.
    let sort_field = match sort {
        "latest" => 11,
        "updated" => 3,
        "downloads" => 6,
        _ => 2,
    };
    let index = page.saturating_sub(1) * page_size;
    let url = format!(
        "{API}/mods/search?gameId={external_id}&searchFilter={}&sortField={sort_field}&sortOrder=desc&pageSize={page_size}&index={index}",
        urlencoding::encode(query)
    );
    let v = get_json(&url, &key).await?;
    let arr = first_array(&v, &["data"]).cloned().unwrap_or_default();
    let total = v
        .get("pagination")
        .and_then(|p| val_i64(p, &["totalCount"]))
        .or(Some(arr.len() as i64));
    let results: Vec<RemoteModSummary> = arr.iter().filter_map(summary_from_record).collect();
    let has_more = total
        .map(|t| (index as i64 + results.len() as i64) < t)
        .unwrap_or(false);
    Ok(RemoteModSearch {
        source: SOURCE_CURSEFORGE.to_string(),
        query: query.to_string(),
        results,
        page,
        total,
        has_more,
    })
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let key = key()?;
    let v = get_json(&format!("{API}/mods/{mod_id}"), &key).await?;
    let data = v.get("data").unwrap_or(&v);
    let summary = summary_from_record(data).ok_or("curseforge: empty mod")?;
    let description = val_str(data, &["description"]).or_else(|| {
        data.get("screenshots")
            .and_then(|_| val_str(data, &["summary"]))
    });
    let mut gallery = Vec::new();
    if let Some(shots) = data.get("screenshots").and_then(|x| x.as_array()) {
        for s in shots {
            if let Some(u) = val_str(s, &["url", "thumbnailUrl"]) {
                gallery.push(u);
            }
        }
    }
    let mut files = Vec::new();
    if let Some(files_arr) = data.get("latestFiles").and_then(|x| x.as_array()) {
        for (i, f) in files_arr.iter().enumerate() {
            let direct = val_str(f, &["downloadUrl"]);
            files.push(RemoteModFile {
                id: val_i64(f, &["id"]).map(|n| n.to_string()).unwrap_or_default(),
                name: val_str(f, &["displayName", "fileName"]).unwrap_or_else(|| format!("File {}", i + 1)),
                version: None,
                size_bytes: val_i64(f, &["fileLength"]),
                uploaded_at: timestamp_string(f.get("fileDate")),
                category: None,
                is_primary: i == 0,
                download_kind: if direct.is_some() { "direct" } else { "external" }.to_string(),
                download_url: direct.or_else(|| Some(summary.url.clone())),
                file_name: val_str(f, &["fileName"]),
            });
        }
    }
    let _ = external_id;
    Ok(RemoteModDetail {
        summary,
        description,
        gallery,
        files,
        links: Vec::new(),
    })
}

pub async fn download(
    _external_id: &str,
    mod_id: &str,
    file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    let key = key()?;
    let detail = detail("", mod_id).await?;
    let chosen_id = file_id.map(str::to_string).or_else(|| {
        detail
            .files
            .first()
            .map(|f| f.id.clone())
            .filter(|s| !s.is_empty())
    });
    if let Some(fid) = chosen_id {
        let url = format!("{API}/mods/{mod_id}/files/{fid}/download-url");
        if let Ok(v) = get_json(&url, &key).await {
            if let Some(u) = v.get("data").and_then(|x| x.as_str()) {
                let fname = detail
                    .files
                    .iter()
                    .find(|f| f.id == fid)
                    .and_then(|f| f.file_name.clone());
                return Ok(RemoteDownload {
                    kind: "direct".to_string(),
                    url: u.to_string(),
                    filename: fname,
                    referer: Some(detail.summary.url.clone()),
                    headers: Vec::new(),
                    message: None,
                });
            }
        }
    }
    Ok(RemoteDownload {
        kind: "external".to_string(),
        url: detail.summary.url.clone(),
        filename: None,
        referer: None,
        headers: Vec::new(),
        message: Some("The author disabled third-party downloads — open the page.".into()),
    })
}
