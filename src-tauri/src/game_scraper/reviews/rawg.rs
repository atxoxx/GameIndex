use super::*;

// ── RAWG User Reviews ────────────────────────────────────────────────────────

pub(crate) async fn fetch_rawg_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    let slug = slugify_rust(game_name);
    let direct_url = format!("https://rawg.io/games/{}/reviews", slug);

    let url = resolve_game_url(
        &client,
        &direct_url,
        "rawg.io",
        game_name,
    )
    .await?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("RAWG request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("RAWG returned {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read RAWG response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    let card_sel = scraper::Selector::parse(
        ".review-card.review-card_common, .review-card.review-card_full",
    )
    .map_err(|e| e.to_string())?;

    let username_sel = scraper::Selector::parse(
        ".review-card__user-link, .review-card__user a",
    )
    .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(
        ".review-card__date, .review-card__info time",
    )
    .map_err(|e| e.to_string())?;

    let rating_sel = scraper::Selector::parse(
        ".rating__text, .review-card__rating, .review-card__rating-text",
    )
    .map_err(|e| e.to_string())?;

    let body_sel = scraper::Selector::parse(
        ".review-card__text, .truncate-block__wrapper div, .review-card__content",
    )
    .map_err(|e| e.to_string())?;

    let mut reviews = Vec::new();

    for card in doc.select(&card_sel) {
        let username = card
            .select(&username_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .filter(|s| !s.is_empty());

        let rating = card
            .select(&rating_sel)
            .next()
            .and_then(|el| {
                let text = el
                    .text()
                    .collect::<Vec<_>>()
                    .join("")
                    .trim()
                    .to_lowercase();
                parse_rawg_rating(&text)
            });

        let content = card
            .select(&body_sel)
            .map(|el| el.text().collect::<Vec<_>>().join(" "))
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();

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

        if content.is_empty() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content: if content.is_empty() { None } else { Some(content) },
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

/// Map RAWG rating text to a normalized 0-100 score.
pub(crate) fn parse_rawg_rating(text: &str) -> Option<f64> {
    let t = text.trim().to_lowercase();
    match t {
        s if s.contains("exceptional") || s.contains("masterpiece") => Some(95.0),
        s if s.contains("recommended") || s.contains("great") => Some(80.0),
        s if s.contains("meh") || s.contains("mixed") || s.contains("okay") => Some(50.0),
        s if s.contains("skip") || s.contains("poor") || s.contains("bad") => Some(25.0),
        _ => {
            // Try parsing as a numeric score
            t.parse::<f64>().ok()
        }
    }
}
