use serde::Deserialize;

use super::*;

pub async fn lookup_steam_app_id(game_name: &str) -> Option<u64> {
    let client = http_client();

    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(game_name)
    );

    let resp = client.get(&url).send().await.ok()?;
    let data: SteamSearchResponse = resp.json().await.ok()?;

    // Normalize: lowercase + collapse whitespace. We use this to compare
    // query words against the result name.
    let query_norm = game_name
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect::<Vec<_>>();

    if query_norm.is_empty() {
        return None;
    }

    data.items.into_iter().find(|item| {
        let name_norm = item.name.to_lowercase();
        query_norm.iter().all(|word| name_norm.contains(word.as_str()))
    }).map(|item| item.id)
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamReviewResponse {
    success: u32,
    #[serde(default)]
    query_summary: Option<SteamQuerySummary>,
    reviews: Option<Vec<SteamReview>>,
    #[serde(default)]
    cursor: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub(crate) struct SteamQuerySummary {
    #[serde(default)]
    pub(crate) total_reviews: u64,
    #[serde(default)]
    pub(crate) total_positive: u64,
    #[serde(default)]
    pub(crate) total_negative: u64,
    #[serde(default)]
    pub(crate) review_score: u32,
    #[serde(default)]
    pub(crate) review_score_desc: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamReview {
    review: Option<String>,
    voted_up: Option<bool>,
    votes_up: Option<u32>,
    votes_funny: Option<u32>,
    language: Option<String>,
    timestamp_created: Option<u64>,
    author: Option<SteamAuthor>,
    /// Steam serializes this as a stringified float in [0,1].
    #[serde(default)]
    weighted_vote_score: Option<serde_json::Value>,
    #[serde(default)]
    comment_count: Option<u32>,
    #[serde(default)]
    steam_purchase: Option<bool>,
    #[serde(default)]
    received_for_free: Option<bool>,
    #[serde(default)]
    written_during_early_access: Option<bool>,
    #[serde(default)]
    primarily_steam_deck: Option<bool>,
    #[serde(default)]
    reactions: Option<Vec<SteamReactionRaw>>,
    #[serde(default)]
    hardware: Option<SteamHardwareRaw>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamAuthor {
    steamid: Option<String>,
    personaname: Option<String>,
    #[serde(default)]
    playtime_forever: Option<u64>,
    #[serde(default)]
    playtime_at_review: Option<u64>,
    #[serde(default)]
    deck_playtime_at_review: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SteamReactionRaw {
    #[serde(default)]
    reaction_type: u32,
    #[serde(default)]
    count: u32,
}

/// Raw Steam `hardware` block. Fields vary; we coerce the useful ones
/// into `SteamHardware`. RAM/VRAM arrive as strings or numbers.
#[derive(Debug, Deserialize)]
pub(crate) struct SteamHardwareRaw {
    #[serde(default)]
    os: Option<String>,
    #[serde(default)]
    cpu_name: Option<String>,
    #[serde(default)]
    adapter_description: Option<String>,
    #[serde(default)]
    dx_video_card: Option<String>,
    #[serde(default)]
    system_ram: Option<serde_json::Value>,
    #[serde(default)]
    vram_size: Option<serde_json::Value>,
}

/// Coerce a Steam JSON value (string or number) into a u64 of megabytes.
pub(crate) fn steam_num_to_mb(v: &serde_json::Value) -> Option<u64> {
    match v {
        serde_json::Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)),
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok().map(|f| f as u64),
        _ => None,
    }
}

/// Parsed reviews query options forwarded from the frontend. Mirrors the
/// Steam appreviews query params exposed by the ReviewViewer plugin.
#[derive(Debug, Default, Clone)]
pub struct SteamReviewQuery {
    pub cursor: String,
    pub language: Option<String>,
    /// Display order → Steam `filter` param: "recent" | "funny" |
    /// "summary" | anything else → "all" (Most Helpful).
    pub filter_type: Option<String>,
    /// Review recommendation → Steam `review_type`: "all"|"positive"|"negative".
    pub review_type: Option<String>,
    /// Purchase source → Steam `purchase_type`: "all"|"steam"|"other".
    pub purchase_type: Option<String>,
    pub playtime_min_hours: Option<u32>,
    pub playtime_max_hours: Option<u32>,
    /// Device → Steam `playtime_type`: "all"|"deck".
    pub playtime_device: Option<String>,
    pub use_helpful_system: bool,
}

/// Fetch recent reviews from the Steam storefront for a given app id.
///
/// Uses cursor-based pagination. Returns (reviews, total_count, next_cursor, query_summary).
/// `total_count` is the total reviews returned by query_summary.
/// `next_cursor` is None when there are no more pages.
pub(crate) async fn fetch_steam_reviews(
    app_id: u64,
    opts: &SteamReviewQuery,
) -> Result<(Vec<IgdbReview>, u64, Option<String>, Option<SteamQuerySummary>), String> {
    let client = http_client();

    let cursor_param = if opts.cursor.is_empty() || opts.cursor == "*" {
        "*"
    } else {
        opts.cursor.as_str()
    };

    // Steam cursors contain characters like '+' and '/' which must be URL-encoded
    // so they are not corrupted or misparsed as space/slashes by the Steam server.
    // First decode in case cursor is already percent-encoded, then encode cleanly.
    let encoded_cursor = if cursor_param == "*" {
        "*".to_string()
    } else {
        let decoded = urlencoding::decode(cursor_param).unwrap_or(std::borrow::Cow::Borrowed(cursor_param));
        urlencoding::encode(&decoded).into_owned()
    };

    let lang_param = opts.language.as_deref().unwrap_or("all");

    // Display order → `filter`. "summary"/"all" both mean the ranked view.
    let filter_param = match opts.filter_type.as_deref() {
        Some("recent") => "recent",
        Some("funny") => "funny",
        Some("summary") => "summary",
        _ => "all",
    };
    let review_type_param = match opts.review_type.as_deref() {
        Some("positive") => "positive",
        Some("negative") => "negative",
        _ => "all",
    };
    let purchase_type_param = match opts.purchase_type.as_deref() {
        Some("steam") => "steam",
        Some("other") => "non_steam_purchase",
        _ => "all",
    };
    let playtime_type_param = match opts.playtime_device.as_deref() {
        Some("deck") => "deck",
        _ => "all",
    };
    let playtime_min = opts.playtime_min_hours.unwrap_or(0);
    // A max of 0 (or the UI's 100 sentinel) means "no maximum".
    let playtime_max = match opts.playtime_max_hours {
        Some(100) | None => 0,
        Some(v) => v,
    };
    let use_quality = if opts.use_helpful_system { 1 } else { 0 };

    let url = format!(
        "https://store.steampowered.com/appreviews/{}?json=1&l=english&language={}&cursor={}\
&filter={}&review_type={}&purchase_type={}&playtime_filter_min={}&playtime_filter_max={}\
&playtime_type={}&filter_offtopic_activity=0&use_review_quality={}&num_per_page=20",
        app_id,
        lang_param,
        encoded_cursor,
        filter_param,
        review_type_param,
        purchase_type_param,
        playtime_min,
        playtime_max,
        playtime_type_param,
        use_quality,
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam reviews request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Steam reviews returned HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Steam reviews response: {}", e))?;

    let data: SteamReviewResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Steam reviews parse error: {}", e))?;

    if data.success != 1 {
        return Err("Steam reviews response was not successful".to_string());
    }

    let summary = data.query_summary.clone();
    let total_reviews = data
        .query_summary
        .map(|q| q.total_reviews)
        .unwrap_or(0);
    let next_cursor = data.cursor.filter(|c| !c.is_empty() && c != "*");

    let raw_reviews = data.reviews.unwrap_or_default();

    let reviews = raw_reviews
        .into_iter()
        .filter_map(|r| {
            let content = r.review.filter(|s| !s.trim().is_empty())?;
            let score = if r.voted_up.unwrap_or(false) { 85.0 } else { 35.0 };
            let steamid = r.author.as_ref().and_then(|a| a.steamid.as_ref());
            let display_name = r.author.as_ref()
                .and_then(|a| a.personaname.as_ref())
                .cloned()
                .or_else(|| {
                    steamid.map(|id| {
                        let tail = id.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>();
                        if tail.is_empty() { format!("Steam Player") }
                        else { format!("Steam Player …{}", tail) }
                    })
                });
            // weighted_vote_score is a stringified float in [0,1]; convert
            // to a 0-100 confidence percentage for the UI.
            let weight_pct = r.weighted_vote_score.as_ref().and_then(|v| match v {
                serde_json::Value::Number(n) => n.as_f64(),
                serde_json::Value::String(s) => s.trim().parse::<f64>().ok(),
                _ => None,
            }).map(|f| (f * 100.0).round().clamp(0.0, 100.0));

            let reactions = r.reactions.map(|list| {
                list.into_iter()
                    .filter(|x| x.count > 0)
                    .map(|x| SteamReaction { reaction_type: x.reaction_type, count: x.count })
                    .collect::<Vec<_>>()
            }).filter(|v| !v.is_empty());

            let hw = r.hardware.and_then(|h| {
                let gpu = h.adapter_description
                    .filter(|s| !s.trim().is_empty())
                    .or_else(|| h.dx_video_card.filter(|s| !s.trim().is_empty()));
                let spec = SteamHardware {
                    os: h.os.filter(|s| !s.trim().is_empty()),
                    cpu_name: h.cpu_name.filter(|s| !s.trim().is_empty()),
                    gpu_name: gpu,
                    system_ram_mb: h.system_ram.as_ref().and_then(steam_num_to_mb).filter(|n| *n > 0),
                    vram_size_mb: h.vram_size.as_ref().and_then(steam_num_to_mb).filter(|n| *n > 0),
                };
                if spec.is_empty() { None } else { Some(spec) }
            });

            let author_steam_id = steamid.cloned();
            let (playtime_forever, playtime_at_review, deck_playtime) = r.author.as_ref()
                .map(|a| (a.playtime_forever, a.playtime_at_review, a.deck_playtime_at_review))
                .unwrap_or((None, None, None));

            Some(IgdbReview {
                title: None,
                content: Some(content),
                rating: Some(score),
                language: r.language,
                votes_up: r.votes_up,
                votes_funny: r.votes_funny,
                timestamp_created: r.timestamp_created,
                username: display_name,
                author_steam_id,
                author_playtime_forever: playtime_forever.filter(|n| *n > 0),
                author_playtime_at_review: playtime_at_review.filter(|n| *n > 0),
                author_deck_playtime_at_review: deck_playtime.filter(|n| *n > 0),
                primarily_steam_deck: r.primarily_steam_deck,
                received_for_free: r.received_for_free,
                written_during_early_access: r.written_during_early_access,
                steam_purchase: r.steam_purchase,
                comment_count: r.comment_count.filter(|n| *n > 0),
                reactions,
                weight_vote_up_percentage: weight_pct,
                hw,
                ..Default::default()
            })
        })
        .collect();

    Ok((reviews, total_reviews, next_cursor, summary))
}
