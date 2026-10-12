use super::*;
use super::igdb::{fetch_igdb_game_by_steam_appid, http_client};
use super::launchbox::search_launchbox;
use super::steam_about::base64_encode;
use super::steam_store::search_steam;

// ─── Public API ───────────────────────────────────────────────────────────────

/// Search for game metadata across multiple sources.
/// Returns results ordered by relevance (best match first).
/// Currently supports Steam and LaunchBox Games Database.
pub async fn search_game_metadata(
    game_name: &str,
    skip_launchbox: bool,
    steam_app_id: Option<u32>,
) -> Vec<GameMetadataResult> {
    let mut results: Vec<GameMetadataResult> = Vec::new();

    // ── Appid-pinned exact IGDB game (Steam-synced titles) ────────────────
    // The Steam appid is an exact key into IGDB via the external_games
    // bridge. When we have one we resolve it directly instead of guessing by
    // name, which kills the same-name collision bug (e.g. "Prototype" 2009
    // vs another game that happens to share the name): the exact entry is
    // pinned as the FIRST result and the frontend's IGDB-preference picks it
    // up immediately.
    let mut igdb_pinned = false;
    if let Some(appid) = steam_app_id {
        if let Some(mut pinned) = fetch_igdb_game_by_steam_appid(appid).await {
            let steam_tags = fetch_steam_genres_and_tags(appid).await;
            if !steam_tags.is_empty() {
                let mut merged = pinned.genres.clone();
                let mut seen: std::collections::HashSet<String> =
                    merged.iter().map(|g| g.to_lowercase()).collect();
                for tag in steam_tags {
                    if seen.insert(tag.to_lowercase()) {
                        merged.push(tag);
                    }
                }
                pinned.genres = merged;
            }
            results.push(pinned);
            igdb_pinned = true;
        } else if let Some(steam_meta) = fetch_steam_game_by_appid(appid).await {
            results.push(steam_meta);
            igdb_pinned = true;
        }
    }

    if skip_launchbox {
        // Steam-synced games: skip LaunchBox (wasteful scrape), use IGDB + Steam
        let igdb_future = if igdb_pinned {
            futures::future::Either::Left(futures::future::ready(Vec::new()))
        } else {
            futures::future::Either::Right(search_igdb(game_name))
        };
        let (steam_result, igdb_results) = tokio::join!(search_steam(game_name), igdb_future);
        if let Some(r) = steam_result {
            results.push(r);
        }
        results.extend(igdb_results);
    } else {
        // Local imports: search all three sources
        let igdb_future = if igdb_pinned {
            futures::future::Either::Left(futures::future::ready(Vec::new()))
        } else {
            futures::future::Either::Right(search_igdb(game_name))
        };
        let (steam_result, launchbox_result, igdb_results) = tokio::join!(
            search_steam(game_name),
            search_launchbox(game_name),
            igdb_future
        );
        if let Some(r) = steam_result {
            results.push(r);
        }
        if let Some(r) = launchbox_result {
            results.push(r);
        }
        results.extend(igdb_results);
    }

    // HowLongToBeat is name-based, so resolve it once for the best IGDB
    // candidate (or the first result when IGDB has no match) and attach
    // it there. The frontend prefers the IGDB result when merging.
    if !results.is_empty() {
        let index = results
            .iter()
            .position(|r| r.source_name == "IGDB")
            .unwrap_or(0);
        if results[index].time_to_beat.is_none() {
            let lookup_name = results[index].title.clone();
            if let Some(ttb) = crate::hltb::fetch_time_to_beat(&lookup_name, None).await {
                results[index].time_to_beat = Some(ttb);
            }
        }
    }

    results
}

/// Download an image from a URL and return it as a base64 data URL.
/// Returns `None` if the download fails OR the server responds with a
/// non-success status — a 404/error page would otherwise be
/// base64-encoded as `data:text/html;base64,…`, which the browser
/// `<img>` can't render and which would poison the game's cover.
pub async fn download_image_to_base64(url: &str) -> Option<String> {
    // Artwork is a portrait cover or a logo; anything larger is a mistake or
    // a hostile response. Refuse it before allocating a multi-megabyte
    // buffer (and the ~33% larger base64 string that follows) in RAM.
    const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
    let client = http_client();

    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    if response.content_length().is_some_and(|len| len > MAX_IMAGE_BYTES) {
        return None;
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.ok()?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return None;
    }
    let b64 = base64_encode(&bytes);
    Some(format!("data:{};base64,{}", content_type, b64))
}
