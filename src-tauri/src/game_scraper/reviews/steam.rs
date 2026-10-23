use serde::Deserialize;
use serde_json::{json, Value};

use super::*;

/// Valve retired `store.steampowered.com/appreviews/<appid>?json=1` on
/// 2026-10-22; the path now redirects to the store homepage, which is why
/// callers saw an HTML body where they expected JSON. `GetAppReviews`
/// takes the same filters and needs no API key.
const STEAM_REVIEWS_API: &str =
    "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/";

/// Reviews per page — Steam's default and the page size the review viewer
/// has always used.
const STEAM_REVIEWS_PER_PAGE: u32 = 20;

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

/// `GetAppReviews` wraps its payload in `{"response": …}` and, unlike the
/// retired store endpoint, has no `success` field — the HTTP status is the
/// only signal. An app with no reviews answers `{"response":{}}`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct SteamReviewsEnvelope {
    response: Option<SteamReviewsResponseBody>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct SteamReviewsResponseBody {
    /// Totals for the query. The score fields are only present on the first
    /// page, and only when `review_type` is All.
    query_summary: Option<SteamQuerySummary>,
    reviews: Option<Vec<SteamReview>>,
    cursor: Option<String>,
    /// Reviews matching the query on every page, so it beats
    /// `query_summary.total_reviews` as a page-count source.
    total_matching: Option<u64>,
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
/// filters `GetAppReviews` accepts (and the ones `/appreviews` used to).
#[derive(Debug, Default, Clone)]
pub struct SteamReviewQuery {
    pub cursor: String,
    pub language: Option<String>,
    /// Display order → `filter` enum: "recent" | "funny" |
    /// "summary" | anything else → Helpful (Most Helpful).
    pub filter_type: Option<String>,
    /// Review recommendation → `review_type`: "all"|"positive"|"negative".
    pub review_type: Option<String>,
    /// Purchase source → `purchase_type`: "all"|"steam"|"other".
    pub purchase_type: Option<String>,
    pub playtime_min_hours: Option<u32>,
    pub playtime_max_hours: Option<u32>,
    /// Device → `primarily_steam_deck`: "all"|"deck".
    pub playtime_device: Option<String>,
    pub use_helpful_system: bool,
}

/// Map the UI's display order onto Steam's `filter` enum
/// (Helpful = 0, Recent = 1, Updated = 2, Funny = 3). "summary" was the
/// pre-2023 alias for the ranked view, so it shares Helpful with "all".
fn filter_enum(filter_type: Option<&str>) -> u32 {
    match filter_type {
        Some("recent") => 1,
        Some("funny") => 3,
        _ => 0,
    }
}

/// Map the recommendation filter onto Steam's `review_type` enum
/// (All = 0, Positive = 1, Negative = 2).
fn review_type_enum(review_type: Option<&str>) -> u32 {
    match review_type {
        Some("positive") => 1,
        Some("negative") => 2,
        _ => 0,
    }
}

/// Map the purchase filter onto Steam's `purchase_type` enum
/// (Steam = 0, All = 1, NonSteamPurchase = 2). Unlike the retired store
/// endpoint, Steam is the default here, so "all" must be stated explicitly.
fn purchase_type_enum(purchase_type: Option<&str>) -> u32 {
    match purchase_type {
        Some("steam") => 0,
        Some("other") => 2,
        _ => 1,
    }
}

/// Build the `input_json` blob that carries every `GetAppReviews` filter.
/// The cursor travels inside it, so it needs no pre-encoding — `reqwest`
/// percent-encodes the whole parameter value, which keeps the `+`, `/` and
/// `=` characters Steam puts in cursors intact.
pub(crate) fn build_reviews_input_json(opts: &SteamReviewQuery) -> Value {
    let cursor = if opts.cursor.is_empty() || opts.cursor == "*" {
        "*"
    } else {
        opts.cursor.as_str()
    };
    // A max of 0 (or the UI's 100 sentinel) means "no maximum".
    let playtime_max = match opts.playtime_max_hours {
        Some(100) | None => 0,
        Some(v) => v,
    };

    json!({
        "cursor": cursor,
        "filter": filter_enum(opts.filter_type.as_deref()),
        // The Helpful filter only searches the last 30 days unless told
        // otherwise (widening the window until it finds reviews). 0 keeps
        // the old `/appreviews?filter=all` behaviour of ranking reviews
        // across the title's whole lifetime.
        "day_range": 0,
        "languages": [opts.language.as_deref().unwrap_or("all")],
        "review_type": review_type_enum(opts.review_type.as_deref()),
        "purchase_type": purchase_type_enum(opts.purchase_type.as_deref()),
        "num_per_page": STEAM_REVIEWS_PER_PAGE,
        // Off-topic (review-bomb) reviews are filtered out unless this is
        // false — the review viewer has always shown them.
        "filter_offtopic_activity": false,
        "use_review_quality": opts.use_helpful_system,
        "playtime_min_hours": opts.playtime_min_hours.unwrap_or(0),
        "playtime_max_hours": playtime_max,
        "primarily_steam_deck": opts.playtime_device.as_deref() == Some("deck"),
    })
}

/// Fetch a page of reviews from Steam's Web API for a given app id.
///
/// Uses cursor-based pagination. Returns (reviews, total_count, next_cursor, query_summary).
/// `total_count` is the number of reviews matching the query.
/// `next_cursor` is None when there are no more pages.
pub(crate) async fn fetch_steam_reviews(
    app_id: u64,
    opts: &SteamReviewQuery,
) -> Result<(Vec<IgdbReview>, u64, Option<String>, Option<SteamQuerySummary>), String> {
    let input_json = build_reviews_input_json(opts);

    let resp = http_client()
        .get(STEAM_REVIEWS_API)
        .query(&[
            ("appid", app_id.to_string()),
            ("input_json", input_json.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Steam reviews request failed: {}", e))?;

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Steam reviews request was rate limited (HTTP 429)".to_string());
    }
    if !status.is_success() {
        return Err(format!("Steam reviews returned HTTP {}", status));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Steam reviews response: {}", e))?;

    parse_steam_reviews(&text)
}

/// Parse a `GetAppReviews` response body into the viewer's review shape.
pub(crate) fn parse_steam_reviews(
    text: &str,
) -> Result<(Vec<IgdbReview>, u64, Option<String>, Option<SteamQuerySummary>), String> {
    let envelope: SteamReviewsEnvelope = serde_json::from_str(text)
        .map_err(|e| format!("Steam reviews parse error: {}", e))?;

    // An absent `response` (or a bare `{}`) means Steam has no reviews to
    // report for this appid — a legitimate empty answer, not a failure.
    Ok(map_steam_reviews(envelope.response.unwrap_or_default()))
}

fn map_steam_reviews(
    body: SteamReviewsResponseBody,
) -> (Vec<IgdbReview>, u64, Option<String>, Option<SteamQuerySummary>) {
    let summary = body.query_summary.clone();
    // `total_matching` survives pagination and honours the active filters;
    // the summary only carries totals on page one.
    let total_reviews = body
        .total_matching
        .or_else(|| body.query_summary.as_ref().map(|q| q.total_reviews))
        .unwrap_or(0);
    let next_cursor = body.cursor.filter(|c| !c.is_empty() && c != "*");

    let raw_reviews = body.reviews.unwrap_or_default();

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
            // weighted_vote_score is a 0-1 float (a stringified float on the
            // retired store endpoint); convert either form to a 0-100
            // confidence percentage for the UI.
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

    (reviews, total_reviews, next_cursor, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed-down copy of an anonymous `GetAppReviews` response: same
    /// envelope, same field names, one review with and one without text.
    const FIXTURE: &str = r#"{
        "response": {
            "query_summary": {
                "num_reviews": 2,
                "review_score": 8,
                "review_score_desc": "Very Positive",
                "total_positive": 900,
                "total_negative": 100,
                "total_reviews": 1000
            },
            "reviews": [
                {
                    "recommendationid": "1",
                    "author": {
                        "steamid": "76561198000000001",
                        "num_reviews": 3,
                        "playtime_forever": 600,
                        "playtime_at_review": 540,
                        "deck_playtime_at_review": 30
                    },
                    "language": "english",
                    "review": "Still the benchmark for the genre.",
                    "timestamp_created": 1700000000,
                    "voted_up": true,
                    "votes_up": 12,
                    "votes_funny": 1,
                    "weighted_vote_score": 0.804,
                    "comment_count": 4,
                    "steam_purchase": true,
                    "received_for_free": false,
                    "written_during_early_access": false,
                    "primarily_steam_deck": false,
                    "refunded": false
                },
                {
                    "recommendationid": "2",
                    "author": { "steamid": "76561198000000002" },
                    "review": "   ",
                    "voted_up": false
                }
            ],
            "cursor": "AoJ4nK/gs6EDfMahjQc=",
            "total_matching": 4231
        }
    }"#;

    #[test]
    fn parses_reviews_and_query_totals() {
        let (reviews, total, next_cursor, summary) = parse_steam_reviews(FIXTURE).unwrap();

        // The whitespace-only review is dropped.
        assert_eq!(reviews.len(), 1);
        let review = &reviews[0];
        assert_eq!(review.content.as_deref(), Some("Still the benchmark for the genre."));
        assert_eq!(review.rating, Some(85.0));
        assert_eq!(review.votes_up, Some(12));
        assert_eq!(review.author_steam_id.as_deref(), Some("76561198000000001"));
        assert_eq!(review.author_playtime_at_review, Some(540));
        assert_eq!(review.author_deck_playtime_at_review, Some(30));
        assert_eq!(review.weight_vote_up_percentage, Some(80.0));
        assert_eq!(review.timestamp_created, Some(1700000000));

        // `total_matching` wins over the summary total so paging keeps the
        // count stable once Steam stops sending the score fields.
        assert_eq!(total, 4231);
        assert_eq!(summary.as_ref().map(|s| s.review_score), Some(8));
        // Pagination cursors keep their punctuation; only the request layer
        // percent-encodes them.
        assert_eq!(next_cursor.as_deref(), Some("AoJ4nK/gs6EDfMahjQc="));
    }

    #[test]
    fn empty_response_is_no_reviews_not_an_error() {
        let (reviews, total, next_cursor, summary) = parse_steam_reviews(r#"{"response":{}}"#).unwrap();

        assert!(reviews.is_empty());
        assert_eq!(total, 0);
        assert!(next_cursor.is_none());
        assert!(summary.is_none());
    }

    #[test]
    fn non_json_body_reports_a_parse_error() {
        // What the retired store endpoint answered: the store homepage.
        let err = parse_steam_reviews("<!DOCTYPE html><html><head><title>Welcome to Steam</title>")
            .unwrap_err();

        assert!(err.starts_with("Steam reviews parse error:"), "unexpected error: {err}");
    }

    #[test]
    fn input_json_maps_ui_filters_onto_steam_enums() {
        let opts = SteamReviewQuery {
            cursor: "AoJ4nK/gs6EDfMahjQc=".to_string(),
            language: Some("german".to_string()),
            filter_type: Some("funny".to_string()),
            review_type: Some("negative".to_string()),
            purchase_type: Some("other".to_string()),
            playtime_min_hours: Some(10),
            playtime_max_hours: Some(100),
            playtime_device: Some("deck".to_string()),
            use_helpful_system: true,
        };

        let input = build_reviews_input_json(&opts);

        assert_eq!(input["cursor"], "AoJ4nK/gs6EDfMahjQc=");
        assert_eq!(input["filter"], 3); // Funny
        assert_eq!(input["review_type"], 2); // Negative
        assert_eq!(input["purchase_type"], 2); // NonSteamPurchase
        assert_eq!(input["languages"], json!(["german"]));
        assert_eq!(input["day_range"], 0);
        assert_eq!(input["num_per_page"], 20);
        assert_eq!(input["playtime_min_hours"], 10);
        // The UI's 100-hour sentinel means "no maximum".
        assert_eq!(input["playtime_max_hours"], 0);
        assert_eq!(input["primarily_steam_deck"], true);
        assert_eq!(input["use_review_quality"], true);
        assert_eq!(input["filter_offtopic_activity"], false);
    }

    #[test]
    fn input_json_defaults_match_the_old_all_reviews_view() {
        let input = build_reviews_input_json(&SteamReviewQuery::default());

        assert_eq!(input["cursor"], "*");
        assert_eq!(input["filter"], 0); // Helpful
        assert_eq!(input["review_type"], 0); // All
        assert_eq!(input["purchase_type"], 1); // All, not Steam-only
        assert_eq!(input["languages"], json!(["all"]));
        assert_eq!(input["playtime_min_hours"], 0);
        assert_eq!(input["playtime_max_hours"], 0);
        assert_eq!(input["primarily_steam_deck"], false);
    }
}
