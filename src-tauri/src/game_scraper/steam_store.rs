use serde::Deserialize;
use std::collections::HashMap;

use super::*;
use super::igdb::{extract_year_hint, http_client};
use super::text_util::url_encode;
use super::title_match::{MIN_TITLE_SIMILARITY, title_similarity};

// ─── Steam API Types (internal) ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub(crate) struct SteamSearchResponse {
    pub(crate) items: Vec<SteamSearchItem>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamSearchItem {
    pub(crate) id: u64,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) tiny_image: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamAppDetailResponse {
    #[serde(flatten)]
    pub(crate) apps: HashMap<String, SteamAppDetailWrapper>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamAppDetailWrapper {
    pub(crate) success: bool,
    pub(crate) data: Option<SteamAppDetail>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamAppDetail {
    #[allow(dead_code)]
    pub(crate) name: Option<String>,
    pub(crate) short_description: Option<String>,
    #[serde(default)]
    pub(crate) developers: Vec<String>,
    #[serde(default)]
    publishers: Vec<String>,
    pub(crate) release_date: Option<SteamReleaseDate>,
    #[serde(default)]
    pub(crate) genres: Vec<SteamGenre>,
    #[serde(default)]
    pub(crate) categories: Vec<SteamCategory>,
    pub(crate) header_image: Option<String>,
    pub(crate) capsule_image: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamReleaseDate {
    pub(crate) date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamGenre {
    pub(crate) description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamCategory {
    pub(crate) description: Option<String>,
}

/// Fetch community user tags from Steam's public app hover endpoint.
/// This endpoint (`https://store.steampowered.com/apphoverpublic/<appid>?l=english`)
/// is public, unauthenticated, requires no API key, and returns the top 20
/// player-voted tags (e.g. "Souls-like", "Open World", "Cyberpunk", "Dark Fantasy").
pub async fn fetch_steam_user_tags(app_id: u32) -> Vec<String> {
    let client = http_client();
    let url = format!("https://store.steampowered.com/apphoverpublic/{}?l=english", app_id);
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let html = match resp.text().await {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    parse_steam_hover_tags(&html)
}

/// Parse user tags from the HTML of Steam's apphoverpublic endpoint.
pub(crate) fn parse_steam_hover_tags(html: &str) -> Vec<String> {
    let re = match regex::Regex::new(r#"<div[^>]*class="[^"]*app_tag[^"]*"[^>]*>([^<]+)</div>"#) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let mut tags = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let decoded = m.as_str()
                .replace("&amp;", "&")
                .replace("&nbsp;", " ")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
            let clean = decoded.trim();
            if !clean.is_empty() {
                let lower = clean.to_lowercase();
                if seen.insert(lower) {
                    tags.push(clean.to_string());
                }
            }
        }
    }
    tags
}

/// Fetch both official Steam store genres (Action, RPG, Strategy, etc.) and
/// community user tags (Souls-like, Cyberpunk, etc.) for a Steam app id.
pub async fn fetch_steam_genres_and_tags(app_id: u32) -> Vec<String> {
    let client = http_client();
    let detail_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );

    let (detail_resp, user_tags) = tokio::join!(
        client.get(&detail_url).send(),
        fetch_steam_user_tags(app_id)
    );

    let mut genres = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(resp) = detail_resp {
        if resp.status().is_success() {
            if let Ok(detail_data) = resp.json::<SteamAppDetailResponse>().await {
                if let Some(wrapper) = detail_data.apps.get(&app_id.to_string()) {
                    if wrapper.success {
                        if let Some(data) = &wrapper.data {
                            for g in &data.genres {
                                if let Some(desc) = &g.description {
                                    if seen.insert(desc.to_lowercase()) {
                                        genres.push(desc.clone());
                                    }
                                }
                            }
                            for cat in &data.categories {
                                if let Some(desc) = &cat.description {
                                    let desc_lower = desc.to_lowercase();
                                    if desc_lower.contains("player")
                                        || desc_lower.contains("co-op")
                                        || desc_lower.contains("pvp")
                                        || desc_lower.contains("vr")
                                    {
                                        if seen.insert(desc_lower) {
                                            genres.push(desc.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for tag in user_tags {
        if seen.insert(tag.to_lowercase()) {
            genres.push(tag);
        }
    }

    genres
}

/// Directly fetch Steam metadata by appid (uses Steam's appdetails API + community tags).
pub async fn fetch_steam_game_by_appid(app_id: u32) -> Option<GameMetadataResult> {
    let client = http_client();
    let detail_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );

    let (detail_resp, user_tags) = tokio::join!(
        client.get(&detail_url).send(),
        fetch_steam_user_tags(app_id)
    );

    let detail_resp = detail_resp.ok()?;
    let detail_data: SteamAppDetailResponse = detail_resp.json().await.ok()?;

    let wrapper = detail_data.apps.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Combine Steam broad genres, top community user tags, and gameplay categories
    let mut genres: Vec<String> = data
        .genres
        .iter()
        .filter_map(|g| g.description.clone())
        .collect();
    let mut seen_genres: std::collections::HashSet<String> =
        genres.iter().map(|g| g.to_lowercase()).collect();

    for tag in user_tags {
        if seen_genres.insert(tag.to_lowercase()) {
            genres.push(tag);
        }
    }

    for cat in &data.categories {
        if let Some(desc) = &cat.description {
            let desc_lower = desc.to_lowercase();
            if desc_lower.contains("player")
                || desc_lower.contains("co-op")
                || desc_lower.contains("pvp")
                || desc_lower.contains("vr")
            {
                if seen_genres.insert(desc_lower) {
                    genres.push(desc.clone());
                }
            }
        }
    }

    let images = GameImages {
        icon: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/capsule_231x87.jpg",
            app_id
        )),
        cover: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg",
            app_id
        )),
        hero: data
            .capsule_image
            .clone()
            .or_else(|| data.header_image.clone())
            .or_else(|| {
                Some(format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                    app_id
                ))
            }),
        banner: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_hero.jpg",
            app_id
        )),
        logo: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png",
            app_id
        )),
    };

    let title = data.name.clone().unwrap_or_default();
    let is_vr = Some(crate::vr::detect_vr(&title, &genres, &[]));

    Some(GameMetadataResult {
        title,
        description: data.short_description.clone(),
        developer: data.developers.first().cloned(),
        publisher: data.publishers.first().cloned(),
        collection_id: None,
        igdb_id: None,
        release_date: data
            .release_date
            .as_ref()
            .and_then(|rd| rd.date.clone()),
        genres,
        images,
        source_url: format!("https://store.steampowered.com/app/{}", app_id),
        source_name: "Steam".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
        alternative_names: None,
        collection: None,
        franchise: None,
        game_category: None,
        release_status: None,
        language_supports: None,
        is_vr,
    })
}


/// Raw movie entry from the Steam `appdetails` endpoint. We expose
/// the four resolution slots (`webm.max`, `webm.full`, `mp4.max`,
/// `mp4.full`) plus `thumbnail` (a JPG poster) and `highlight`
/// (Steam's flagged "main trailer" bit). The frontend uses the
/// thumbnail as `<video poster>` so movies render beautifully
/// while paused.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamMovie {
    #[serde(default)]
    pub(crate) id: u32,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) thumbnail: Option<String>,
    #[serde(default)]
    pub(crate) highlight: bool,
    #[serde(default)]
    pub(crate) webm: Option<SteamMovieVariant>,
    #[serde(default)]
    pub(crate) mp4: Option<SteamMovieVariant>,
    #[serde(default, rename = "hls_h264")]
    pub(crate) hls_h264: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub(crate) struct SteamMovieVariant {
    #[serde(default)]
    pub(crate) max: Option<String>,
    #[serde(default)]
    #[serde(rename = "480")]
    pub(crate) p480: Option<String>,
    #[serde(default)]
    pub(crate) full: Option<String>,
}

// ─── Source: Steam ────────────────────────────────────────────────────────────

/// Search Steam's store for a game and return metadata.
pub(crate) async fn search_steam(game_name: &str) -> Option<GameMetadataResult> {
    let client = http_client();

    // Step 1: Search the Steam store
    let cleaned_name = clean_game_name_for_search(game_name);
    let term = if cleaned_name.is_empty() { game_name } else { &cleaned_name };
    let search_url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(term)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_data: SteamSearchResponse = search_resp.json().await.ok()?;

    // Steam's storesearch ranks results by its own relevance, which can put a
    // loosely-related title first — e.g. "The Wolf Among Us" ahead of the
    // actual "Among Us" because of substring overlap. Pick candidate whose
    // title similarity matches game_name or term best; among equal-scoring
    // candidates prefer the one whose name carries the queried year hint
    // (e.g. "Prototype (2009)" → the 2009 Prototype, not a same-named title).
    let year_hint = extract_year_hint(game_name);
    let best_match = search_data
        .items
        .into_iter()
        .map(|item| {
            let score = title_similarity(game_name, &item.name).max(title_similarity(term, &item.name));
            let year_match = year_hint.as_deref().map(|y| item.name.contains(y)).unwrap_or(false);
            (score, year_match, item)
        })
        .filter(|(score, _, _)| *score >= MIN_TITLE_SIMILARITY)
        .max_by(|a, b| {
            (a.0, a.1).partial_cmp(&(b.0, b.1)).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(_, _, item)| item)?;
    let app_id = best_match.id;
    let title = best_match.name;

    // Step 2: Get detailed app information and community user tags in parallel
    let detail_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );

    let (detail_resp, user_tags) = tokio::join!(
        client.get(&detail_url).send(),
        fetch_steam_user_tags(app_id as u32)
    );

    let detail_resp = detail_resp.ok()?;
    let detail_data: SteamAppDetailResponse = detail_resp.json().await.ok()?;

    let wrapper = detail_data.apps.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Combine Steam broad genres, top community user tags, and gameplay categories
    let mut genres: Vec<String> = data
        .genres
        .iter()
        .filter_map(|g| g.description.clone())
        .collect();
    let mut seen_genres: std::collections::HashSet<String> =
        genres.iter().map(|g| g.to_lowercase()).collect();

    for tag in user_tags {
        if seen_genres.insert(tag.to_lowercase()) {
            genres.push(tag);
        }
    }

    for cat in &data.categories {
        if let Some(desc) = &cat.description {
            let desc_lower = desc.to_lowercase();
            if desc_lower.contains("player") || desc_lower.contains("co-op") || desc_lower.contains("pvp") || desc_lower.contains("vr") {
                if seen_genres.insert(desc_lower) {
                    genres.push(desc.clone());
                }
            }
        }
    }

    // Build images from the API response and CDN patterns. `tiny_image`
    // from storesearch is already a full URL (e.g. shared.akamai.
    // steamstatic.com/store_item_assets/.../capsule_231x87.jpg?t=...), not
    // a hash — previously it was wrapped in the community-icon URL pattern,
    // producing a broken double-URL that always 404'd.
    let images = GameImages {
        icon: best_match.tiny_image,
        cover: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg",
            app_id
        )),
        hero: data
            .capsule_image
            .clone()
            .or_else(|| data.header_image.clone())
            .or_else(|| {
                Some(format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                    app_id
                ))
            }),
        banner: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_hero.jpg",
            app_id
        )),
        logo: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png",
            app_id
        )),
    };

    let is_vr = Some(crate::vr::detect_vr(&title, &genres, &[]));

    Some(GameMetadataResult {
        title,
        description: data.short_description.clone(),
        developer: data.developers.first().cloned(),
        publisher: data.publishers.first().cloned(),
        // Steam API does not return IGDB collection IDs, so the
        // GameRelationsCard cannot fetch "Other in Collection"
        // members for Steam-sourced metadata. Hardcode `None`
        // because the struct requires the field.
        collection_id: None,
        // Steam API does not return the IGDB game id either; hardcode
        // `None` so the field round-trips as absent on non-IGDB rows.
        igdb_id: None,
        release_date: data
            .release_date
            .as_ref()
            .and_then(|rd| rd.date.clone()),
        genres,
        images,
        source_url: format!("https://store.steampowered.com/app/{}", app_id),
        source_name: "Steam".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
        alternative_names: None,
        collection: None,
        franchise: None,
        game_category: None,
        release_status: None,
        language_supports: None,
        is_vr,
    })
}
