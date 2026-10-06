//! Steam Workshop browsing via the Steam Web API.
//!
//! Workshop items can't be downloaded out of band — Steam owns the
//! subscription — so this source is browse/detail only and points the
//! user at the Steam client for the actual install.

use super::*;

const QUERY_URL: &str = "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/";
const DETAILS_URL: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

fn key() -> Result<String, String> {
    steam_api_key().ok_or_else(|| "Connect your Steam account to browse the Workshop".to_string())
}

fn workshop_url(id: &str) -> String {
    format!("https://steamcommunity.com/sharedfiles/filedetails/?id={id}")
}

fn summary_from_details(d: &Value) -> Option<RemoteModSummary> {
    let id = val_str(d, &["publishedfileid", "published_file_id"])?;
    let name = val_str(d, &["title"]).unwrap_or_else(|| id.clone());
    Some(RemoteModSummary {
        source: SOURCE_WORKSHOP.to_string(),
        id: id.clone(),
        name,
        author: val_str(d, &["creator"]),
        summary: val_str(d, &["short_description", "file_description"]),
        version: val_str(d, &["time_updated"]),
        downloads: val_i64(d, &["subscriptions", "views"]),
        endorsements: val_i64(d, &["favorited", "favorites"]),
        updated_at: timestamp_string(d.get("time_updated")),
        created_at: timestamp_string(d.get("time_created")),
        thumbnail_url: val_str(d, &["preview_url"]),
        url: workshop_url(&id),
        category: None,
        tags: d
            .get("tags")
            .and_then(|t| t.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|t| val_str(t, &["tag", "display_name", "name"]))
                    .collect()
            })
            .unwrap_or_default(),
        file_count: Some(1),
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
    // EPublishedFileQueryType: 0 publication date, 9 trend.
    let query_type = if sort == "latest" { 0 } else { 9 };
    let resp = http_client()
        .get(QUERY_URL)
        .query(&[
            ("key", key.as_str()),
            ("appid", external_id),
            ("search_text", query),
            ("query_type", &query_type.to_string()),
            ("numperpage", &page_size.to_string()),
            ("page", &page.to_string()),
            ("return_details", "true"),
            ("filetype", "0"),
            ("days", "-1"),
        ])
        .send()
        .await
        .map_err(|e| format!("workshop browse: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("workshop browse: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("workshop browse decode: {e}"))?;
    let response = v.get("response").cloned().unwrap_or(Value::Null);
    let arr = first_array(&response, &["publishedfiledetails"]).cloned().unwrap_or_default();
    let total = val_i64(&response, &["total"]);
    let results: Vec<RemoteModSummary> = arr.iter().filter_map(summary_from_details).collect();
    let has_more = total
        .map(|t| (page * page_size) as i64 <= t && !results.is_empty())
        .unwrap_or(results.len() as u32 >= page_size);
    Ok(RemoteModSearch {
        source: SOURCE_WORKSHOP.to_string(),
        query: query.to_string(),
        results,
        page,
        total,
        has_more,
    })
}

pub async fn detail(external_id: &str, mod_id: &str) -> Result<RemoteModDetail, String> {
    let resp = http_client()
        .post(DETAILS_URL)
        .form(&[
            ("itemcount", "1".to_string()),
            ("publishedfileids[0]", mod_id.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("workshop detail: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("workshop detail: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("workshop detail decode: {e}"))?;
    let response = v.get("response").cloned().unwrap_or(Value::Null);
    let arr = first_array(&response, &["publishedfiledetails"]).cloned().unwrap_or_default();
    let first = arr.first().ok_or("workshop: item not found")?;
    let summary = summary_from_details(first).ok_or("workshop: empty item")?;
    let description = val_str(first, &["file_description", "short_description"]);
    let gallery = val_str(first, &["preview_url"]).into_iter().collect();
    let file_name = val_str(first, &["filename"]).unwrap_or_else(|| summary.name.clone());
    let files = vec![RemoteModFile {
        id: summary.id.clone(),
        name: file_name.clone(),
        version: summary.version.clone(),
        size_bytes: val_i64(first, &["file_size"]),
        uploaded_at: timestamp_string(first.get("time_updated")),
        category: None,
        is_primary: true,
        download_kind: "steam".to_string(),
        download_url: Some(workshop_url(&summary.id)),
        file_name: Some(file_name),
    }];
    let _ = external_id;
    Ok(RemoteModDetail {
        summary,
        description,
        gallery,
        files,
        links: vec![RemoteModLink {
            label: "Steam Workshop".to_string(),
            url: workshop_url(mod_id),
        }],
    })
}

pub async fn download(
    _external_id: &str,
    mod_id: &str,
    _file_id: Option<&str>,
) -> Result<RemoteDownload, String> {
    Ok(RemoteDownload {
        kind: "steam".to_string(),
        url: workshop_url(mod_id),
        filename: None,
        referer: None,
        headers: Vec::new(),
        message: Some("Workshop items install through Steam — open the page and subscribe.".into()),
    })
}
