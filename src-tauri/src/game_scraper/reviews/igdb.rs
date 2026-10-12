use serde::Deserialize;

use super::*;
use super::super::igdb::{get_twitch_token, http_client, igdb_acquire};

/// Best-effort fetch of reviews from the IGDB `/v4/reviews` endpoint.
///
/// The public IGDB API has removed this endpoint (it returns 404). We still
/// call it because the request is cheap and may be re-enabled in the future.
pub(crate) async fn fetch_igdb_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    let escaped = game_name.replace('"', "\\\"");
    // First, find the game id by name. We can't fetch reviews without an id.
    let search_body = format!(
        r#"search "{}"; fields id; limit 1;"#,
        escaped
    );

    let _guard7 = igdb_acquire().await;
    let search_resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(search_body)
        .send()
        .await
        .map_err(|e| format!("IGDB search failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!("IGDB search returned {}", search_resp.status()));
    }

    let search_text = search_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB search response: {}", e))?;

    #[derive(Debug, Deserialize)]
    struct IgdbIdOnly {
        id: u64,
    }

    let id_hits: Vec<IgdbIdOnly> = serde_json::from_str(&search_text)
        .map_err(|e| format!("IGDB id parse error: {}", e))?;

    let Some(first) = id_hits.into_iter().next() else {
        return Ok(Vec::new());
    };

    // Now query the reviews endpoint for that id. The IGDB schema for reviews:
    //   id, game, user, title, content, rating, positive, negative, etc.
    let reviews_body = format!(
        r#"fields title, content, rating, user; where game = {}; limit 20;"#,
        first.id
    );

    let _guard8 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/reviews")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(reviews_body)
        .send()
        .await
        .map_err(|e| format!("IGDB reviews request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("IGDB reviews returned {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB reviews response: {}", e))?;

    #[derive(Debug, Deserialize)]
    struct IgdbReviewRaw {
        title: Option<String>,
        content: Option<String>,
        rating: Option<u32>,
        user: Option<u64>,
    }

    let raw: Vec<IgdbReviewRaw> = serde_json::from_str(&text)
        .map_err(|e| format!("IGDB reviews parse error: {}", e))?;

    let reviews = raw
        .into_iter()
        .map(|r| IgdbReview {
            title: r.title,
            content: r.content,
            rating: r.rating.map(|v| v as f64),
            username: r.user.map(|id| format!("User #{}", id)),
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created: None,
            ..Default::default()
        })
        .collect();

    Ok(reviews)
}
