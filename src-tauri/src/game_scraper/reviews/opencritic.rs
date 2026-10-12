use serde::Deserialize;

use super::*;

/// Resolve an OpenCritic game page URL.
///
/// OpenCritic's `/search?criteria=...` always returns HTTP 200, which would
/// incorrectly trip `resolve_game_url`'s success check and skip the DDG
/// fallback. So we pass a guaranteed-404 sentinel URL (`/game/0/{slug}`)
/// to make the DuckDuckGo fallback always run and locate the real game
/// page (if any). When a RapidAPI key is available, prefer
/// `fetch_opencritic_via_rapidapi` which gets scores directly without
/// needing a page URL.
pub(crate) async fn resolve_opencritic_url(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<String, String> {
    let slug = slugify_rust(game_name);
    let sentinel = format!("https://opencritic.com/game/0/{}", slug);
    resolve_game_url(client, &sentinel, "opencritic.com", game_name).await
}

// ── OpenCritic RapidAPI types (matching Playnite OpenCriticMetadata extension) ──

#[derive(Debug, Deserialize)]
pub(crate) struct OcSearchItem {
    id: u64,
    name: String,
    #[serde(default)]
    relation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OcGameDetail {
    #[allow(dead_code)]
    id: u64,
    #[allow(dead_code)]
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    description: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    has_lootboxes: Option<bool>,
    #[serde(default)]
    #[allow(dead_code)]
    is_major_release: bool,
    #[serde(default)]
    num_reviews: i32,
    #[serde(default)]
    #[allow(dead_code)]
    num_top_critic_reviews: i32,
    #[serde(default)]
    median_score: Option<f64>,
    #[serde(default)]
    top_critic_score: Option<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    percentile: Option<f64>,
    #[serde(default)]
    percent_recommended: Option<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OcUserRatings {
    #[serde(default)]
    median: Option<f64>,
    #[serde(default)]
    count: i32,
}

/// Search OpenCritic via RapidAPI and return the best-matching game ID.
pub(crate) async fn search_opencritic_via_rapidapi(
    client: &reqwest::Client,
    game_name: &str,
    api_key: &str,
) -> Result<(u64, String, String), String> {
    let query = game_name.replace(' ', "+");
    let search_url = format!(
        "https://opencritic-api.p.rapidapi.com/meta/search?criteria={}",
        query
    );

    let resp = client
        .get(&search_url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI search failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI search returned {}", resp.status()));
    }

    let items: Vec<OcSearchItem> = resp
        .json()
        .await
        .map_err(|e| format!("RapidAPI search parse error: {}", e))?;

    // Prefer relation == "game", fall back to first result
    let game = items
        .iter()
        .find(|item| item.relation.as_deref() == Some("game"))
        .or_else(|| items.first())
        .ok_or_else(|| format!("No results found for '{}'", game_name))?;

    Ok((game.id, game.name.clone(), game.relation.clone().unwrap_or_default()))
}

/// Fetch OpenCritic game detail via RapidAPI (same endpoint used by Playnite extension).
pub(crate) async fn fetch_opencritic_game_detail(
    client: &reqwest::Client,
    game_id: u64,
    api_key: &str,
) -> Result<OcGameDetail, String> {
    let url = format!("https://opencritic-api.p.rapidapi.com/game/{}", game_id);

    let resp = client
        .get(&url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI game/{} failed: {}", game_id, e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI game/{} returned {}", game_id, resp.status()));
    }

    resp.json()
        .await
        .map_err(|e| format!("RapidAPI game/{} parse error: {}", game_id, e))
}

/// Fetch OpenCritic user/community ratings via RapidAPI.
pub(crate) async fn fetch_opencritic_user_ratings(
    client: &reqwest::Client,
    game_id: u64,
    api_key: &str,
) -> Result<OcUserRatings, String> {
    let url = format!("https://opencritic-api.p.rapidapi.com/ratings/game/{}", game_id);

    let resp = client
        .get(&url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI ratings/game/{} failed: {}", game_id, e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI ratings/game/{} returned {}", game_id, resp.status()));
    }

    resp.json()
        .await
        .map_err(|e| format!("RapidAPI ratings/game/{} parse error: {}", game_id, e))
}

/// Fetch OpenCritic scores via RapidAPI and return them as aggregate IgdbReview entries.
/// This is the primary path when OPENCRITIC_RAPIDAPI_KEY is configured.
pub(crate) async fn fetch_opencritic_via_rapidapi(
    client: &reqwest::Client,
    game_name: &str,
    api_key: &str,
) -> Result<Vec<IgdbReview>, String> {
    let (game_id, _oc_name, _relation) =
        search_opencritic_via_rapidapi(client, game_name, api_key).await?;

    // Fetch game detail and user ratings in parallel (matching Playnite extension pattern)
    let (detail_res, ratings_res) = tokio::join!(
        fetch_opencritic_game_detail(client, game_id, api_key),
        fetch_opencritic_user_ratings(client, game_id, api_key),
    );

    let detail = detail_res?;
    let ratings = ratings_res.unwrap_or(OcUserRatings { median: None, count: 0 });
    let oc_name = &detail.name;

    let mut reviews = Vec::new();

    // Build critic score summary review
    let mut critic_parts: Vec<String> = Vec::new();
    if let Some(median) = detail.median_score {
        critic_parts.push(format!("Median Score: {:.0}/100", median.round()));
    }
    if let Some(top) = detail.top_critic_score {
        critic_parts.push(format!("Top Critics: {:.0}/100", top.round()));
    }
    if detail.num_reviews > 0 {
        critic_parts.push(format!("Based on {} critic reviews", detail.num_reviews));
    }
    if let Some(pct) = detail.percent_recommended {
        critic_parts.push(format!("Recommended by {:.0}% of critics", pct));
    }
    if !critic_parts.is_empty() {
        let score = detail.median_score.or(detail.top_critic_score);
        reviews.push(IgdbReview {
            title: Some(format!("OpenCritic Critics — {}", oc_name)),
            content: Some(critic_parts.join(". ") + "."),
            rating: score,
            username: Some("OpenCritic Critics".to_string()),
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created: None,
            ..Default::default()
        });
    }

    // Build community score summary review
    if ratings.count > 0 || ratings.median.is_some() {
        let mut community_parts: Vec<String> = Vec::new();
        if let Some(median) = ratings.median {
            community_parts.push(format!("Median Score: {:.1}/5", median));
        }
        if ratings.count > 0 {
            community_parts.push(format!("Based on {} player ratings", ratings.count));
        }
        if !community_parts.is_empty() {
            let score = ratings.median.map(|v| v * 20.0); // Normalize 0-5 to 0-100
            reviews.push(IgdbReview {
                title: Some(format!("OpenCritic Community — {}", oc_name)),
                content: Some(community_parts.join(". ") + "."),
                rating: score,
                username: Some("OpenCritic Community".to_string()),
                language: None,
                votes_up: Some(ratings.count as u32),
                votes_funny: None,
                timestamp_created: None,
                ..Default::default()
            });
        }
    }

    if reviews.is_empty() {
        return Err(format!("No scores available on OpenCritic for '{}'", game_name));
    }

    Ok(reviews)
}

pub(crate) async fn fetch_opencritic_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    // ── 1. RapidAPI (primary, if key is configured) ───────────────────
    let rapidapi_key = crate::config::get_opencritic_rapidapi_key();
    if !rapidapi_key.is_empty() {
        match fetch_opencritic_via_rapidapi(&client, game_name, &rapidapi_key).await {
            Ok(reviews) if !reviews.is_empty() => return Ok(reviews),
            Ok(_) => {} // empty reviews, fall through to HTML scraping
            Err(e) => eprintln!("OpenCritic RapidAPI failed: {} — falling back to HTML scraping", e),
        }
    }

    // ── 2. HTML scraping fallback ──────────────────────────────────────
    // The URL resolver returns an error verbatim (DDG fallback also failed).
    // Surface a hint about OPENCRITIC_RAPIDAPI_KEY so the toast in
    // ReviewsTab.tsx tells the user how to get reliable results.
    let detail_url = resolve_opencritic_url(&client, game_name)
        .await
        .map_err(|e| format!("{}{}", e, OPENCRITIC_RAPIDAPI_HINT_SUFFIX))?;

    let resp = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!(
            "OpenCritic detail request failed: {}{}",
            e,
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ))?;

    if !resp.status().is_success() {
        // Any non-2xx in this HTML-scraping block means we can't reach the
        // real OpenCritic page (Cloudflare 401/403/429/503, missing page,
        // redirected to a challenge). The RapidAPI path bypasses all of
        // those, so the hint is always relevant here.
        return Err(format!(
            "OpenCritic returned {}{}",
            resp.status(),
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!(
            "Failed to read OpenCritic response: {}{}",
            e,
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ))?;

    let doc = scraper::Html::parse_document(&html);

    // Try embedded JSON state first (Angular SSR)
    if let Some(reviews) = extract_opencritic_json_reviews(&doc) {
        if !reviews.is_empty() {
            return Ok(reviews);
        }
    }

    // Fallback: scrape <app-review-card> elements
    let card_sel = scraper::Selector::parse("app-review-card")
        .map_err(|e| e.to_string())?;

    let outlet_sel = scraper::Selector::parse("h4 > a[href^='/outlet/']")
        .map_err(|e| e.to_string())?;

    let author_sel = scraper::Selector::parse(".author > a[href^='/critic/']")
        .map_err(|e| e.to_string())?;

    let score_sel = scraper::Selector::parse(".score")
        .map_err(|e| e.to_string())?;

    let snippet_sel = scraper::Selector::parse("p.font-small.grey-dark-text")
        .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(".date, time")
        .map_err(|e| e.to_string())?;

    let mut reviews = Vec::new();

    for card in doc.select(&card_sel) {
        let outlet = card
            .select(&outlet_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string());

        let author = card
            .select(&author_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string());

        let username = match (author, outlet) {
            (Some(a), Some(o)) => Some(format!("{} (via {})", a, o)),
            (Some(a), None) => Some(a),
            (None, Some(o)) => Some(o),
            (None, None) => None,
        };

        let rating = card
            .select(&score_sel)
            .next()
            .and_then(|el| {
                let text = el.text().collect::<Vec<_>>().join("").trim().to_string();
                parse_opencritic_score(&text)
            });

        let content = card
            .select(&snippet_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        let timestamp_created = card
            .select(&date_sel)
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .and_then(|s| parse_date_to_timestamp(s))
            .or_else(|| {
                card.select(&date_sel).next().and_then(|el| {
                    let t = el.text().collect::<Vec<_>>().join("").trim().to_string();
                    parse_date_to_timestamp(&t)
                })
            });

        if content.is_none() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content,
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    Ok(reviews)
}

// ── OpenCritic Critic Reviews ─────────────────────────────────────────────────

pub(crate) fn extract_opencritic_json_reviews(doc: &scraper::Html) -> Option<Vec<IgdbReview>> {
    let script_sel = scraper::Selector::parse("script#serverApp-state[type='application/json']")
        .ok()?;

    let json_text = doc
        .select(&script_sel)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(""))?;

    // OpenCritic Angular SSR HTML-encodes JSON (e.g. &q; for double-quote).
    // Decode the five standard XML entities before serde parsing.
    let decoded_text = json_text
        .replace("&q;", "\"")
        .replace("&s;", "'")
        .replace("&a;", "&")
        .replace("&l;", "<")
        .replace("&g;", ">");

    // Try to parse and navigate the JSON tree
    let parsed: serde_json::Value = serde_json::from_str(&decoded_text).ok()?;

    // Navigate: Find any key matching "game/*/reviews" or "game/*/landing"
    let reviews_val = find_json_reviews(&parsed)?;
    let arr = reviews_val.as_array()?;

    let mut reviews = Vec::new();

    for item in arr {
        let author = item.get("Authors").and_then(|v| v.as_array()).and_then(|authors| {
            authors.first()?.get("name")?.as_str()
        });

        let outlet = item.get("Outlet").and_then(|v| v.get("name")).and_then(|v| v.as_str());

        let username = match (author, outlet) {
            (Some(a), Some(o)) => Some(format!("{} (via {})", a, o)),
            (Some(a), None) => Some(a.to_string()),
            (None, Some(o)) => Some(o.to_string()),
            (None, None) => None,
        };

        // `score` is OpenCritic's canonical per-review value, already
        // normalized to a 0-100 scale across outlet formats. `npScore` is
        // often 0 (non-numeric/star outlets) or 100 (perfect scores), so it
        // must never take precedence over the real score.
        let rating = item
            .get("score")
            .and_then(|v| v.as_f64())
            .or_else(|| item.get("npScore").and_then(|v| v.as_f64()));

        let content = item
            .get("snippet")
            .or_else(|| item.get("quote"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());

        let timestamp_created = item
            .get("publishedDate")
            .or_else(|| item.get("date"))
            .and_then(|v| v.as_str())
            .and_then(|s| parse_date_to_timestamp(s));

        if content.is_none() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content,
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    if reviews.is_empty() {
        None
    } else {
        Some(reviews)
    }
}

/// Walk the OpenCritic JSON state to find the reviews array.
pub(crate) fn find_json_reviews<'a>(value: &'a serde_json::Value) -> Option<&'a serde_json::Value> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                // Match both /reviews and /landing keys (both contain review data)
                if (key.starts_with("game/") || key.starts_with("q:game/")) && (key.contains("/reviews") || key.contains("/landing")) {
                    if let Some(arr) = val.as_array() {
                        if !arr.is_empty() {
                            return Some(val);
                        }
                    }
                }
            }
            // Recursively search
            for val in map.values() {
                if let Some(found) = find_json_reviews(val) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_json_reviews(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Parse an OpenCritic score string like "4/5", "85", or "Recommended".
pub(crate) fn parse_opencritic_score(text: &str) -> Option<f64> {
    let trimmed = text.trim().to_lowercase();

    // Keywords
    if trimmed.contains("essential") || trimmed.contains("masterpiece") {
        return Some(100.0);
    }
    if trimmed.contains("recommended") || trimmed.contains("great") {
        return Some(85.0);
    }
    if trimmed.contains("mixed") || trimmed.contains("fair") {
        return Some(60.0);
    }
    if trimmed.contains("skip") || trimmed.contains("poor") || trimmed.contains("weak") {
        return Some(30.0);
    }

    // "X/Y" format
    if let Some(slash_pos) = trimmed.find('/') {
        let num = trimmed[..slash_pos].trim().parse::<f64>().ok()?;
        let den = trimmed[slash_pos + 1..].trim().parse::<f64>().ok()?;
        if den > 0.0 {
            return Some((num / den) * 100.0);
        }
    }

    // Plain number
    trimmed.parse::<f64>().ok()
}
