//! Thunderstore client — public JSON API, no key required.
//!
//! Communities come from the cursor-paginated experimental community
//! list; a community's packages from the community-scoped v1 endpoint
//! (`/c/{community}/api/v1/package/`); downloads are plain ZIPs served
//! from `/package/download/{ns}/{name}/{ver}/`.

use super::*;
use std::sync::{Mutex, OnceLock};

const API: &str = "https://thunderstore.io/api/experimental";
const COMMUNITY_LIST: &str = "https://thunderstore.io/api/experimental/community/";

/// The community catalogue is stable for hours; cache the fully-paged
/// list for the process so detection is a single pass after the first.
static COMMUNITY_CACHE: OnceLock<Mutex<Option<Vec<Value>>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<Vec<Value>>> {
    COMMUNITY_CACHE.get_or_init(|| Mutex::new(None))
}

async fn communities() -> Result<Vec<Value>, String> {
    if let Some(cached) = cache().lock().ok().and_then(|g| g.clone()) {
        return Ok(cached);
    }
    let mut all: Vec<Value> = Vec::new();
    let mut url = COMMUNITY_LIST.to_string();
    for _ in 0..25 {
        let resp = http_client()
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("thunderstore communities: {e}"))?;
        if !resp.status().is_success() {
            if all.is_empty() {
                return Err(format!("thunderstore communities: HTTP {}", resp.status()));
            }
            break;
        }
        let v: Value = resp
            .json()
            .await
            .map_err(|e| format!("thunderstore communities decode: {e}"))?;
        if let Some(arr) = first_array(&v, &["results"]) {
            all.extend(arr.iter().cloned());
        }
        let next = v
            .get("pagination")
            .and_then(|p| p.get("next_link"))
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        match next {
            Some(n) => url = n,
            None => break,
        }
    }
    if let Ok(mut guard) = cache().lock() {
        *guard = Some(all.clone());
    }
    Ok(all)
}

pub async fn resolve_game(candidates: &[String]) -> Result<Option<GameRef>, String> {
    let arr = communities().await?;
    let mut best: Option<(i32, GameRef)> = None;
    for c in &arr {
        let identifier = val_str(c, &["identifier", "name_id", "name"]).unwrap_or_default();
        let display = val_str(c, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| identifier.clone());
        if identifier.is_empty() {
            continue;
        }
        let score = best_score(candidates, &[&identifier, &display]);
        if score >= MATCH_FLOOR && score > best.as_ref().map(|b| b.0).unwrap_or(0) {
            best = Some((
                score,
                GameRef {
                    external_id: identifier,
                    label: display,
                },
            ));
        }
    }
    Ok(best.map(|(_, g)| g))
}

/// Newest version of a v1 package object.
fn latest_version(pkg: &Value) -> Option<&Value> {
    pkg.get("versions")
        .and_then(|v| v.as_array())
        .and_then(|versions| {
            versions.iter().max_by(|a, b| {
                let da = a.get("date_created").and_then(|x| x.as_str()).unwrap_or("");
                let db = b.get("date_created").and_then(|x| x.as_str()).unwrap_or("");
                da.cmp(db)
            })
        })
}

fn summary_from_package(pkg: &Value) -> Option<RemoteModSummary> {
    let owner = val_str(pkg, &["owner", "namespace"]).unwrap_or_default();
    let name = val_str(pkg, &["name"]).unwrap_or_default();
    if name.is_empty() {
        return None;
    }
    let full_name = val_str(pkg, &["full_name"]).unwrap_or_else(|| format!("{owner}-{name}"));
    let ver = latest_version(pkg);
    let downloads = pkg
        .get("versions")
        .and_then(|v| v.as_array())
        .map(|versions| versions.iter().filter_map(|x| val_i64(x, &["downloads"])).sum::<i64>());
    let categories = pkg
        .get("categories")
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect::<Vec<String>>())
        .unwrap_or_default();
    Some(RemoteModSummary {
        source: SOURCE_THUNDERSTORE.to_string(),
        id: if owner.is_empty() {
            full_name.clone()
        } else {
            format!("{owner}/{name}")
        },
        name,
        author: Some(owner),
        summary: ver.and_then(|v| val_str(v, &["description"])),
        version: ver.and_then(|v| val_str(v, &["version_number", "version"])),
        downloads,
        endorsements: pkg.get("rating_score").and_then(|x| x.as_i64()),
        updated_at: timestamp_string(pkg.get("date_updated")),
        created_at: timestamp_string(pkg.get("date_created")),
        thumbnail_url: ver.and_then(|v| val_str(v, &["icon"])),
        url: val_str(pkg, &["package_url"])
            .unwrap_or_else(|| format!("https://thunderstore.io/c/{full_name}")),
        category: categories.first().cloned(),
        tags: categories,
        file_count: pkg
            .get("versions")
            .and_then(|v| v.as_array())
            .map(|v| v.len() as i64),
    })
}

pub async fn browse(
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let url = format!("https://thunderstore.io/c/{external_id}/api/v1/package/");
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("thunderstore browse: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("thunderstore browse: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("thunderstore browse decode: {e}"))?;
    let arr = first_array(&v, &["results"]).cloned().unwrap_or_default();

    let q = normalize_name(query);
    let mut results: Vec<RemoteModSummary> = arr
        .iter()
        .filter(|p| !p.get("is_deprecated").and_then(|x| x.as_bool()).unwrap_or(false))
        .filter_map(summary_from_package)
        .filter(|m| {
            q.is_empty()
                || normalize_name(&m.name).contains(&q)
                || m.author
                    .as_deref()
                    .map(|a| normalize_name(a).contains(&q))
                    .unwrap_or(false)
                || m.summary
                    .as_deref()
                    .map(|s| normalize_name(s).contains(&q))
                    .unwrap_or(false)
        })
        .collect();

    match sort {
        "latest" | "updated" => {
            results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        }
        _ => {
            results.sort_by(|a, b| b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)));
        }
    }

    let total = results.len() as i64;
    let start = ((page.saturating_sub(1)) * page_size) as usize;
    let end = (start + page_size as usize).min(results.len());
    let page_results: Vec<RemoteModSummary> = if start < results.len() {
        results[start..end].to_vec()
    } else {
        Vec::new()
    };
    Ok(RemoteModSearch {
        source: SOURCE_THUNDERSTORE.to_string(),
        query: query.to_string(),
        results: page_results,
        page,
        total: Some(total),
        has_more: end < results.len(),
    })
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let (owner, name) = mod_id
        .split_once('/')
        .ok_or("thunderstore: mod id must be namespace/name")?;
    let url = format!("{API}/package/{owner}/{name}/");
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("thunderstore detail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("thunderstore detail: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("thunderstore detail decode: {e}"))?;
    let mut summary = summary_from_package(&v).ok_or("thunderstore: empty package")?;
    summary.file_count = Some(1);

    // The experimental detail exposes only `latest`; show it as the file.
    let latest = v.get("latest").filter(|l| l.is_object());
    let mut files = Vec::new();
    if let Some(ver) = latest {
        let version_number = val_str(ver, &["version_number", "version"]).unwrap_or_default();
        let dl = val_str(ver, &["download_url"]).unwrap_or_else(|| {
            format!("https://thunderstore.io/package/download/{owner}/{name}/{version_number}/")
        });
        files.push(RemoteModFile {
            id: version_number.clone(),
            name: format!("{name} v{version_number}"),
            version: Some(version_number.clone()),
            size_bytes: val_i64(ver, &["file_size"]),
            uploaded_at: timestamp_string(ver.get("date_created")),
            category: None,
            is_primary: true,
            download_kind: "direct".to_string(),
            download_url: Some(dl),
            file_name: Some(format!("{name}-{version_number}.zip")),
        });
    }
    let description = latest
        .and_then(|ver| val_str(ver, &["description"]))
        .or_else(|| summary.summary.clone());
    let _ = external_id;
    Ok(RemoteModDetail {
        summary,
        description,
        gallery: Vec::new(),
        files,
        links: Vec::new(),
    })
}

pub async fn download(
    _external_id: &str,
    mod_id: &str,
    file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    let (owner, name) = mod_id
        .split_once('/')
        .ok_or("thunderstore: mod id must be namespace/name")?;
    let version = file_id.unwrap_or("latest").to_string();
    let url = if version == "latest" {
        format!("https://thunderstore.io/package/download/{owner}/{name}/")
    } else {
        format!("https://thunderstore.io/package/download/{owner}/{name}/{version}/")
    };
    Ok(RemoteDownload {
        kind: "direct".to_string(),
        url,
        filename: Some(format!("{name}-{version}.zip")),
        referer: Some("https://thunderstore.io/".to_string()),
        headers: Vec::new(),
        message: None,
    })
}
