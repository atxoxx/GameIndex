//! mod.io client — REST API with an API key (passed as `api_key`).

use super::*;

const API: &str = "https://api.mod.io/v1";

fn key() -> Result<String, String> {
    credential_for(SOURCE_MODIO)?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "mod.io API key not set".to_string())
}

fn with_key(url: String, key: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}api_key={key}")
}

fn summary_from_record(record: &Value) -> Option<RemoteModSummary> {
    let id = val_i64(record, &["id", "id_row"])?;
    let name = val_str(record, &["name"]).unwrap_or_else(|| id.to_string());
    let author = record
        .get("submitted_by")
        .and_then(|s| val_str(s, &["name", "username"]))
        .or_else(|| record.get("submitted_by").and_then(|s| val_str(s, &["username"])));
    let url = val_str(record, &["profile_url"]).unwrap_or_else(|| {
        format!("https://mod.io/mods/{id}")
    });
    let thumbnail = record
        .get("logo")
        .and_then(|l| val_str(l, &["thumb_320x180", "original", "thumb_640x360"]));
    Some(RemoteModSummary {
        source: SOURCE_MODIO.to_string(),
        id: id.to_string(),
        name,
        author,
        summary: val_str(record, &["summary"]),
        version: None,
        downloads: val_i64(record, &["stats", "downloads_total"])
            .or_else(|| val_i64(record, &["downloads_total"])),
        endorsements: val_i64(record, &["stats", "ratings_positive"])
            .or_else(|| val_i64(record, &["ratings_positive"])),
        updated_at: timestamp_string(record.get("date_updated")),
        created_at: timestamp_string(record.get("date_added")),
        thumbnail_url: thumbnail,
        url,
        category: None,
        tags: Vec::new(),
        file_count: None,
    })
}

pub async fn resolve_game(title: &str) -> Result<Option<GameRef>, String> {
    let key = key()?;
    let url = with_key(
        format!("{API}/games?_q={}&_limit=20", urlencoding::encode(title)),
        &key,
    );
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("modio game search: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("modio game search: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("modio game search decode: {e}"))?;
    let arr = first_array(&v, &["data"]).cloned().unwrap_or_default();
    let norm = normalize_name(title);
    let mut best: Option<(i32, GameRef)> = None;
    for g in &arr {
        let Some(id) = val_i64(g, &["id"]) else { continue };
        let name = val_str(g, &["name"]).unwrap_or_default();
        let name_id = val_str(g, &["name_id"]).unwrap_or_default();
        for cand in [name.as_str(), name_id.as_str()] {
            let cn = normalize_name(cand);
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
                best = Some((score, GameRef { external_id: id.to_string(), label: name.clone() }));
            }
        }
    }
    Ok(best.filter(|(s, _)| *s >= 60).map(|(_, g)| g))
}

pub async fn browse(
    external_id: &str,
    query: &str,
    sort: &str,
    page: u32,
    page_size: u32,
) -> Result<RemoteModSearch, String> {
    let key = key()?;
    let sort_param = match sort {
        "latest" | "updated" => "-date_updated",
        "downloads" | "trending" => "-downloads_total",
        _ => "-popular",
    };
    let offset = page.saturating_sub(1) * page_size;
    let url = with_key(
        format!(
            "{API}/games/{external_id}/mods?_q={}&_limit={page_size}&_offset={offset}&_sort={sort_param}",
            urlencoding::encode(query)
        ),
        &key,
    );
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("modio browse: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("modio browse: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("modio browse decode: {e}"))?;
    let arr = first_array(&v, &["data"]).cloned().unwrap_or_default();
    let total = v
        .get("result_count")
        .and_then(|x| x.as_i64())
        .or(Some(arr.len() as i64));
    let results: Vec<RemoteModSummary> = arr.iter().filter_map(summary_from_record).collect();
    let has_more = total.map(|t| (offset as i64 + results.len() as i64) < t).unwrap_or(false);
    Ok(RemoteModSearch {
        source: SOURCE_MODIO.to_string(),
        query: query.to_string(),
        results,
        page,
        total,
        has_more,
    })
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let key = key()?;
    let url = with_key(format!("{API}/games/{external_id}/mods/{mod_id}"), &key);
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("modio detail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("modio detail: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("modio detail decode: {e}"))?;
    let summary = summary_from_record(&v).ok_or("modio: empty mod")?;
    let description = val_str(&v, &["description_plaintext", "description"]);
    let mut gallery = Vec::new();
    if let Some(images) = v.get("media").and_then(|m| m.get("images")).and_then(|x| x.as_array()) {
        for img in images {
            if let Some(u) = val_str(img, &["original", "url"]) {
                gallery.push(u);
            }
        }
    }
    let mut files = Vec::new();
    if let Some(modfile) = v.get("modfile") {
        let direct = modfile
            .get("download")
            .and_then(|d| val_str(d, &["binary_url"]));
        files.push(RemoteModFile {
            id: val_i64(modfile, &["id"]).map(|n| n.to_string()).unwrap_or_default(),
            name: val_str(modfile, &["filename", "name"]).unwrap_or_else(|| summary.name.clone()),
            version: val_str(modfile, &["version"]),
            size_bytes: val_i64(modfile, &["filesize"]),
            uploaded_at: timestamp_string(modfile.get("date_added")),
            category: Some("Primary".to_string()),
            is_primary: true,
            download_kind: if direct.is_some() { "direct" } else { "external" }.to_string(),
            download_url: direct.or_else(|| Some(summary.url.clone())),
            file_name: val_str(modfile, &["filename"]),
        });
    }
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
    _file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    let detail = detail(external_id, mod_id).await?;
    for f in &detail.files {
        if f.download_kind == "direct" {
            if let Some(url) = &f.download_url {
                return Ok(RemoteDownload {
                    kind: "direct".to_string(),
                    url: url.clone(),
                    filename: f.file_name.clone(),
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
        message: Some("mod.io requires an account for this download — open the page.".into()),
    })
}
