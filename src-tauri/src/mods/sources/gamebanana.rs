//! GameBanana client — public apiv11 JSON, no key required.
//!
//! Games are looked up through the global search endpoint; a game's mods
//! come from its `Subfeed`; mod files carry direct `_sDownloadUrl`s.

use super::*;

const API: &str = "https://gamebanana.com/apiv11";

fn thumbnail(record: &Value) -> Option<String> {
    let media = record.get("_aPreviewMedia")?;
    let images = media.get("_aImages")?.as_array()?;
    let first = images.first()?;
    if let Some(file) = first.get("_sFile220").and_then(|x| x.as_str()) {
        if let Some(base) = first.get("_sBaseUrl").and_then(|x| x.as_str()) {
            return Some(format!("{base}/{file}"));
        }
    }
    if let Some(file) = first.get("_sFile").and_then(|x| x.as_str()) {
        if let Some(base) = first.get("_sBaseUrl").and_then(|x| x.as_str()) {
            return Some(format!("{base}/{file}"));
        }
        return Some(file.to_string());
    }
    None
}

fn summary_from_record(record: &Value) -> Option<RemoteModSummary> {
    let id = val_i64(record, &["_idRow", "id"])?;
    let name = val_str(record, &["_sName", "name"]).unwrap_or_else(|| id.to_string());
    let author = record
        .get("_aSubmitter")
        .and_then(|s| val_str(s, &["_sName", "name"]));
    let profile = val_str(record, &["_sProfileUrl", "_sUrl"]).unwrap_or_else(|| {
        format!("https://gamebanana.com/mods/{id}")
    });
    Some(RemoteModSummary {
        source: SOURCE_GAMEBANANA.to_string(),
        id: id.to_string(),
        name,
        author,
        summary: val_str(record, &["_sSubtitle", "_sSummary", "summary"]),
        version: val_str(record, &["_sVersion"]),
        downloads: val_i64(record, &["_nDownloadCount", "_nDownloads"]),
        endorsements: val_i64(record, &["_nLikeCount", "_nEndorsements"]),
        updated_at: timestamp_string(record.get("_tsDateUpdated").or_else(|| record.get("_tsDateAdded"))),
        created_at: timestamp_string(record.get("_tsDateAdded")),
        thumbnail_url: thumbnail(record).or_else(|| val_str(record, &["_sImageUrl"])),
        url: profile,
        category: record
            .get("_aCategory")
            .and_then(|c| val_str(c, &["_sName"])),
        tags: Vec::new(),
        file_count: None,
    })
}

pub async fn resolve_game(title: &str) -> Result<Option<GameRef>, String> {
    let url = format!(
        "{API}/Util/Search/Results?_sModelName=Game&_sSearchString={}&_nPerpage=15",
        urlencoding::encode(title)
    );
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("gamebanana game search: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("gamebanana game search: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("gamebanana game search decode: {e}"))?;
    let arr = first_array(&v, &["_aRecords", "records"]).cloned().unwrap_or_default();
    let norm = normalize_name(title);
    let mut best: Option<(i32, GameRef)> = None;
    for g in &arr {
        let name = val_str(g, &["_sName", "name"]).unwrap_or_default();
        let id = val_i64(g, &["_idRow", "id"]);
        let Some(id) = id else { continue };
        let cn = normalize_name(&name);
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
            best = Some((score, GameRef { external_id: id.to_string(), label: name }));
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
    let sort_param = match sort {
        "latest" => "new",
        "updated" => "updated",
        _ => "default",
    };
    // A search query switches to the global mod search endpoint; an
    // empty query lists the game's subfeed.
    let url = if query.trim().is_empty() {
        format!(
            "{API}/Game/{external_id}/Subfeed?_nPerpage={page_size}&_nPage={page}&_sSort={sort_param}&_csvModelInclusions=Mod"
        )
    } else {
        format!(
            "{API}/Util/Search/Results?_sModelName=Mod&_sSearchString={}&_nPerpage={page_size}&_nPage={page}&_idGameRow={external_id}",
            urlencoding::encode(query)
        )
    };
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("gamebanana browse: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("gamebanana browse: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("gamebanana browse decode: {e}"))?;
    let arr = first_array(&v, &["_aRecords", "records"]).cloned().unwrap_or_default();
    let results: Vec<RemoteModSummary> = arr.iter().filter_map(summary_from_record).collect();
    let total = v
        .get("_aMetadata")
        .and_then(|m| val_i64(m, &["_nRecordCount"]))
        .or(Some(results.len() as i64));
    let has_more = results.len() as u32 >= page_size && !query.trim().is_empty();
    Ok(RemoteModSearch {
        source: SOURCE_GAMEBANANA.to_string(),
        query: query.to_string(),
        results,
        page,
        total,
        has_more,
    })
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let url = format!("{API}/Mod/{mod_id}/ProfilePage");
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("gamebanana detail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("gamebanana detail: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("gamebanana detail decode: {e}"))?;
    let mut summary = summary_from_record(&v).ok_or("gamebanana: empty mod")?;
    summary.url = format!("https://gamebanana.com/mods/{mod_id}");
    let description = val_str(&v, &["_sText", "_sDescription"]);

    let mut gallery = Vec::new();
    if let Some(images) = v
        .get("_aPreviewMedia")
        .and_then(|m| m.get("_aImages"))
        .and_then(|x| x.as_array())
    {
        for img in images {
            if let Some(base) = img.get("_sBaseUrl").and_then(|x| x.as_str()) {
                if let Some(file) = img
                    .get("_sFile")
                    .or_else(|| img.get("_sFile530"))
                    .and_then(|x| x.as_str())
                {
                    gallery.push(format!("{base}/{file}"));
                }
            }
        }
    }

    let mut files = Vec::new();
    if let Some(file_arr) = v.get("_aFiles").and_then(|x| x.as_array()) {
        for (i, f) in file_arr.iter().enumerate() {
            let fid = val_i64(f, &["_idRow"]).map(|n| n.to_string()).unwrap_or_default();
            let fname = val_str(f, &["_sFile", "_sName"]).unwrap_or_else(|| format!("file {fid}"));
            let download = val_str(f, &["_sDownloadUrl"]);
            files.push(RemoteModFile {
                id: fid,
                name: fname.clone(),
                version: val_str(f, &["_sVersion"]),
                size_bytes: val_i64(f, &["_nFilesize", "_nFileSize"]),
                uploaded_at: timestamp_string(f.get("_tsDateAdded")),
                category: None,
                is_primary: i == 0,
                download_kind: if download.is_some() { "direct" } else { "external" }.to_string(),
                download_url: download.or_else(|| Some(summary.url.clone())),
                file_name: Some(fname),
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
    let url = format!("{API}/Mod/{mod_id}/ProfilePage");
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("gamebanana download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("gamebanana download: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("gamebanana download decode: {e}"))?;
    let files = v.get("_aFiles").and_then(|x| x.as_array());
    let chosen = files.and_then(|files| {
        file_id
            .and_then(|id| {
                files
                    .iter()
                    .find(|f| val_i64(f, &["_idRow"]).map(|n| n.to_string()).as_deref() == Some(id))
            })
            .or_else(|| files.first())
    });
    if let Some(f) = chosen {
        if let Some(dl) = val_str(f, &["_sDownloadUrl"]) {
            let file_name = val_str(f, &["_sFile"]);
            return Ok(RemoteDownload {
                kind: "direct".to_string(),
                url: dl,
                filename: file_name,
                referer: Some(format!("https://gamebanana.com/mods/{mod_id}")),
                headers: Vec::new(),
                message: None,
            });
        }
    }
    Ok(RemoteDownload {
        kind: "external".to_string(),
        url: format!("https://gamebanana.com/mods/{mod_id}"),
        filename: None,
        referer: None,
        headers: Vec::new(),
        message: Some("GameBanana has no direct download for this file — open the page.".into()),
    })
}
