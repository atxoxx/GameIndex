use serde::Serialize;

use super::*;

// ── Metacritic User Reviews ──────────────────────────────────────────────────

pub(crate) async fn fetch_metacritic_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    let slug = slugify_rust(game_name);
    let direct_url = format!("https://www.metacritic.com/game/{}/user-reviews", slug);

    let url = resolve_game_url(&client, &direct_url, "metacritic.com", game_name).await?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Metacritic request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Metacritic returned {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Metacritic response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    // Primary: Fandom redesign review cards. Fallback: old .review.user_review.
    // Using CSS comma selector so both are tried; scraper::Selector::parse
    // never fails for valid CSS, so .or_else chains are useless for fallbacks.
    let review_sel = scraper::Selector::parse(
        "[data-testid='review-card'], .c-reviews-container--multi-column > div, .review.user_review",
    )
    .map_err(|e| e.to_string())?;

    let username_sel = scraper::Selector::parse("a[href^='/user/']")
        .map_err(|e| e.to_string())?;

    let score_sel = scraper::Selector::parse(
        "[data-testid='review-card-score'] span, .c-siteReviewScore span",
    )
    .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(
        "[data-testid='review-card-date'], time, .date",
    )
    .map_err(|e| e.to_string())?;

    let body_sel = scraper::Selector::parse(
        "[data-testid='review-quote-text'], .review_body span, .c-siteReview_quote span",
    )
    .map_err(|e| e.to_string())?;

    let spoiler_content_sel = scraper::Selector::parse(
        ".bl_spoiler, [data-testid='review-spoiler-text'], .c-siteReview_spoilerText, .inline_expand",
    ).ok();

    let spoiler_warning_sel = scraper::Selector::parse(
        ".spoiler_warning, .c-siteReview_spoiler, .inline_collapsed",
    ).ok();

    let mut reviews = Vec::new();

    for card in doc.select(&review_sel) {
        let username = card
            .select(&username_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .filter(|s| !s.is_empty());

        let rating = card
            .select(&score_sel)
            .next()
            .and_then(|el| {
                el.text()
                    .collect::<Vec<_>>()
                    .join("")
                    .trim()
                    .parse::<f64>()
                    .ok()
            })
            .map(|v| v * 10.0); // Metacritic scores are 0-10, normalize to 0-100

        let spoiler_text = spoiler_content_sel.as_ref().and_then(|sel| {
            let t = card
                .select(sel)
                .map(|el| el.text().collect::<Vec<_>>().join(" "))
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });

        let mut body = if let Some(st) = spoiler_text {
            format!("[spoiler]{}[/spoiler]", st)
        } else {
            card.select(&body_sel)
                .map(|el| el.text().collect::<Vec<_>>().join(" "))
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string()
        };

        if let Some(w_sel) = &spoiler_warning_sel {
            for w in card.select(w_sel) {
                let w_text = w.text().collect::<Vec<_>>().join(" ").trim().to_string();
                if !w_text.is_empty() && body.contains(&w_text) {
                    body = body.replace(&w_text, "").trim().to_string();
                }
            }
        }

        if body.contains("This review contains spoilers, click expand to view.") {
            body = body
                .replace("This review contains spoilers, click expand to view.", "")
                .trim()
                .to_string();
            if !body.is_empty() && !body.starts_with("[spoiler]") {
                body = format!("[spoiler]{}[/spoiler]", body);
            }
        }

        let date_str = card
            .select(&date_sel)
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .map(|s| s.to_string())
            .or_else(|| {
                card.select(&date_sel).next().map(|el| {
                    el.text().collect::<Vec<_>>().join("").trim().to_string()
                })
            });

        let timestamp_created = date_str
            .as_ref()
            .and_then(|s| parse_date_to_timestamp(s));

        if body.is_empty() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content: if body.is_empty() { None } else { Some(body) },
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

// ── Metacritic Score Summary ─────────────────────────────────────────────────

/// Aggregate Metacritic scores scraped from a game's product page.
///
/// The hero renders two score widgets: the critic Metascore (0-100) and the
/// user score (0-10). We surface both, their sentiment labels and review
/// tallies, plus the critic review distribution, so the game page's Ratings
/// card and its details modal can be served by a single request.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetacriticScore {
    pub url: String,
    pub metascore: Option<i32>,
    pub metascore_sentiment: Option<String>,
    pub critic_review_count: Option<u32>,
    pub user_score: Option<f64>,
    pub user_score_sentiment: Option<String>,
    pub user_rating_count: Option<u32>,
    pub positive_count: Option<u32>,
    pub neutral_count: Option<u32>,
    pub negative_count: Option<u32>,
    pub user_positive_count: Option<u32>,
    pub user_neutral_count: Option<u32>,
    pub user_negative_count: Option<u32>,
}

/// Pull the first run of digits out of a label like
/// "Based on 1,666 User Ratings" → 1666. Thousands separators (comma,
/// dot, space, non-breaking space) inside a number are ignored.
pub(crate) fn first_number(value: &str) -> Option<u32> {
    let mut digits = String::new();
    let mut in_number = false;
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            in_number = true;
        } else if in_number {
            if matches!(ch, ',' | '.' | ' ' | '\u{00a0}' | '\u{202f}') {
                continue;
            }
            break;
        }
    }
    digits.parse::<u32>().ok()
}

/// Read the review count from one distribution segment (e.g.
/// "1,427 positive reviews (86%)" → 1427). Missing segments (Metacritic
/// omits a zero-width bar) yield `None`.
pub(crate) fn bar_count(product: &scraper::ElementRef<'_>, sel: &scraper::Selector) -> Option<u32> {
    product
        .select(sel)
        .next()
        .and_then(|el| el.value().attr("aria-label"))
        .and_then(first_number)
}

/// Fetch the Metacritic score summary for a game by scraping its page.
///
/// Returns `Ok` with empty score fields when the page loads but exposes no
/// scores yet (e.g. an unreleased title), so callers can fall back to their
/// own rating without treating an incomplete page as an error.
pub async fn fetch_metacritic_score(game_name: &str) -> Result<MetacriticScore, String> {
    let client = external_reviews_client().ok_or("Failed to create HTTP client")?;

    let slug = slugify_rust(game_name);
    let direct_url = format!("https://www.metacritic.com/game/{}/", slug);
    let url = resolve_game_url(&client, &direct_url, "metacritic.com", game_name).await?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Metacritic request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Metacritic returned {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Metacritic response: {}", e))?;

    parse_metacritic_scores(&html, &url)
}

/// Parse Metacritic score widgets out of a game page's HTML.
///
/// Kept separate from the network fetch so the bucket logic — which is easy
/// to get wrong, since Metacritic omits zero-width distribution segments —
/// is unit-testable.
pub(crate) fn parse_metacritic_scores(html: &str, url: &str) -> Result<MetacriticScore, String> {
    let doc = scraper::Html::parse_document(html);

    let wrapper_sel = scraper::Selector::parse("[data-testid='global-score-wrapper']")
        .map_err(|e| e.to_string())?;
    let header_sel = scraper::Selector::parse("[data-testid='global-score-header']")
        .map_err(|e| e.to_string())?;
    let value_sel = scraper::Selector::parse("[data-testid='global-score-value']")
        .map_err(|e| e.to_string())?;
    let sentiment_sel = scraper::Selector::parse("[data-testid='global-score-sentiment']")
        .map_err(|e| e.to_string())?;
    let count_sel = scraper::Selector::parse("[data-testid='global-score-review-count']")
        .map_err(|e| e.to_string())?;
    let positive_sel = scraper::Selector::parse("[data-testid='global-score-graph-bar-positive']")
        .map_err(|e| e.to_string())?;
    let neutral_sel = scraper::Selector::parse("[data-testid='global-score-graph-bar-neutral']")
        .map_err(|e| e.to_string())?;
    let negative_sel = scraper::Selector::parse("[data-testid='global-score-graph-bar-negative']")
        .map_err(|e| e.to_string())?;

    let mut summary = MetacriticScore {
        url: url.to_string(),
        ..Default::default()
    };

    // The page renders each widget twice (hero + lower section); keep the
    // first occurrence of each kind and ignore the duplicates.
    for wrapper in doc.select(&wrapper_sel) {
        let header = wrapper
            .select(&header_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_lowercase())
            .unwrap_or_default();
        let is_user = header.contains("user");

        if (is_user && summary.user_score.is_some()) || (!is_user && summary.metascore.is_some()) {
            continue;
        }

        let value = wrapper
            .select(&value_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string());
        let sentiment = wrapper
            .select(&sentiment_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty());
        let count = wrapper
            .select(&count_sel)
            .next()
            .map(|el| el.text().collect::<String>())
            .and_then(|s| first_number(&s));

        // Each distribution graph is a sibling of the wrapper inside the same
        // score card. Read its segments by sentiment — a zero-width segment is
        // omitted from the DOM, so positional parsing would misalign the
        // positive/neutral/negative buckets.
        let scope = wrapper.parent().and_then(scraper::ElementRef::wrap);
        let scope = scope.as_ref().unwrap_or(&wrapper);
        let positive = bar_count(scope, &positive_sel);
        let neutral = bar_count(scope, &neutral_sel);
        let negative = bar_count(scope, &negative_sel);

        if is_user {
            summary.user_score = value.as_deref().and_then(|v| v.parse::<f64>().ok());
            summary.user_score_sentiment = sentiment;
            summary.user_rating_count = count;
            summary.user_positive_count = positive;
            summary.user_neutral_count = neutral;
            summary.user_negative_count = negative;
        } else {
            summary.metascore = value.as_deref().and_then(|v| v.parse::<i32>().ok());
            summary.metascore_sentiment = sentiment;
            summary.critic_review_count = count;
            summary.positive_count = positive;
            summary.neutral_count = neutral;
            summary.negative_count = negative;
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod metacritic_score_tests {
    use super::*;

    #[test]
    fn first_number_ignores_thousand_separators() {
        assert_eq!(first_number("Based on 1,666 User Ratings"), Some(1666));
        assert_eq!(first_number("Based on 13,805 User Ratings"), Some(13805));
        assert_eq!(first_number("24 positive reviews (92%)"), Some(24));
        assert_eq!(first_number("no digits here"), None);
    }

    /// Black Mesa-style fixture: the critic graph omits its zero-width
    /// negative segment, so positional parsing would shift the user buckets.
    const BLACK_MESA_HTML: &str = r#"
        <div data-testid="product-score">
          <div data-testid="global-score-wrapper">
            <div data-testid="global-score-header">Metascore</div>
            <span data-testid="global-score-value">84</span>
            <div data-testid="global-score-sentiment">Generally Favorable</div>
            <div data-testid="global-score-review-count">
              <a>Based on 26 Critic Reviews</a>
            </div>
          </div>
          <div data-testid="global-score-graph">
            <div data-testid="global-score-graph-bar-positive" aria-label="24 positive reviews (92%)"></div>
            <div data-testid="global-score-graph-bar-neutral" aria-label="2 neutral reviews (8%)"></div>
          </div>
        </div>
        <div data-testid="product-score">
          <div data-testid="global-score-wrapper">
            <div data-testid="global-score-header">User score</div>
            <span data-testid="global-score-value">8.7</span>
            <div data-testid="global-score-sentiment">Generally Favorable</div>
            <div data-testid="global-score-review-count">
              <a>Based on 1,666 User Ratings</a>
            </div>
          </div>
          <div data-testid="global-score-graph">
            <div data-testid="global-score-graph-bar-positive" aria-label="1,427 positive reviews (86%)"></div>
            <div data-testid="global-score-graph-bar-neutral" aria-label="179 neutral reviews (11%)"></div>
            <div data-testid="global-score-graph-bar-negative" aria-label="60 negative reviews (4%)"></div>
          </div>
        </div>
        <div data-testid="product-score">
          <div data-testid="global-score-wrapper">
            <div data-testid="global-score-header">Metascore</div>
            <span data-testid="global-score-value">99</span>
          </div>
          <div data-testid="global-score-graph">
            <div data-testid="global-score-graph-bar-positive" aria-label="999 positive reviews (99%)"></div>
          </div>
        </div>
    "#;

    #[test]
    fn parses_and_aligns_distribution_buckets() {
        let summary =
            parse_metacritic_scores(BLACK_MESA_HTML, "https://www.metacritic.com/game/black-mesa/")
                .expect("parse should succeed");

        assert_eq!(summary.url, "https://www.metacritic.com/game/black-mesa/");
        assert_eq!(summary.metascore, Some(84));
        assert_eq!(summary.metascore_sentiment.as_deref(), Some("Generally Favorable"));
        assert_eq!(summary.critic_review_count, Some(26));
        assert_eq!(summary.positive_count, Some(24));
        assert_eq!(summary.neutral_count, Some(2));
        assert_eq!(summary.negative_count, None);

        assert_eq!(summary.user_score, Some(8.7));
        assert_eq!(summary.user_rating_count, Some(1666));
        assert_eq!(summary.user_positive_count, Some(1427));
        assert_eq!(summary.user_neutral_count, Some(179));
        assert_eq!(summary.user_negative_count, Some(60));

        // The duplicate (lower) Metascore widget must not overwrite the hero.
        assert_eq!(summary.metascore, Some(84));
    }

    #[test]
    fn missing_widgets_yield_empty_summary() {
        let summary =
            parse_metacritic_scores("<html><body>no scores</body></html>", "https://x/")
                .expect("parse should succeed");
        assert_eq!(summary.metascore, None);
        assert_eq!(summary.user_score, None);
        assert_eq!(summary.critic_review_count, None);
    }
}
