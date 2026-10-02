//! MapGenie interactive-map lookup.
//!
//! MapGenie (mapgenie.io) hosts community interactive maps for a few
//! hundred games. Rather than hardcoding a list, we match a game by its
//! normalized title against MapGenie's public catalog and hand the
//! frontend a ready-to-embed map URL. When nothing matches we return
//! `None` so the game pages can hide the Map tab entirely.
//!
//! The catalog request must carry a browser `User-Agent`: MapGenie's
//! edge (Cloudflare) rejects generic clients with a 403. The parsed
//! catalog is cached in memory for a day because it is ~1.5 MB.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const CATALOG_URL: &str = "https://mapgenie.io/api/v1/games";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// One selectable map belonging to a MapGenie game.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapgenieMap {
    pub title: String,
    pub slug: String,
    pub url: String,
}

/// A matched MapGenie game plus the embeddable map URLs it exposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapgenieGame {
    pub slug: String,
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    pub maps: Vec<MapgenieMap>,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogGame {
    title: String,
    slug: String,
    // Present but `null` for some entries, so a plain `#[serde(default)]`
    // Vec is not enough — the whole catalog would fail to parse.
    #[serde(default)]
    search_titles: Option<Vec<String>>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    maps: Option<Vec<CatalogMap>>,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogMap {
    title: String,
    slug: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_true")]
    available: bool,
}

fn default_true() -> bool {
    true
}

struct CachedCatalog {
    fetched_at: Instant,
    games: Arc<Vec<CatalogGame>>,
}

static CATALOG: OnceLock<Mutex<Option<CachedCatalog>>> = OnceLock::new();

/// Fold a title down to its comparable core: lowercase, letters and
/// digits only. This neutralizes punctuation, spacing, trademark glyphs
/// and style differences (`"The Witcher 3: Wild Hunt"` →
/// `"thewitcher3wildhunt"`), which is what MapGenie's own search titles
/// already look like.
fn normalize(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn build_game(catalog: &CatalogGame) -> MapgenieGame {
    let empty_maps: &[CatalogMap] = &[];
    let mut maps: Vec<MapgenieMap> = catalog
        .maps
        .as_deref()
        .unwrap_or(empty_maps)
        .iter()
        .filter(|m| m.enabled && m.available)
        .map(|m| MapgenieMap {
            title: if m.title.trim().is_empty() {
                catalog.title.clone()
            } else {
                m.title.clone()
            },
            slug: m.slug.clone(),
            url: format!("https://mapgenie.io/{}/maps/{}", catalog.slug, m.slug),
        })
        .collect();

    if maps.is_empty() {
        maps.push(MapgenieMap {
            title: catalog.title.clone(),
            slug: catalog.slug.clone(),
            url: format!("https://mapgenie.io/{}", catalog.slug),
        });
    }

    let image = catalog
        .image
        .as_ref()
        .filter(|i| !i.trim().is_empty())
        .cloned();

    MapgenieGame {
        slug: catalog.slug.clone(),
        title: catalog.title.clone(),
        url: maps[0].url.clone(),
        image,
        maps,
    }
}

/// Resolve a game name against the catalog. Exact matches on the
/// canonical title win, then exact matches on any alternative search
/// title. Anything looser is treated as "not found" so we never send a
/// user to the wrong map.
fn match_game(games: &[CatalogGame], normalized_query: &str) -> Option<MapgenieGame> {
    if normalized_query.is_empty() {
        return None;
    }

    for game in games {
        if normalize(&game.title) == normalized_query {
            return Some(build_game(game));
        }
    }

    for game in games {
        let search = game.search_titles.as_deref().unwrap_or(&[]);
        if search.iter().any(|t| normalize(t) == normalized_query) {
            return Some(build_game(game));
        }
    }

    None
}

async fn load_catalog(client: &reqwest::Client) -> Result<Arc<Vec<CatalogGame>>, String> {
    let cache = CATALOG.get_or_init(|| Mutex::new(None));

    {
        let guard = cache.lock().await;
        if let Some(entry) = guard.as_ref() {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Ok(entry.games.clone());
            }
        }
    }

    let response = client
        .get(CATALOG_URL)
        .header("Accept", "application/json")
        .header("Referer", "https://mapgenie.io/")
        .send()
        .await
        .map_err(|e| format!("MapGenie request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("MapGenie returned HTTP {}", response.status()));
    }

    let games: Vec<CatalogGame> = response
        .json()
        .await
        .map_err(|e| format!("MapGenie catalog parse failed: {e}"))?;

    let games = Arc::new(games);
    *cache.lock().await = Some(CachedCatalog {
        fetched_at: Instant::now(),
        games: games.clone(),
    });
    Ok(games)
}

/// Look up a game's MapGenie maps. Returns `None` when the catalog has
/// no confident match, which the caller renders as "no Map tab".
#[tauri::command]
pub async fn fetch_mapgenie_map(game_name: String) -> Result<Option<MapgenieGame>, String> {
    let query = normalize(&game_name);
    if query.is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("MapGenie client build failed: {e}"))?;

    let games = load_catalog(&client).await?;
    Ok(match_game(&games, &query))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(title: &str, slug: &str, search_titles: &[&str]) -> CatalogGame {
        CatalogGame {
            title: title.to_string(),
            slug: slug.to_string(),
            search_titles: Some(search_titles.iter().map(|s| s.to_string()).collect()),
            image: Some(format!("https://media.mapgenie.io/{slug}.jpg")),
            maps: Some(vec![
                CatalogMap {
                    title: title.to_string(),
                    slug: slug.to_string(),
                    enabled: true,
                    available: true,
                },
                CatalogMap {
                    title: "Coming soon".to_string(),
                    slug: "wip".to_string(),
                    enabled: true,
                    available: false,
                },
            ]),
        }
    }

    #[test]
    fn normalize_ignores_case_punctuation_and_spacing() {
        assert_eq!(normalize("The Witcher 3: Wild Hunt™"), "thewitcher3wildhunt");
        assert_eq!(normalize("ELDEN RING"), "eldenring");
        assert_eq!(normalize("  "), "");
    }

    #[test]
    fn matches_canonical_title_and_skips_unavailable_maps() {
        let games = vec![game("Elden Ring", "elden-ring", &[])];
        let found = match_game(&games, &normalize("ELDEN RING")).expect("should match");
        assert_eq!(found.slug, "elden-ring");
        assert_eq!(found.url, "https://mapgenie.io/elden-ring/maps/elden-ring");
        assert_eq!(found.maps.len(), 1);
    }

    #[test]
    fn matches_alternative_search_title() {
        let games = vec![game(
            "The Witcher 3",
            "witcher-3",
            &["wild hunt", "the witcher 3 wild hunt"],
        )];
        let found = match_game(&games, &normalize("The Witcher 3: Wild Hunt")).expect("should match");
        assert_eq!(found.slug, "witcher-3");
    }

    #[test]
    fn returns_none_when_nothing_matches() {
        let games = vec![game("Elden Ring", "elden-ring", &[])];
        assert!(match_game(&games, &normalize("Definitely Not A Real Game")).is_none());
        assert!(match_game(&games, "").is_none());
    }

    /// Live catalog entries can carry `"search_titles": null`; a plain
    /// `#[serde(default)]` Vec rejects that and would break every lookup.
    #[test]
    fn tolerates_null_search_titles_and_maps() {
        let json = r#"[{"title":"Days Gone","slug":"days-gone",
            "search_titles":null,"image":null,"maps":null}]"#;
        let games: Vec<CatalogGame> =
            serde_json::from_str(json).expect("null fields should parse");
        assert_eq!(games.len(), 1);

        let found = match_game(&games, &normalize("Days Gone")).expect("should match");
        assert_eq!(found.url, "https://mapgenie.io/days-gone");
        assert_eq!(found.maps.len(), 1);
    }
}
