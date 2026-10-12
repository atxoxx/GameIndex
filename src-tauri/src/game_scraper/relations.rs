use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::*;
use super::igdb::{
    format_unix_timestamp, get_twitch_token, http_client, igdb_acquire, igdb_games_post,
    normalize_igdb_cover_url, IgdbCollection, IgdbCover,
};
use super::steam_about::prune_metadata_cache;
use super::types::IgdbGameSummary;

// ─── Collection Lookup (Game Relations card) ───────────────────────────────
//
// Fetch every game that belongs to a given IGDB collection.
//
// The frontend Game Relations card uses this to populate the
// "Other in Collection" group on the Store game detail page.
// We deliberately use IGDB's `where collections = {id}` filter
// on `/v4/games` directly rather than calling
// `/v4/collections/{id}` first to get the member IDs — the
// single-call approach is both faster (1 round-trip vs 2) and
// lets us request the full `StoreGameSummary` field set in one
// pass.
//
// Returns results sorted by `first_release_date` ascending so the
// user sees the series in chronological order, with the current
// game visible in context (it's not excluded — the frontend
// de-duplicates if needed).
pub async fn get_collection_games(
    collection_id: u64,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    // Field list mirrors the one used by `fetch_store_games` so
    // the returned `StoreGameSummary` shape is identical to
    // what the Store grid expects. The `limit` is clamped to 50
    // (IGDB's per-request max) to avoid silent truncation.
    let body = format!(
        r#"fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url;
where collections = ({});
sort first_release_date asc;
limit {};
offset 0;"#,
        collection_id,
        limit.min(50),
    );

    let _guard = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB collection games request failed: {}", e))?;

    if !resp.status().is_success() {
        // Capture the status BEFORE consuming the body via
        // `resp.text()` — `text` takes `self` by value and
        // moves `resp`, so a subsequent `resp.status()` call
        // would be a borrow-of-moved-value error.
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB collection games failed with status {}: {}",
            status,
            err_text
        ));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    // Reuse the same `IgdbGameSummary` parser + `StoreGameSummary`
    // mapper as `fetch_store_games` so the returned objects are
    // bit-for-bit identical (same field set, same cover-URL
    // size, same website dedup). The mapping logic is duplicated
    // rather than extracted because Rust's `fn` returns own
    // their values and the mapper is short enough that the
    // duplication is cheaper than the trait/generic overhead.
    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB collection games parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let logo_url = g.artworks.and_then(|list| {
                list.into_iter()
                    .filter(|a| a.url.as_ref().map(|u| u.contains("/t_logo")).unwrap_or(false))
                    .find_map(|a| a.url).map(|url| {
                        if url.starts_with("//") {
                            format!("https:{}", url)
                        } else {
                            url
                        }
                    })
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            let websites = g.websites.and_then(|list| {
                let mut unique = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique.push(url);
                        }
                    }
                }
                if unique.is_empty() { None } else { Some(unique) }
            });

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                logo_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
                follows: g.follows.unwrap_or(0),
                websites,
            }
        })
        .collect();

    Ok(summaries)
}

// ─── Game Relations (IGDB relation graph) ───────────────────────────────────

/// One external related game. Mirrors the TS `RelatedGameEntry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelatedGameEntry {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub release_year: Option<i64>,
    #[serde(default)]
    pub rating: Option<f64>,
}

/// A named IGDB group (franchise or collection) with its member games.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelationGameGroup {
    pub id: u64,
    pub name: String,
    pub games: Vec<RelatedGameEntry>,
}

/// The full external relation graph for one seed game.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameRelationsResult {
    #[serde(default)]
    pub franchise_groups: Vec<RelationGameGroup>,
    #[serde(default)]
    pub collection_groups: Vec<RelationGameGroup>,
    #[serde(default)]
    pub similar_games: Vec<RelatedGameEntry>,
    #[serde(default)]
    pub developer_games: Vec<RelatedGameEntry>,
    #[serde(default)]
    pub publisher_games: Vec<RelatedGameEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbRelationSeed {
    id: u64,
    #[serde(default)]
    franchises: Option<Vec<IgdbCollection>>,
    #[serde(default)]
    collections: Option<Vec<IgdbCollection>>,
    #[serde(default)]
    involved_companies: Option<Vec<IgdbRelationCompany>>,
    #[serde(default)]
    similar_games: Option<Vec<IgdbRelationGame>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbRelationCompany {
    #[serde(default)]
    company: Option<IgdbCompanyRef>,
    #[serde(default)]
    developer: bool,
    #[serde(default)]
    publisher: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbCompanyRef {
    id: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IgdbRelationGame {
    id: u64,
    name: String,
    #[serde(default)]
    cover: Option<IgdbCover>,
    #[serde(default)]
    first_release_date: Option<i64>,
    #[serde(default)]
    rating: Option<f64>,
    #[serde(default)]
    involved_companies: Option<Vec<IgdbRelationCompany>>,
}

pub(crate) fn unix_timestamp_year(ts: i64) -> Option<i64> {
    if ts < 0 {
        return None;
    }
    format_unix_timestamp(ts)
        .get(..4)
        .and_then(|year| year.parse::<i64>().ok())
}

pub(crate) fn related_entry_from_raw(raw: &IgdbRelationGame) -> RelatedGameEntry {
    RelatedGameEntry {
        id: raw.id,
        name: raw.name.clone(),
        cover_url: raw
            .cover
            .as_ref()
            .and_then(|c| c.url.clone())
            .map(normalize_igdb_cover_url),
        release_year: raw.first_release_date.and_then(unix_timestamp_year),
        rating: raw.rating,
    }
}

pub(crate) fn split_company_ids(companies: &[IgdbRelationCompany]) -> (Vec<u64>, Vec<u64>) {
    let mut developer_ids = Vec::new();
    let mut publisher_ids = Vec::new();
    for company in companies {
        let Some(company_ref) = company.company.as_ref() else {
            continue;
        };
        if company.developer {
            developer_ids.push(company_ref.id);
        }
        if company.publisher {
            publisher_ids.push(company_ref.id);
        }
    }
    developer_ids.sort_unstable();
    developer_ids.dedup();
    publisher_ids.sort_unstable();
    publisher_ids.dedup();
    (developer_ids, publisher_ids)
}

pub(crate) fn partition_company_games(
    raw: &[IgdbRelationGame],
    seed_id: u64,
    developer_ids: &[u64],
    publisher_ids: &[u64],
) -> (Vec<RelatedGameEntry>, Vec<RelatedGameEntry>) {
    let developer_set: HashSet<u64> = developer_ids.iter().copied().collect();
    let publisher_set: HashSet<u64> = publisher_ids.iter().copied().collect();
    let mut developer_games = Vec::new();
    let mut publisher_games = Vec::new();

    for game in raw.iter().filter(|g| g.id != seed_id) {
        let involved = game.involved_companies.as_deref().unwrap_or(&[]);
        let is_developer = involved.iter().any(|c| {
            c.developer
                && c.company
                    .as_ref()
                    .map(|co| developer_set.contains(&co.id))
                    .unwrap_or(false)
        });
        let is_publisher = involved.iter().any(|c| {
            c.publisher
                && c.company
                    .as_ref()
                    .map(|co| publisher_set.contains(&co.id))
                    .unwrap_or(false)
        });
        if is_developer && developer_games.len() < 12 {
            developer_games.push(related_entry_from_raw(game));
        }
        if is_publisher && publisher_games.len() < 12 {
            publisher_games.push(related_entry_from_raw(game));
        }
    }

    (developer_games, publisher_games)
}

pub(crate) async fn fetch_relation_group(
    token: &str,
    field: &str,
    group: &IgdbCollection,
    seed_id: u64,
) -> Result<RelationGameGroup, String> {
    let body = format!(
        "fields name, cover.url, first_release_date, rating; \
         where {} = ({}); sort first_release_date asc; limit 24;",
        field, group.id
    );
    let text = igdb_games_post(token, &body).await?;
    let raw: Vec<IgdbRelationGame> = serde_json::from_str(&text)
        .map_err(|e| format!("IGDB {} parse error: {}", field, e))?;
    let games = raw
        .iter()
        .filter(|g| g.id != seed_id)
        .map(related_entry_from_raw)
        .collect();
    Ok(RelationGameGroup {
        id: group.id,
        name: group.name.clone(),
        games,
    })
}

pub(crate) async fn fetch_company_games(
    token: &str,
    seed: &IgdbRelationSeed,
    developer_ids: &[u64],
    publisher_ids: &[u64],
) -> Result<(Vec<RelatedGameEntry>, Vec<RelatedGameEntry>), String> {
    let mut company_ids: Vec<u64> = developer_ids
        .iter()
        .chain(publisher_ids.iter())
        .copied()
        .collect();
    company_ids.sort_unstable();
    company_ids.dedup();
    if company_ids.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let csv = company_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let body = format!(
        "fields name, cover.url, first_release_date, rating, \
         involved_companies.company.id, involved_companies.developer, \
         involved_companies.publisher; \
         where involved_companies.company = ({}) & rating != null; \
         sort rating desc; limit 24;",
        csv
    );
    let text = igdb_games_post(token, &body).await?;
    let raw: Vec<IgdbRelationGame> = serde_json::from_str(&text)
        .map_err(|e| format!("IGDB company games parse error: {}", e))?;
    Ok(partition_company_games(
        &raw,
        seed.id,
        developer_ids,
        publisher_ids,
    ))
}

pub(crate) static RELATIONS_CACHE: OnceLock<Mutex<HashMap<u64, (Instant, GameRelationsResult)>>> =
    OnceLock::new();
pub(crate) const RELATIONS_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
pub(crate) const RELATIONS_CACHE_MAX_ENTRIES: usize = 200;

/// Assemble the external IGDB relation graph for a game.
pub async fn get_game_relations(igdb_id: u64) -> Result<GameRelationsResult, String> {
    {
        let cache = RELATIONS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(guard) = cache.lock() {
            if let Some((fetched, result)) = guard.get(&igdb_id) {
                if fetched.elapsed() < RELATIONS_CACHE_TTL {
                    return Ok(result.clone());
                }
            }
        }
    }

    let token = get_twitch_token().await?;

    let seed_body = format!(
        "fields name, franchises.id, franchises.name, collections.id, collections.name, \
         involved_companies.company.id, involved_companies.company.name, \
         involved_companies.developer, involved_companies.publisher, \
         similar_games.id, similar_games.name, similar_games.cover.url, \
         similar_games.first_release_date, similar_games.rating; \
         where id = {}; limit 1;",
        igdb_id
    );
    let seed_text = igdb_games_post(&token, &seed_body).await?;
    let seeds: Vec<IgdbRelationSeed> = serde_json::from_str(&seed_text)
        .map_err(|e| format!("IGDB relations seed parse error: {}", e))?;
    let seed = seeds
        .into_iter()
        .next()
        .ok_or_else(|| format!("IGDB returned no game for id {}", igdb_id))?;

    let mut result = GameRelationsResult::default();

    if let Some(similar) = seed.similar_games.as_ref() {
        result.similar_games = similar
            .iter()
            .filter(|g| g.id != seed.id)
            .take(12)
            .map(related_entry_from_raw)
            .collect();
    }

    if let Some(collections) = seed.collections.as_ref() {
        for collection in collections.iter().take(6) {
            match fetch_relation_group(&token, "collections", collection, seed.id).await {
                Ok(group) => result.collection_groups.push(group),
                Err(e) => eprintln!(
                    "GameRelations: collection {} ({}) failed: {}",
                    collection.name, collection.id, e
                ),
            }
        }
    }

    if let Some(franchises) = seed.franchises.as_ref() {
        for franchise in franchises.iter().take(6) {
            match fetch_relation_group(&token, "franchises", franchise, seed.id).await {
                Ok(group) => result.franchise_groups.push(group),
                Err(e) => eprintln!(
                    "GameRelations: franchise {} ({}) failed: {}",
                    franchise.name, franchise.id, e
                ),
            }
        }
    }

    let (developer_ids, publisher_ids) = seed
        .involved_companies
        .as_ref()
        .map(|companies| split_company_ids(companies))
        .unwrap_or_default();
    match fetch_company_games(&token, &seed, &developer_ids, &publisher_ids).await {
        Ok((developer_games, publisher_games)) => {
            result.developer_games = developer_games;
            result.publisher_games = publisher_games;
        }
        Err(e) => eprintln!("GameRelations: company games failed: {}", e),
    }

    if let Some(cache) = RELATIONS_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            guard.insert(igdb_id, (Instant::now(), result.clone()));
            prune_metadata_cache(&mut *guard, RELATIONS_CACHE_MAX_ENTRIES);
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relations_seed_fixture_maps_groups_companies_and_similar() {
        let json = r#"[
          {
            "id": 100,
            "franchises": [{"id": 7, "name": "Test Saga"}],
            "collections": [{"id": 3, "name": "Test Collection"}],
            "involved_companies": [
              {"company": {"id": 11, "name": "Dev Co"}, "developer": true, "publisher": false},
              {"company": {"id": 22, "name": "Pub Co"}, "developer": false, "publisher": true}
            ],
            "similar_games": [
              {"id": 100, "name": "Self", "cover": {"url": "//x/t_thumb/self.jpg"}, "first_release_date": 0, "rating": 99.0},
              {"id": 200, "name": "Similar", "cover": {"url": "//x/t_thumb/sim.jpg"}, "first_release_date": 946684800, "rating": 80.0}
            ]
          }
        ]"#;
        let seeds: Vec<IgdbRelationSeed> = serde_json::from_str(json).unwrap();
        let seed = &seeds[0];
        assert_eq!(seed.collections.as_ref().unwrap()[0].id, 3);
        assert_eq!(seed.franchises.as_ref().unwrap()[0].name, "Test Saga");

        let (developer_ids, publisher_ids) =
            split_company_ids(seed.involved_companies.as_ref().unwrap());
        assert_eq!(developer_ids, vec![11]);
        assert_eq!(publisher_ids, vec![22]);

        let similar: Vec<RelatedGameEntry> = seed
            .similar_games
            .as_ref()
            .unwrap()
            .iter()
            .filter(|g| g.id != seed.id)
            .map(related_entry_from_raw)
            .collect();
        assert_eq!(similar.len(), 1);
        assert_eq!(
            similar[0].cover_url.as_deref(),
            Some("https://x/t_cover_big/sim.jpg")
        );
        assert_eq!(similar[0].release_year, Some(2000));
    }

    #[test]
    fn company_games_split_excludes_seed_and_keeps_roles() {
        let involved = |company_id: u64, developer: bool, publisher: bool| {
            Some(vec![IgdbRelationCompany {
                company: Some(IgdbCompanyRef { id: company_id }),
                developer,
                publisher,
            }])
        };
        let raw = vec![
            IgdbRelationGame {
                id: 100,
                name: "Self".into(),
                cover: None,
                first_release_date: None,
                rating: Some(99.0),
                involved_companies: involved(11, true, true),
            },
            IgdbRelationGame {
                id: 200,
                name: "Developed".into(),
                cover: None,
                first_release_date: None,
                rating: Some(80.0),
                involved_companies: involved(11, true, false),
            },
            IgdbRelationGame {
                id: 300,
                name: "Published".into(),
                cover: None,
                first_release_date: None,
                rating: Some(70.0),
                involved_companies: involved(22, false, true),
            },
        ];

        let (developer_games, publisher_games) = partition_company_games(&raw, 100, &[11], &[22]);
        assert_eq!(
            developer_games.iter().map(|g| g.id).collect::<Vec<_>>(),
            vec![200]
        );
        assert_eq!(
            publisher_games.iter().map(|g| g.id).collect::<Vec<_>>(),
            vec![300]
        );
    }

    #[test]
    fn relations_result_serializes_camel_case() {
        let result = GameRelationsResult {
            similar_games: vec![RelatedGameEntry {
                id: 1,
                name: "A".into(),
                cover_url: None,
                release_year: Some(1999),
                rating: None,
            }],
            ..Default::default()
        };
        let value = serde_json::to_value(&result).unwrap();
        assert!(value.get("similarGames").is_some());
        assert_eq!(value["similarGames"][0]["releaseYear"], 1999);
    }
}
