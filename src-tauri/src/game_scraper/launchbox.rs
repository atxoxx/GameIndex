use serde::{Deserialize, Serialize};

use super::*;
use super::text_util::url_encode;
use super::title_match::{MIN_TITLE_SIMILARITY, title_similarity};

// ─── Source: LaunchBox Games Database ──────────────────────────────────────────

/// A single image entry from the LaunchBox Games Database detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBoxImageResult {
    /// Category such as "Box - Front", "Banner", "Fanart - Background", "Clear Logo"
    pub category: String,
    /// Region label if available (e.g., "World", "Europe", "North America")
    pub region: Option<String>,
    /// Resolution string (e.g., "1920x1080")
    pub resolution: String,
    /// Full-resolution image URL
    pub url: String,
}

/// Build a shared reqwest client for LaunchBox requests.
pub(crate) fn launchbox_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .ok()
}

/// Search the LaunchBox Games Database for a game and return metadata.
pub(crate) async fn search_launchbox(game_name: &str) -> Option<GameMetadataResult> {
    let client = launchbox_client()?;

    // Step 1: Search the LaunchBox Games Database
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_html = search_resp.text().await.ok()?;

    // Parse HTML synchronously and extract all data (scraper::Html is !Send)
    struct SearchHit {
        href: String,
        title: String,
        _platform: String,
        cover_url: Option<String>,
        description: Option<String>,
        release_date: Option<String>,
    }

    let (hits, detail_url_str) = {
        let document = scraper::Html::parse_document(&search_html);

        let card_selector = scraper::Selector::parse(".games-grid-card").ok()?;
        let link_selector = scraper::Selector::parse("a.list-item").ok()?;
        let title_selector = scraper::Selector::parse(".cardTitle h3").ok()?;
        let platform_selector = scraper::Selector::parse(".cardTitle p").ok()?;
        let img_selector = scraper::Selector::parse(".cardImgPart > img").ok()?;
        let desc_selector = scraper::Selector::parse(".cardContent > p").ok()?;
        let date_selector = scraper::Selector::parse(".releaseDate h5").ok()?;

        let mut hits: Vec<SearchHit> = Vec::new();

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .unwrap_or("")
                .to_string();

            if href.is_empty() {
                continue;
            }

            let title = card
                .select(&title_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let platform = card
                .select(&platform_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let cover_url = card
                .select(&img_selector)
                .next()
                .and_then(|el| el.value().attr("src"))
                .map(|s| s.to_string());

            let description = card
                .select(&desc_selector)
                .last()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            let release_date = card
                .select(&date_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            if !title.is_empty() {
                hits.push(SearchHit {
                    href,
                    title,
                    _platform: platform.clone(),
                    cover_url,
                    description,
                    release_date,
                });
            }
        }

        if hits.is_empty() {
            return None;
        }

        // Pick the hit whose normalized title is most similar to the query,
        // preferring a Windows platform as a tiebreaker. This stops a
        // loosely-related title (e.g. "The Wolf Among Us" for "Among Us")
        // from being selected just because it appears first.
        let best_idx = hits
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                let sa = title_similarity(game_name, &a.title);
                let sb = title_similarity(game_name, &b.title);
                sa.partial_cmp(&sb)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| {
                        a._platform
                            .eq_ignore_ascii_case("Windows")
                            .cmp(&b._platform.eq_ignore_ascii_case("Windows"))
                    })
            })
            .map(|(i, _)| i)
            .unwrap_or(0);

        let detail_url = if hits[best_idx].href.starts_with("http") {
            hits[best_idx].href.clone()
        } else {
            format!("https://gamesdb.launchbox-app.com{}", hits[best_idx].href)
        };

        (hits, detail_url)
        // document is dropped here — scraper::Html is no longer alive across .await
    };

    // Prefer the most title-similar hit (Windows as tiebreaker)
    let best_idx = hits
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| {
            let sa = title_similarity(game_name, &a.title);
            let sb = title_similarity(game_name, &b.title);
            sa.partial_cmp(&sb)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    a._platform
                        .eq_ignore_ascii_case("Windows")
                        .cmp(&b._platform.eq_ignore_ascii_case("Windows"))
                })
        })
        .map(|(i, _)| i)
        .unwrap_or(0);
    let best = &hits[best_idx];
    let cleaned_q = clean_game_name_for_search(game_name);
    if title_similarity(game_name, &best.title) < MIN_TITLE_SIMILARITY
        && title_similarity(&cleaned_q, &best.title) < MIN_TITLE_SIMILARITY
    {
        return None;
    }

    // Step 2: Fetch the detail page for richer metadata
    let (description, developer, publisher, genres, release_date, images) =
        fetch_launchbox_details(&client, &detail_url_str).await.unwrap_or_else(|| {
            // Fallback: use search result data
            (
                best.description.clone(),
                None,
                None,
                Vec::new(),
                best.release_date.clone(),
                GameImages {
                    icon: None,
                    cover: best.cover_url.clone(),
                    hero: None,
                    banner: None,
                    logo: None,
                },
            )
        });

    let is_vr = Some(crate::vr::detect_vr(&best.title, &genres, &[]));

    Some(GameMetadataResult {
        title: best.title.clone(),
        description,
        developer,
        publisher,
        // LaunchBox does not return IGDB collection IDs, so the
        // GameRelationsCard cannot fetch "Other in Collection"
        // members for LaunchBox-sourced metadata. Hardcode `None`.
        collection_id: None,
        // LaunchBox does not return the IGDB game id either; hardcode
        // `None` so the field round-trips as absent on non-IGDB rows.
        igdb_id: None,
        release_date,
        genres,
        images,
        source_url: detail_url_str,
        source_name: "LaunchBox".to_string(),
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

/// Fetch a LaunchBox game detail page and extract metadata + best images.
pub(crate) async fn fetch_launchbox_details(
    client: &reqwest::Client,
    detail_url: &str,
) -> Option<(
    Option<String>,       // description
    Option<String>,       // developer
    Option<String>,       // publisher
    Vec<String>,          // genres
    Option<String>,       // release_date
    GameImages,           // images
)> {
    let resp = client.get(detail_url).send().await.ok()?;
    let html = resp.text().await.ok()?;
    let doc = scraper::Html::parse_document(&html);

    // --- Extract description from the meta tag (most reliable for Nuxt SSR pages) ---
    let description = scraper::Selector::parse("meta[name='description']")
        .ok()
        .and_then(|sel| {
            doc.select(&sel)
                .next()
                .and_then(|el| el.value().attr("content"))
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    // --- Extract developer/publisher/genre from the detail page ---
    // The new Nuxt-based detail page uses <dt>/<dd> pairs
    let dt_selector = scraper::Selector::parse("dt").ok()?;
    let dd_selector = scraper::Selector::parse("dd").ok()?;
    let a_selector = scraper::Selector::parse("a").ok()?;
    let time_selector = scraper::Selector::parse("time").ok()?;

    let mut developer: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut genres: Vec<String> = Vec::new();
    let mut release_date: Option<String> = None;

    // Walk through all <dt> elements and match their text content
    let dts: Vec<_> = doc.select(&dt_selector).collect();
    let dds: Vec<_> = doc.select(&dd_selector).collect();

    for (dt, dd) in dts.iter().zip(dds.iter()) {
        let label = dt
            .text()
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_lowercase();

        if label.contains("developer") {
            let devs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !devs.is_empty() {
                developer = Some(devs.join("; "));
            }
        } else if label.contains("publisher") {
            let pubs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !pubs.is_empty() {
                publisher = Some(pubs.join("; "));
            }
        } else if label.contains("genre") {
            genres = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if label.contains("release") {
            release_date = dd
                .select(&time_selector)
                .next()
                .and_then(|t| t.value().attr("datetime"))
                .map(|s| s.trim().to_string())
                .or_else(|| {
                    Some(
                        dd.text()
                            .collect::<Vec<_>>()
                            .join("")
                            .trim()
                            .to_string(),
                    )
                })
                .filter(|s| !s.is_empty());
        }
    }

    // --- Extract images by category ---
    let all_images = extract_launchbox_images(&doc);

    // Map to our GameImages — pick the first image in each relevant category
    let find_image = |categories: &[&str]| -> Option<String> {
        for cat in categories {
            if let Some(img) = all_images.iter().find(|i| {
                i.category.to_lowercase().contains(&cat.to_lowercase())
            }) {
                return Some(img.url.clone());
            }
        }
        None
    };

    let images = GameImages {
        icon: None,
        cover: find_image(&["Box - Front", "Box Front"]),
        hero: find_image(&["Banner"]),
        banner: find_image(&["Fanart - Background", "Fanart", "Screenshot"]),
        logo: find_image(&["Clear Logo"]),
    };

    Some((description, developer, publisher, genres, release_date, images))
}

/// Extract all categorized images from a LaunchBox detail page document.
pub(crate) fn extract_launchbox_images(doc: &scraper::Html) -> Vec<LaunchBoxImageResult> {
    let mut results: Vec<LaunchBoxImageResult> = Vec::new();

    // The detail page groups images under <article> elements with <h3> category headings.
    // Each image is an <img> inside a container with an alt text containing metadata.
    // Alt format: "GAME_TITLE - Category (Region) - WIDTHxHEIGHT"
    let article_selector = match scraper::Selector::parse("article") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let h3_selector = match scraper::Selector::parse("h3") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let img_selector = match scraper::Selector::parse("img[loading='lazy']") {
        Ok(s) => s,
        Err(_) => return results,
    };

    for article in doc.select(&article_selector) {
        // Get the category name from the <h3> element
        let category = match article.select(&h3_selector).next() {
            Some(h3) => h3
                .text()
                .collect::<Vec<_>>()
                .join("")
                .trim()
                .to_string(),
            None => continue,
        };

        if category.is_empty() || category == "Overview" || category == "Media" {
            continue;
        }

        // Extract images within this article
        for img in article.select(&img_selector) {
            let src = match img.value().attr("src") {
                Some(s) if s.contains("launchbox") => s.to_string(),
                _ => continue,
            };

            let alt = img
                .value()
                .attr("alt")
                .unwrap_or("")
                .to_string();

            // Parse alt text: "DOOM - Box - Front (World) - 1440x2160"
            let (region, resolution) = parse_launchbox_image_alt(&alt);

            results.push(LaunchBoxImageResult {
                category: category.clone(),
                region,
                resolution,
                url: src,
            });
        }
    }

    results
}

/// Parse the alt text of a LaunchBox image to extract region and resolution.
/// Expected format: "TITLE - Category (Region) - WIDTHxHEIGHT"
pub(crate) fn parse_launchbox_image_alt(alt: &str) -> (Option<String>, String) {
    let mut region: Option<String> = None;
    let mut resolution = String::new();

    // Extract region from parentheses
    if let Some(start) = alt.rfind('(') {
        if let Some(end) = alt[start..].find(')') {
            let r = alt[start + 1..start + end].trim().to_string();
            if !r.is_empty() && r != "null" {
                region = Some(r);
            }
        }
    }

    // Extract resolution — last segment matching NNNxNNN pattern
    for part in alt.rsplit(" - ") {
        let trimmed = part.trim();
        if trimmed.contains('x') {
            let pieces: Vec<&str> = trimmed.split('x').collect();
            if pieces.len() == 2
                && pieces[0].trim().parse::<u32>().is_ok()
                && pieces[1].trim().parse::<u32>().is_ok()
            {
                resolution = trimmed.to_string();
                break;
            }
        }
    }

    (region, resolution)
}

/// Search LaunchBox for images of a given game name.
/// Returns all categorized images found on the detail page.
pub async fn search_launchbox_images(game_name: &str) -> Result<Vec<LaunchBoxImageResult>, String> {
    let client = launchbox_client().ok_or("Failed to create HTTP client")?;

    // Search LaunchBox
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("LaunchBox search failed: {}", e))?;
    let search_html = search_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    let href = {
        let document = scraper::Html::parse_document(&search_html);

        // Find the first game link
        let link_selector = scraper::Selector::parse("a.list-item")
            .map_err(|e| format!("Selector error: {}", e))?;

        // Collect links and try to find a Windows platform match
        let card_selector = scraper::Selector::parse(".games-grid-card")
            .map_err(|e| format!("Selector error: {}", e))?;
        let platform_selector = scraper::Selector::parse(".cardTitle p")
            .map_err(|e| format!("Selector error: {}", e))?;

        let mut best_href: Option<String> = None;
        let mut first_href: Option<String> = None;

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .map(|s| s.to_string());

            if let Some(ref h) = href {
                if first_href.is_none() {
                    first_href = Some(h.clone());
                }
                let platform = card
                    .select(&platform_selector)
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                    .unwrap_or_default();
                if platform.eq_ignore_ascii_case("Windows") {
                    best_href = Some(h.clone());
                    break;
                }
            }
        }

        best_href
            .or(first_href)
            .ok_or("No results found on LaunchBox")?
    };

    let detail_url = if href.starts_with("http") {
        href
    } else {
        format!("https://gamesdb.launchbox-app.com{}", href)
    };

    // Fetch the detail page
    let detail_resp = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch detail page: {}", e))?;
    let detail_html = detail_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read detail page: {}", e))?;
    let detail_doc = scraper::Html::parse_document(&detail_html);

    Ok(extract_launchbox_images(&detail_doc))
}
