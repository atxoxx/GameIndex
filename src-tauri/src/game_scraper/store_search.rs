use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use super::*;
use super::igdb::{
    extract_year_hint, format_unix_timestamp, genre_name_to_id, get_twitch_token, http_client,
    igdb_acquire, map_game_category, map_release_status, strip_year_marker, IgdbGame,
};
use super::title_match::normalize_title;
use super::types::IgdbGameSummary;

pub(crate) fn year_bounds_to_timestamps(
    year_min: Option<i32>,
    year_max: Option<i32>,
) -> (Option<i64>, Option<i64>) {
    use chrono::{NaiveDate, TimeZone, Utc};
    let to_min = |y: i32| -> Option<i64> {
        NaiveDate::from_ymd_opt(y, 1, 1)
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|dt| Utc.from_utc_datetime(&dt).timestamp())
    };
    let to_max = |y: i32| -> Option<i64> {
        // Include the whole year by clamping to Dec 31 23:59:59.
        NaiveDate::from_ymd_opt(y, 12, 31)
            .and_then(|d| d.and_hms_opt(23, 59, 59))
            .map(|dt| Utc.from_utc_datetime(&dt).timestamp())
    };
    (year_min.and_then(to_min), year_max.and_then(to_max))
}

/// Compose the IGDB `where` clause for the supplied category. Returns
/// `(where_clause, sort_clause)`. Empty `where_clause` means no constraint.
pub(crate) fn category_where_sort(category: &str) -> (String, String) {
    use chrono::Utc;
    let now = Utc::now().timestamp();
    match category {
        "trending" => (
            "hypes > 0".to_string(),
            "hypes desc".to_string(),
        ),
        "popular" => (
            "total_rating_count > 5".to_string(),
            "total_rating_count desc".to_string(),
        ),
        "top" | "top_rated" => (
            "aggregated_rating > 70".to_string(),
            "aggregated_rating desc".to_string(),
        ),
        "coming_soon" => (
            // Hype-sorted, release date in the next ~6 months.
            format!(
                "hypes > 0 & first_release_date > {} & first_release_date < {}",
                now,
                now + 60 * 60 * 24 * 30 * 6
            ),
            "hypes desc".to_string(),
        ),
        "new_releases" => (
            // Last 30 days of releases.
            format!(
                "first_release_date < {} & first_release_date > {}",
                now + 60 * 60 * 24,
                now - 60 * 60 * 24 * 30
            ),
            "first_release_date desc".to_string(),
        ),
        _ => ("".to_string(), "total_rating_count desc".to_string()),
    }
}

/// Fetch a page of IGDB games for a category, optionally narrowed by
/// genre / platform / release-year / rating filters. Filters are ANDed
/// together with the category clause; any facet set to `None` or empty
/// contributes no constraint.
pub async fn fetch_store_games(
    category: &str,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<u32>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
    sort: Option<String>,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    // Resolve the base (where, sort) tuple for the active category
    // (curated IGDB view like `trending` or a pure `-ranked default
    // for `all`), then AND in any optional filter facets the user
    // supplied from the sidebar. An empty `Vec` or `None` for a
    // facet contributes no constraint so the call degrades cleanly.
    let (base_where, category_sort) = category_where_sort(category);
    let mut clauses: Vec<String> = Vec::new();
    if !base_where.is_empty() {
        clauses.push(base_where);
    }

    // Optional user-chosen sort override. `default`/None keeps the
    // category's built-in ranking; any explicit choice replaces it. We
    // map the frontend `StoreSort` enum to an IGDB `sort` clause here so
    // the client never has to know IGDB's field names.
    let base_sort = match sort.as_deref() {
        Some("popularity") => "total_rating_count desc".to_string(),
        // "Top Rated" sorts on the same field the cards display and the
        // rating filter uses (IGDB user `rating`), so the ordering is
        // consistent with what the user sees.
        Some("rating") => "rating desc".to_string(),
        Some("trending") => "hypes desc".to_string(),
        Some("follows") => "follows desc".to_string(),
        Some("release_new") => "first_release_date desc".to_string(),
        Some("release_old") => "first_release_date asc".to_string(),
        Some("name") => "name asc".to_string(),
        Some("name_desc") => "name desc".to_string(),
        // "default", None, or any unknown value: keep category ranking.
        _ => category_sort,
    };

    if let Some(g_names) = genres {
        let ids: Vec<u32> = g_names
            .iter()
            .filter_map(|n| genre_name_to_id(n))
            .collect();
        if !ids.is_empty() {
            clauses.push(format!(
                "genres = ({})",
                ids.iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    if let Some(p_ids) = platforms {
        if !p_ids.is_empty() {
            clauses.push(format!(
                "platforms = ({})",
                p_ids
                    .iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    // Year filter maps to Unix-timestamp bounds on
    // `first_release_date`. We let the helper choose the precision
    // (year start vs year end-of-day) so timezone slip is avoided.
    let (year_min_ts, year_max_ts) =
        year_bounds_to_timestamps(year_min, year_max);
    if let Some(ts) = year_min_ts {
        clauses.push(format!("first_release_date >= {}", ts));
    }
    if let Some(ts) = year_max_ts {
        clauses.push(format!("first_release_date <= {}", ts));
    }

    if let Some(rating) = rating_min {
        clauses.push(format!("rating >= {}", rating));
    }

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        clauses.join(" & ")
    };

    // Compose the IGDB Apicalypse body. The field list mirrors what
    // the Store UI surfaces (cover, genres, platforms, etc.). We also
    // request `websites.url` so the Store hero can render the live
    // Steam concurrent-player badge without an extra round-trip; this
    // adds a few extra bytes per response and zero extra API calls.
    let body = if where_clause.is_empty() {
        format!(
            "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url; sort {}; limit {}; offset {};",
            base_sort, limit.min(50), offset
        )
    } else {
        format!(
            "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url; where {}; sort {}; limit {}; offset {};",
            where_clause, base_sort, limit.min(50), offset
        )
    };

    let _guard3 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB store request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB store request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB parse error: {}", e))?;

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

            // De-duped via an inline HashSet so duplicate IGDB entries
            // (rare but observed in the API) don't pollute the JSON
            // payload or the React map over `websites`. Identical
            // query → identical dedupe performance to the GameMetadata
            // path in `search_igdb()` above.
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

/// Map an internally-parsed `IgdbGameSummary` into the frontend-facing
/// `StoreGameSummary`, applying the same cover-size upgrade and website
/// de-dup used by `fetch_store_games` / `get_collection_games`.
///
/// Kept as a standalone helper so the store enrichment path
/// (which fetches games by IGDB id) produces bit-for-bit identical
/// summaries without re-pasting the mapping.
pub(crate) fn map_igdb_summary(g: IgdbGameSummary) -> StoreGameSummary {
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
            .find_map(|a| a.url)
            .map(|url| {
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
        if unique.is_empty() {
            None
        } else {
            Some(unique)
        }
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
}

/// Resolve a batch of Steam appids to IGDB game ids via IGDB's
/// `external_games` endpoint (category 1 = Steam).
///
/// The store is IGDB-backed (detail pages, covers, ratings all key off
/// the IGDB id/slug). This helper is the bridge: given Steam appids it
/// returns `appid -> igdb_id` so a listing keyed on Steam appids can be
/// enriched into `StoreGameSummary`s without losing any of the existing
/// store behaviour.
pub async fn resolve_steam_to_igdb(
    appids: &[u32],
) -> Result<HashMap<u32, u64>, String> {
    if appids.is_empty() {
        return Ok(HashMap::new());
    }
    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    let list: Vec<String> = appids.iter().map(|a| format!("\"{}\"", a)).collect();
    // In IGDB v4, Steam is external_game_source = 1 (or category = 1 in legacy rows).
    // Filtering by external_game_source avoids collisions with GiantBomb (source 3),
    // Twitch (source 14), or Utomik (source 29) when numeric IDs match.
    let body = format!(
        "fields game,uid,external_game_source; where uid = ({}) & (external_game_source = 1 | category = 1); limit 500; offset 0;",
        list.join(",")
    );

    let _guard = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/external_games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB external_games request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB external_games failed with status {}: {}",
            status.as_u16(),
            err
        ));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB external_games response: {}", e))?;

    #[derive(Deserialize)]
    struct Eg {
        game: u64,
        uid: String,
        #[serde(default)]
        external_game_source: Option<u32>,
    }
    let rows: Vec<Eg> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB external_games parse error: {}", e))?;

    let mut map = HashMap::new();
    for r in rows {
        if r.external_game_source.unwrap_or(1) == 1 {
            if let Ok(appid) = r.uid.parse::<u32>() {
                map.insert(appid, r.game);
            }
        }
    }
    Ok(map)
}

// ─── Store search re-ranking ──────────────────────────────────────────────────

/// True when the caller has not chosen an explicit sort, which means IGDB is
/// nominally returning relevance order and we are free to re-rank locally.
/// Explicit sorts must be passed straight through so the user's ordering wins.
pub(crate) fn is_relevance_mode(sort: Option<&str>) -> bool {
    matches!(sort, None | Some("default"))
}

/// Number of IGDB rows pulled for a relevance search. Every page for a query
/// is sliced out of this one fixed pool, so "load more" stays duplicate-free
/// and stable. A pool that grew with the offset would reshuffle rows already
/// shown on earlier pages.
pub(crate) const SEARCH_RERANK_POOL: u32 = 50;

/// Word-boundary-aware band score between a normalized query and candidate.
/// Returns one of a few fixed bands plus a Jaccard fallback, enough to
/// separate an exact title from a prefix from a mere mention.
///
/// Deliberately does NOT reuse `title_similarity`: its containment branch
/// divides by the larger token count, so "doom" vs "Doom Eternal" lands at 0.5
/// — exactly the strong prefix hit a similarity floor would wrongly delete.
pub(crate) fn search_band(query: &str, candidate: &str) -> f64 {
    let q = normalize_title(query);
    let c = normalize_title(candidate);
    // A parenthesised year like "Prototype (2009)" is a user disambiguator,
    // not part of the title, so also compare with the marker stripped.
    let q2 = normalize_title(&strip_year_marker(query));
    band_core(&q, &c).max(band_core(&q2, &c))
}

/// Innermost band comparison. Assumes both sides are already normalized.
pub(crate) fn band_core(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.00;
    }
    if let Some(rest) = b.strip_prefix(a) {
        // Only grant prefix credit on a word boundary so "doo" does not score
        // as highly as "doom" against "Doom Eternal".
        if rest.is_empty() || rest.starts_with(' ') {
            return 0.92;
        }
    }
    if b.contains(a) {
        return 0.85;
    }
    if a.contains(b) {
        return 0.80;
    }
    let a_tokens: HashSet<&str> = a.split_whitespace().collect();
    let b_tokens: HashSet<&str> = b.split_whitespace().collect();
    if a_tokens.is_subset(&b_tokens) {
        return 0.65;
    }
    let intersection = a_tokens.intersection(&b_tokens).count() as f64;
    let union = a_tokens.union(&b_tokens).count() as f64;
    if union == 0.0 {
        return 0.40;
    }
    0.40 + 0.20 * (intersection / union)
}

/// Coarse content group used as the first tie-break after the band score so a
/// main game beats an expansion or DLC that shares its exact band.
pub(crate) fn search_category_rank(game_type: Option<u32>) -> u8 {
    match game_type {
        // Missing category: treat as a main game rather than punishing it.
        None => 0,
        // Main game, standalone expansion, remake, remaster, expanded game,
        // port, fork.
        Some(0 | 4 | 8 | 9 | 10 | 11 | 12) => 0,
        // Expansion, bundle, episode, season, pack.
        Some(2 | 3 | 6 | 7 | 13) => 1,
        // DLC / add-on.
        Some(1) => 2,
        // Mod, playable prototype / update.
        Some(5 | 14) => 3,
        _ => 0,
    }
}

/// Precomputed per-candidate inputs for the comparator below. Keeping them in
/// a struct keeps the sort closure readable and avoids recomputing regex /
/// formatting work inside the comparison.
pub(crate) struct SearchRankKey {
    band: f64,
    category_rank: u8,
    year_match: bool,
    released: bool,
    has_cover: bool,
    total_rating_count: u64,
    rating: f64,
    igdb_index: usize,
    year_string: String,
}

/// Rank, filter and dedup a relevance-search pool. Pure and network-free so
/// the ordering rules can be unit-tested in isolation.
pub(crate) fn rank_search_candidates(query: &str, games: Vec<IgdbGameSummary>) -> Vec<IgdbGameSummary> {
    let year_hint = extract_year_hint(query);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Precompute everything the pipeline needs exactly once per candidate.
    let mut items: Vec<(IgdbGameSummary, SearchRankKey)> = games
        .into_iter()
        .enumerate()
        .map(|(idx, game)| {
            let year_string = game
                .first_release_date
                .map(|ts| format_unix_timestamp(ts).get(..4).unwrap_or("").to_string())
                .unwrap_or_default();
            let band = search_band(query, &game.name);
            let key = SearchRankKey {
                band,
                category_rank: search_category_rank(game.game_type),
                year_match: match (year_hint.as_deref(), year_string.as_str()) {
                    (Some(hint), year) => !year.is_empty() && hint == year,
                    _ => false,
                },
                released: game.first_release_date.map(|ts| ts <= now).unwrap_or(false),
                has_cover: game.cover.is_some(),
                total_rating_count: game.total_rating_count.unwrap_or(0),
                rating: game.rating.unwrap_or(0.0),
                igdb_index: idx,
                year_string,
            };
            (game, key)
        })
        .collect();

    // Mods and playable prototypes only belong in a result set when the query
    // actually points at them; otherwise they ride along on a shared word.
    items.retain(|(_, k)| !(k.category_rank == 3 && k.band < 0.8));

    // Noise floor: once the pool holds a near-exact hit, loose mentions are
    // just clutter. If nothing reaches the strong band we keep everything, so
    // an obscure but real title still returns results instead of none.
    if items.iter().any(|(_, k)| k.band >= 0.92) {
        items.retain(|(_, k)| k.band >= 0.8);
    }

    // Descending band, then best category first, then all remaining signals.
    // The original IGDB index is the final tie-break so equal rows stay stable.
    items.sort_by(|a, b| {
        let ka = &a.1;
        let kb = &b.1;
        kb.band
            .partial_cmp(&ka.band)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| ka.category_rank.cmp(&kb.category_rank))
            .then_with(|| kb.year_match.cmp(&ka.year_match))
            .then_with(|| kb.released.cmp(&ka.released))
            .then_with(|| kb.has_cover.cmp(&ka.has_cover))
            .then_with(|| kb.total_rating_count.cmp(&ka.total_rating_count))
            .then_with(|| kb.rating.partial_cmp(&ka.rating).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| ka.igdb_index.cmp(&kb.igdb_index))
    });

    // Collapse editions / ports sharing a title and year. The year is part of
    // the key on purpose: title-only would merge Prey (2006) with Prey (2017)
    // and DOOM (1993) with DOOM (2016). The list is sorted, so the first
    // occurrence of a key is always the best-scoring one.
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for (game, key) in items {
        let dedup_key = (normalize_title(&game.name), key.year_string);
        if seen.insert(dedup_key) {
            out.push(game);
        }
    }
    out
}

/// Slice one page out of an already-ranked pool. Kept as its own helper so the
/// paging rule can be tested without any network access.
pub(crate) fn paginate_pool<T>(pool: Vec<T>, offset: u32, limit: u32) -> Vec<T> {
    pool.into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect()
}

/// Search IGDB games by name (live search with debounce expected from
/// frontend). Accepts the same optional facet filters as
/// `fetch_store_games` (genre / platform / release-year / rating) plus an
/// optional sort override. Filters are ANDed with the search text into the
/// IGDB `where` clause; `None` or empty facets contribute no constraint, and
/// a `sort` of `None`/`"default"`/unknown emits no sort clause so IGDB keeps
/// its relevance ranking for the search.
pub async fn search_store_games(
    query: &str,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<u32>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
    sort: Option<String>,
) -> Result<Vec<StoreGameSummary>, String> {
    // IGDB rejects a bare `search "";` with a 400, so bail out before any
    // network work when the caller has not typed a query yet.
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    let escaped = query.replace('"', "\\\"");

    // Build the optional `where` clause using the exact same facet→IGDB
    // mapping as `fetch_store_games`, so search results respect the same
    // sidebar filters (ANDed with the search text).
    let mut clauses: Vec<String> = Vec::new();

    if let Some(g_names) = genres {
        let ids: Vec<u32> = g_names
            .iter()
            .filter_map(|n| genre_name_to_id(n))
            .collect();
        if !ids.is_empty() {
            clauses.push(format!(
                "genres = ({})",
                ids.iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    if let Some(p_ids) = platforms {
        if !p_ids.is_empty() {
            clauses.push(format!(
                "platforms = ({})",
                p_ids
                    .iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    // Year filter maps to Unix-timestamp bounds on `first_release_date`,
    // exactly as `fetch_store_games` does via the shared helper.
    let (year_min_ts, year_max_ts) =
        year_bounds_to_timestamps(year_min, year_max);
    if let Some(ts) = year_min_ts {
        clauses.push(format!("first_release_date >= {}", ts));
    }
    if let Some(ts) = year_max_ts {
        clauses.push(format!("first_release_date <= {}", ts));
    }

    if let Some(rating) = rating_min {
        clauses.push(format!("rating >= {}", rating));
    }

    // IGDB's documented way to search games while excluding alternate editions
    // (Collector's / Gold / Definitive …): those rows carry `version_parent`,
    // so nulling it drops the duplicates at the source. Kept as its own push
    // so it is trivial to remove if editions are ever wanted back.
    clauses.push("version_parent = null".to_string());

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        clauses.join(" & ")
    };

    // Optional user-chosen sort override. `None`/`"default"` (or any
    // unknown value) emits no sort clause so IGDB keeps its relevance
    // ranking for the search. The value mapping mirrors `fetch_store_games`.
    let sort_clause = match sort.as_deref() {
        Some("popularity") => Some("total_rating_count desc".to_string()),
        Some("rating") => Some("rating desc".to_string()),
        Some("trending") => Some("hypes desc".to_string()),
        Some("follows") => Some("follows desc".to_string()),
        Some("release_new") => Some("first_release_date desc".to_string()),
        Some("release_old") => Some("first_release_date asc".to_string()),
        Some("name") => Some("name asc".to_string()),
        Some("name_desc") => Some("name desc".to_string()),
        // "default", None, or any unknown value: keep IGDB relevance ranking.
        _ => None,
    };

    // Compose the IGDB Apicalypse body. `where` and `sort` fragments are
    // only emitted when non-empty, so the request never carries a bare
    // `where ;` / `sort ;`.
    let mut body = format!(
        r#"search "{}"; fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url,game_type;"#,
        escaped
    );
    if !where_clause.is_empty() {
        body.push_str(&format!(" where {};", where_clause));
    }
    if let Some(sort_clause) = sort_clause {
        body.push_str(&format!(" sort {};", sort_clause));
    }

    // Relevance mode pulls one fixed pool from the top and pages out of the
    // ranked result locally, so the HTTP request itself always starts at
    // offset 0. Explicit sorts keep the caller's offset/limit straight-through.
    let relevance_mode = is_relevance_mode(sort.as_deref());
    let (request_limit, request_offset) = if relevance_mode {
        (SEARCH_RERANK_POOL, 0u32)
    } else {
        (limit.min(50), offset)
    };
    body.push_str(&format!(" limit {}; offset {};", request_limit, request_offset));

    let _guard4 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB search request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB search request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB search parse error: {}", e))?;

    // Relevance searches re-rank/filter/dedup the shared pool and only then
    // slice the caller's page out of it, so every page is derived from the
    // SAME pool and "load more" never re-introduces an earlier row. Explicit
    // sorts bypass all of this and keep IGDB's own ordering.
    let games: Vec<IgdbGameSummary> = if relevance_mode {
        paginate_pool(rank_search_candidates(query, games), offset, limit)
    } else {
        games
    };

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

/// Return a batch of genuinely-random IGDB store games for the
/// "Surprise me" modal.
///
/// Unlike the category rails, this does NOT pick from whatever is
/// already on screen. It queries IGDB at a random offset, shuffles the
/// returned pool, and hands back `limit` games — so every refresh is a
/// fresh surprise.
pub async fn get_random_store_games(limit: u32) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    // Random offset up to ~8000, staying within IGDB's pagination ceiling.
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(1);
    let offset = (seed % 8000) as u32;

    let body = format!(
        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where cover != null & first_release_date != null; sort total_rating_count desc; limit 50; offset {};",
        offset
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
        .map_err(|e| format!("IGDB random game request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB random game failed with status {}: {}",
            status.as_u16(),
            err
        ));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB random game response: {}", e))?;
    let mut games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB random game parse error: {}", e))?;

    if games.is_empty() {
        return Err("No random games found at this offset".to_string());
    }

    // Fisher–Yates shuffle driven by an xorshift PRNG seeded from the wall
    // clock, so consecutive refreshes surface different games from the pool
    // rather than always the same leading slice.
    let mut rng = seed;
    let mut next = move || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    for i in (1..games.len()).rev() {
        let j = (next() % (i as u128 + 1)) as usize;
        games.swap(i, j);
    }

    let want = (limit as usize).min(games.len());
    Ok(games
        .into_iter()
        .take(want)
        .map(map_igdb_summary)
        .collect())
}

/// Extract unique Steam AppIDs from Steam Store search results HTML.
pub(crate) fn extract_steam_search_appids(html: &str) -> Vec<u32> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r#"data-ds-appid="(\d+)""#).unwrap());
    let mut appids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            if let Ok(id) = m.as_str().parse::<u32>() {
                if seen.insert(id) {
                    appids.push(id);
                }
            }
        }
    }
    appids
}

/// Enrich an ordered list of Steam AppIDs into full `StoreGameSummary` objects via IGDB,
/// preserving the exact ranking order of the incoming appids.
pub(crate) async fn enrich_steam_appids_to_summaries(
    appids: &[u32],
    limit: usize,
) -> Result<Vec<StoreGameSummary>, String> {
    if appids.is_empty() {
        return Ok(Vec::new());
    }

    let id_map = resolve_steam_to_igdb(appids).await?;
    let mut ordered_igdb_ids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for aid in appids {
        if let Some(&gid) = id_map.get(aid) {
            if seen.insert(gid) {
                ordered_igdb_ids.push(gid);
            }
        }
    }

    if ordered_igdb_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Take enough candidate IDs to fulfill the target limit with buffer
    let take_count = (limit + 5).min(ordered_igdb_ids.len());
    let target_ids = &ordered_igdb_ids[..take_count];

    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    let ids_str: Vec<String> = target_ids.iter().map(|id| id.to_string()).collect();
    let body = format!(
        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where id = ({}); limit 50; offset 0;",
        ids_str.join(",")
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
        .map_err(|e| format!("IGDB batch games request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB batch games request failed with status {}: {}", status, err));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB batch response: {}", e))?;

    let igdb_games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB batch games parse error: {}", e))?;

    let mut map: HashMap<u64, StoreGameSummary> = HashMap::new();
    for g in igdb_games {
        let gid = g.id;
        map.insert(gid, map_igdb_summary(g));
    }

    let mut results = Vec::new();
    for &gid in target_ids {
        if let Some(summary) = map.remove(&gid) {
            results.push(summary);
            if results.len() >= limit {
                break;
            }
        }
    }

    Ok(results)
}

/// Fetch spotlight games for the Store hero carousel (Hot Now, Game of the Week, Trending).
/// Backed by real-time Steam concurrent player metrics and store search feeds, mapped to rich
/// IGDB game metadata with an in-memory 15-minute TTL cache and graceful IGDB fallbacks.
pub async fn fetch_spotlight_games(
    category: &str,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let limit_usize = (limit.max(1) as usize).min(30);

    // In-memory cache for spotlight carousel data with a 15-minute TTL
    static SPOTLIGHT_CACHE: std::sync::OnceLock<tokio::sync::Mutex<HashMap<String, (Instant, Vec<StoreGameSummary>)>>> =
        std::sync::OnceLock::new();
    let cache_mutex = SPOTLIGHT_CACHE.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    {
        let cache = cache_mutex.lock().await;
        if let Some((inserted_at, items)) = cache.get(category) {
            if inserted_at.elapsed() < Duration::from_secs(15 * 60) && items.len() >= limit_usize {
                return Ok(items.iter().take(limit_usize).cloned().collect());
            }
        }
    }

    let client = http_client();
    let mut results = Vec::new();

    match category {
        "hot" => {
            // Live Steam concurrent player rankings (most played right now on PC)
            if let Ok(resp) = client
                .get("https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/")
                .send()
                .await
            {
                #[derive(Deserialize)]
                struct Rank {
                    appid: u32,
                }
                #[derive(Deserialize)]
                struct RespData {
                    ranks: Vec<Rank>,
                }
                #[derive(Deserialize)]
                struct Wrapper {
                    response: RespData,
                }
                if let Ok(data) = resp.json::<Wrapper>().await {
                    let appids: Vec<u32> = data
                        .response
                        .ranks
                        .into_iter()
                        .take(50)
                        .map(|r| r.appid)
                        .collect();
                    if let Ok(enriched) = enrich_steam_appids_to_summaries(&appids, limit_usize).await {
                        if !enriched.is_empty() {
                            results = enriched;
                        }
                    }
                }
            }

            // Fallback: IGDB popular ranking
            if results.is_empty() {
                if let Ok(fallback) = fetch_store_games("popular", 0, limit, None, None, None, None, None, None).await {
                    results = fallback;
                }
            }
        }
        "weekly" | "top_sellers" => {
            // Steam Weekly Top Sellers (current best-selling titles of the week)
            if let Ok(resp) = client
                .get("https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=topsellers&infinite=1")
                .send()
                .await
            {
                #[derive(Deserialize)]
                struct SearchResult {
                    results_html: String,
                }
                if let Ok(data) = resp.json::<SearchResult>().await {
                    let appids = extract_steam_search_appids(&data.results_html);
                    if let Ok(enriched) = enrich_steam_appids_to_summaries(&appids, limit_usize).await {
                        if !enriched.is_empty() {
                            results = enriched;
                        }
                    }
                }
            }

            // Fallback: recent high-rated releases from the last 60 days
            if results.is_empty() {
                let now = chrono::Utc::now().timestamp();
                let sixty_days_ago = now - 60 * 24 * 3600;
                let fallback_where = format!(
                    "first_release_date > {} & first_release_date <= {} & (rating > 70 | aggregated_rating > 70) & cover != null",
                    sixty_days_ago, now
                );
                if let Ok(token) = get_twitch_token().await {
                    let client_id = crate::config::get_twitch_client_id();
                    let body = format!(
                        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where {}; sort rating desc; limit {}; offset 0;",
                        fallback_where, limit
                    );
                    let _guard = igdb_acquire().await;
                    if let Ok(resp) = client
                        .post("https://api.igdb.com/v4/games")
                        .header("Client-ID", &client_id)
                        .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "text/plain")
                        .body(body)
                        .send()
                        .await
                    {
                        if let Ok(text) = resp.text().await {
                            if let Ok(games) = serde_json::from_str::<Vec<IgdbGameSummary>>(&text) {
                                results = games.into_iter().map(map_igdb_summary).collect();
                            }
                        }
                    }
                }
            }
            if results.is_empty() {
                if let Ok(fallback) = fetch_store_games("top", 0, limit, None, None, None, None, None, None).await {
                    results = fallback;
                }
            }
        }
        "trending" => {
            // Steam Popular New Releases / Trending (breakout new titles and expansions)
            if let Ok(resp) = client
                .get("https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=popularnew&infinite=1")
                .send()
                .await
            {
                #[derive(Deserialize)]
                struct SearchResult {
                    results_html: String,
                }
                if let Ok(data) = resp.json::<SearchResult>().await {
                    let appids = extract_steam_search_appids(&data.results_html);
                    if let Ok(enriched) = enrich_steam_appids_to_summaries(&appids, limit_usize).await {
                        if !enriched.is_empty() {
                            results = enriched;
                        }
                    }
                }
            }

            // Fallback: recent releases with hype or ratings from the last 90 days
            if results.is_empty() {
                let now = chrono::Utc::now().timestamp();
                let ninety_days_ago = now - 90 * 24 * 3600;
                let fallback_where = format!(
                    "first_release_date > {} & (hypes > 0 | total_rating_count > 10) & cover != null",
                    ninety_days_ago
                );
                if let Ok(token) = get_twitch_token().await {
                    let client_id = crate::config::get_twitch_client_id();
                    let body = format!(
                        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where {}; sort hypes desc; limit {}; offset 0;",
                        fallback_where, limit
                    );
                    let _guard = igdb_acquire().await;
                    if let Ok(resp) = client
                        .post("https://api.igdb.com/v4/games")
                        .header("Client-ID", &client_id)
                        .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "text/plain")
                        .body(body)
                        .send()
                        .await
                    {
                        if let Ok(text) = resp.text().await {
                            if let Ok(games) = serde_json::from_str::<Vec<IgdbGameSummary>>(&text) {
                                results = games.into_iter().map(map_igdb_summary).collect();
                            }
                        }
                    }
                }
            }
            if results.is_empty() {
                if let Ok(fallback) = fetch_store_games("trending", 0, limit, None, None, None, None, None, None).await {
                    results = fallback;
                }
            }
        }
        "top_rated" => {
            // IGDB Critically Acclaimed Games (highest rated games with robust review counts)
            if let Ok(token) = get_twitch_token().await {
                let client_id = crate::config::get_twitch_client_id();
                let body = format!(
                    "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where aggregated_rating >= 85 & total_rating_count >= 20 & cover != null; sort aggregated_rating desc; limit {}; offset 0;",
                    limit
                );
                let _guard = igdb_acquire().await;
                if let Ok(resp) = client
                    .post("https://api.igdb.com/v4/games")
                    .header("Client-ID", &client_id)
                    .header("Authorization", format!("Bearer {}", token))
                    .header("Content-Type", "text/plain")
                    .body(body)
                    .send()
                    .await
                {
                    if let Ok(text) = resp.text().await {
                        if let Ok(games) = serde_json::from_str::<Vec<IgdbGameSummary>>(&text) {
                            results = games.into_iter().map(map_igdb_summary).collect();
                        }
                    }
                }
            }

            // Fallback: Steam highest user reviews search
            if results.is_empty() {
                if let Ok(resp) = client
                    .get("https://store.steampowered.com/search/results/?query=&start=0&count=50&sort_by=Reviews_DESC&category1=998&infinite=1")
                    .send()
                    .await
                {
                    #[derive(Deserialize)]
                    struct SearchResult {
                        results_html: String,
                    }
                    if let Ok(data) = resp.json::<SearchResult>().await {
                        let appids = extract_steam_search_appids(&data.results_html);
                        if let Ok(enriched) = enrich_steam_appids_to_summaries(&appids, limit_usize).await {
                            if !enriched.is_empty() {
                                results = enriched;
                            }
                        }
                    }
                }
            }

            if results.is_empty() {
                if let Ok(fallback) = fetch_store_games("top", 0, limit, None, None, None, None, None, None).await {
                    results = fallback;
                }
            }
        }
        "coming_soon" => {
            // Steam Most Wishlisted & Anticipated Upcoming Releases
            if let Ok(resp) = client
                .get("https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=popularwishlist&infinite=1")
                .send()
                .await
            {
                #[derive(Deserialize)]
                struct SearchResult {
                    results_html: String,
                }
                if let Ok(data) = resp.json::<SearchResult>().await {
                    let appids = extract_steam_search_appids(&data.results_html);
                    if let Ok(enriched) = enrich_steam_appids_to_summaries(&appids, limit_usize).await {
                        if !enriched.is_empty() {
                            results = enriched;
                        }
                    }
                }
            }

            // Fallback: upcoming releases sorted by IGDB hypes
            if results.is_empty() {
                let now = chrono::Utc::now().timestamp();
                let fallback_where = format!(
                    "first_release_date > {} & hypes > 0 & cover != null",
                    now
                );
                if let Ok(token) = get_twitch_token().await {
                    let client_id = crate::config::get_twitch_client_id();
                    let body = format!(
                        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,artworks.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; where {}; sort hypes desc; limit {}; offset 0;",
                        fallback_where, limit
                    );
                    let _guard = igdb_acquire().await;
                    if let Ok(resp) = client
                        .post("https://api.igdb.com/v4/games")
                        .header("Client-ID", &client_id)
                        .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "text/plain")
                        .body(body)
                        .send()
                        .await
                    {
                        if let Ok(text) = resp.text().await {
                            if let Ok(games) = serde_json::from_str::<Vec<IgdbGameSummary>>(&text) {
                                results = games.into_iter().map(map_igdb_summary).collect();
                            }
                        }
                    }
                }
            }

            if results.is_empty() {
                if let Ok(fallback) = fetch_store_games("coming_soon", 0, limit, None, None, None, None, None, None).await {
                    results = fallback;
                }
            }
        }
        _ => {
            return fetch_store_games("all", 0, limit, None, None, None, None, None, None).await;
        }
    }

    if results.is_empty() {
        return fetch_store_games("all", 0, limit, None, None, None, None, None, None).await;
    }

    // Cache successful fetch
    {
        let mut cache = cache_mutex.lock().await;
        cache.insert(category.to_string(), (Instant::now(), results.clone()));
    }

    Ok(results.into_iter().take(limit_usize).collect())
}

/// Fetch full metadata for a single IGDB game by its slug.
/// Returns the same rich GameMetadataResult used by the library detail page.
pub async fn get_store_game_detail(slug: &str) -> Option<GameMetadataResult> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return None;
        }
    };

    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    // Games that couldn't be pre-enriched land in the store with their
    // Steam appid used as the slug. If the slug is a numeric Steam
    // appid, resolve it to an IGDB id via `external_games` so the detail
    // page still loads.
    let mut detail_id: Option<u64> = None;
    if let Ok(appid) = slug.parse::<u32>() {
        let eg_body = format!(
            "fields game; where uid = (\"{}\"); limit 1;",
            appid
        );
        if let Ok(eg_resp) = client
            .post("https://api.igdb.com/v4/external_games")
            .header("Client-ID", &client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(eg_body)
            .send()
            .await
        {
            if eg_resp.status().is_success() {
                if let Ok(text) = eg_resp.text().await {
                    #[derive(Deserialize)]
                    struct EgGame {
                        game: u64,
                    }
                    if let Ok(rows) = serde_json::from_str::<Vec<EgGame>>(&text) {
                        detail_id = rows.into_iter().next().map(|r| r.game);
                    }
                }
            }
        }
    }

    let where_clause = match detail_id {
        Some(id) => format!("id = {}", id),
        None => format!("slug = \"{}\"", slug.replace('"', "\\\"")),
    };
    let body = format!(
        "where {};
 fields name, slug, summary, storyline, first_release_date, rating, aggregated_rating,
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name,
       genres.name, themes.name, game_modes.name, player_perspectives.name,
       platforms.name,
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name,
       websites.url, websites.category,
       similar_games.name, similar_games.cover.url,
       release_dates.platform.name, release_dates.human, release_dates.region,
       game_type, status, collections.id, collections.name, franchises.name, alternative_names.name,
       language_supports.language.name, language_supports.language_support_type.name;
 limit 1;",
        where_clause
    );


    let _guard5 = igdb_acquire().await;
    let resp = match client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB detail request error: {}", e);
            return None;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB detail request failed with status {}: {}", status, err_text);
        return None;
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB detail response: {}", e);
            return None;
        }
    };

    let mut igdb_games: Vec<IgdbGame> = match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB detail parse error: {}", e);
            return None;
        }
    };

    let game = igdb_games.pop()?;

    // NOTE: Reviews endpoint (/v4/reviews) was removed from the IGDB public
    // API and returns 404. Reviews are not fetched here; the IgdbReview field
    // is kept for backward compatibility with saved library data only.

    // Map the IgdbGame → GameMetadataResult
    let mut developers = Vec::new();
    let mut publishers = Vec::new();
    if let Some(ref companies) = game.involved_companies {
        for comp in companies {
            if comp.developer {
                developers.push(comp.company.name.clone());
            }
            if comp.publisher {
                publishers.push(comp.company.name.clone());
            }
        }
    }

    let developer = if developers.is_empty() {
        None
    } else {
        Some(developers.join("; "))
    };
    let publisher = if publishers.is_empty() {
        None
    } else {
        Some(publishers.join("; "))
    };

    let release_date = game.first_release_date.map(format_unix_timestamp);

    let genres: Vec<String> = game
        .genres
        .unwrap_or_default()
        .into_iter()
        .map(|g| g.name)
        .collect();

    let platform_names: Vec<String> = game
        .platforms
        .as_ref()
        .map(|list| list.iter().map(|p| p.name.clone()).collect())
        .unwrap_or_default();
    let is_vr = Some(crate::vr::detect_vr(&game.name, &genres, &platform_names));

    let themes = game
        .themes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let game_modes = game
        .game_modes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let player_perspectives = game
        .player_perspectives
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let cover_url = game.cover.and_then(|c| c.url).map(|url| {
        let clean = if url.starts_with("//") {
            format!("https:{}", url)
        } else {
            url
        };
        clean.replace("t_thumb", "t_cover_big")
    });

    let mut screenshot_urls = Vec::new();
    if let Some(screenshots) = game.screenshots {
        for scr in screenshots {
            if let Some(ref url) = scr.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let mut artwork_urls = Vec::new();
    if let Some(ref artworks) = game.artworks {
        for art in artworks {
            if let Some(ref url) = art.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                artwork_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let hero = artwork_urls
        .first()
        .or_else(|| screenshot_urls.first())
        .cloned();

    let banner = screenshot_urls
        .first()
        .or_else(|| artwork_urls.first())
        .cloned();

    let logo_url = game.artworks.as_ref().and_then(|list| {
        list.iter()
            .filter(|a| a.url.as_ref().map(|u| u.contains("/t_logo")).unwrap_or(false))
            .find_map(|a| a.url.as_ref())
            .map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                clean.replace("t_thumb", "t_logo_med")
            })
    }).or_else(|| {
        game.websites.as_ref().and_then(|list| {
            for w in list {
                if let Some(ref url) = w.url {
                    if let Some(pos) = url.find("store.steampowered.com/app/") {
                        let rest = &url[pos + "store.steampowered.com/app/".len()..];
                        let id_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                        if let Ok(id) = id_str.parse::<u32>() {
                            return Some(format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png", id));
                        }
                    }
                }
            }
            None
        })
    });

    let images = GameImages {
        icon: None,
        cover: cover_url,
        hero,
        banner,
        logo: logo_url,
    };

    let videos = game.videos.map(|list| {
        list.into_iter()
            .filter_map(|v| {
                v.video_id
                    .map(|id| format!("https://www.youtube.com/watch?v={}", id))
            })
            .collect::<Vec<_>>()
    });

    let websites = game.websites.map(|list| {
        let mut unique_urls = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for w in list {
            if let Some(url) = w.url {
                if seen.insert(url.clone()) {
                    unique_urls.push(url);
                }
            }
        }
        unique_urls
    });

    // Time-to-beat comes from HowLongToBeat rather than IGDB.
    let time_to_beat = crate::hltb::fetch_time_to_beat(&game.name, None).await;

    let similar_games = game.similar_games.map(|list| {
        list.into_iter()
            .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });
                SimilarGame {
                    id: g.id,
                    name: g.name,
                    cover_url,
                }
            })
            .collect::<Vec<_>>()
    });

    let releases = game.release_dates.map(|list| {
        list.into_iter()
            .map(|r| {
                let platform = r
                    .platform
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Unknown".to_string());
                let date_str = r
                    .human
                    .unwrap_or_else(|| "Unknown".to_string());
                let region = match r.region {
                    Some(1) => "Europe",
                    Some(2) => "North America",
                    Some(3) => "Australia",
                    Some(4) => "New Zealand",
                    Some(5) => "Japan",
                    Some(6) => "China",
                    Some(7) => "Asia",
                    Some(8) => "Worldwide",
                    Some(9) => "Korea",
                    Some(10) => "Brazil",
                    _ => "Global",
                }
                .to_string();
                ReleaseDateInfo {
                    platform,
                    date_str,
                    region,
                }
            })
            .collect::<Vec<_>>()
    });

    let igdb_reviews: Option<Vec<IgdbReview>> = None;

    let alternative_names = game.alternative_names.as_ref()
        .map(|list| list.iter().map(|a| a.name.clone()).collect::<Vec<_>>());

    let collection = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.name.clone()));

    let collection_id = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.id));

    let franchise = game.franchises.as_ref()
        .and_then(|list| {
            if list.is_empty() { None }
            else { Some(list.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join("; ")) }
        });

    let game_category = Some(map_game_category(game.game_type.unwrap_or(0)));
    let release_status = Some(map_release_status(game.status.unwrap_or(0)));

    let language_supports = game.language_supports.as_ref().map(|list| {
        list.iter()
            .filter_map(|ls| {
                let lang = ls.language.as_ref()?.name.clone();
                let support_type = ls.language_support_type.as_ref()?.name.clone();
                Some(LanguageSupportInfo {
                    language: lang,
                    support_type,
                })
            })
            .collect::<Vec<_>>()
    });

    Some(GameMetadataResult {
        title: game.name,
        description: game.summary,
        developer,
        publisher,
        release_date,
        genres,
        images,
        source_url: format!("https://www.igdb.com/games/{}", game.slug),
        source_name: "IGDB".to_string(),
        storyline: game.storyline,
        igdb_rating: game.rating,
        critic_rating: game.aggregated_rating,
        themes,
        game_modes,
        player_perspectives,
        screenshots: if screenshot_urls.is_empty() {
            None
        } else {
            Some(screenshot_urls)
        },
        videos,
        websites,
        time_to_beat,
        similar_games,
        releases,
        igdb_reviews,
        alternative_names,
        collection,
        collection_id,
        // Stable identity key: the numeric IGDB game id, persisted by
        // the frontend so deleted games stay identifiable.
        igdb_id: Some(game.id),
        franchise,
        game_category,
        release_status,
        language_supports,
        is_vr,
    })
}

#[cfg(test)]
mod store_search_ranking_tests {
    use super::*;

    /// Unix timestamp for Jan 1 of `year`, using a leap-year aware day count so
    /// the year round-trips through `format_unix_timestamp`.
    fn ts_for_year(year: i64) -> i64 {
        let mut days: i64 = 0;
        for y in 1970..year {
            let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
            days += if leap { 366 } else { 365 };
        }
        days * 86_400
    }

    fn fixture(
        id: u64,
        name: &str,
        game_type: Option<u32>,
        year: Option<i64>,
        rating: Option<f64>,
        rating_count: Option<u64>,
    ) -> IgdbGameSummary {
        IgdbGameSummary {
            id,
            name: name.to_string(),
            slug: name.to_lowercase().replace([' ', ':', '\''], "-"),
            summary: None,
            rating,
            aggregated_rating: None,
            cover: Some(IgdbCover {
                url: Some("//images.igdb.com/igdb/image/upload/t_thumb/cover.jpg".to_string()),
            }),
            artworks: None,
            genres: None,
            platforms: None,
            first_release_date: year.map(ts_for_year),
            total_rating_count: rating_count,
            hypes: None,
            follows: None,
            game_type,
            websites: None,
        }
    }

    #[test]
    fn year_fixture_roundtrips_through_format() {
        for year in [1993i64, 2006, 2009, 2016, 2017, 2020] {
            assert!(format_unix_timestamp(ts_for_year(year)).starts_with(&year.to_string()));
        }
    }

    #[test]
    fn band_exact_prefix_and_mention() {
        assert_eq!(search_band("doom", "Doom"), 1.0);
        assert!(search_band("doom", "Doom Eternal") >= 0.9);
        assert_eq!(search_band("doom", "Legend of Doom"), 0.85);
    }

    #[test]
    fn band_handles_year_marker_and_subtitle() {
        assert!(search_band("Prototype (2009)", "Prototype") >= 0.9);
        assert!(search_band("phantom liberty", "Cyberpunk 2077: Phantom Liberty") >= 0.85);
    }

    #[test]
    fn band_does_not_grant_partial_word_prefix() {
        // "doo" is a strict string prefix of "doom" but not a word prefix, so
        // it should not reach the prefix band.
        assert!(search_band("doo", "Doom") < 0.9);
    }

    #[test]
    fn doom_query_ranks_exact_ahead_of_prefix() {
        let out = rank_search_candidates(
            "doom",
            vec![
                fixture(1, "Doom Eternal", Some(0), Some(2020), Some(88.0), Some(5000)),
                fixture(2, "Doom", Some(0), Some(2016), Some(85.0), Some(4000)),
                fixture(3, "Legend of Doom", Some(0), Some(2010), Some(70.0), Some(100)),
            ],
        );
        assert_eq!(out[0].name, "Doom");
        assert!(
            out.iter().any(|g| g.name == "Doom Eternal"),
            "the prefix hit must survive the noise floor"
        );
    }

    #[test]
    fn main_game_outranks_matching_dlc() {
        let out = rank_search_candidates(
            "cyberpunk",
            vec![
                fixture(1, "Cyberpunk 2077: Phantom Liberty", Some(1), Some(2023), Some(90.0), Some(9000)),
                fixture(2, "Cyberpunk 2077", Some(0), Some(2020), Some(86.0), Some(8000)),
            ],
        );
        assert_eq!(out[0].name, "Cyberpunk 2077");
    }

    #[test]
    fn exact_dlc_lookup_is_kept() {
        let out = rank_search_candidates(
            "phantom liberty",
            vec![
                fixture(1, "Cyberpunk 2077: Phantom Liberty", Some(1), Some(2023), Some(90.0), Some(9000)),
                fixture(2, "Cyberpunk 2077", Some(0), Some(2020), Some(86.0), Some(8000)),
            ],
        );
        assert!(out.iter().any(|g| g.name == "Cyberpunk 2077: Phantom Liberty"));
    }

    #[test]
    fn weak_mods_and_prototypes_are_dropped() {
        let out = rank_search_candidates(
            "doom eternal",
            vec![
                fixture(1, "Eternal Doom Mod", Some(5), Some(2016), None, Some(10)),
                fixture(2, "Eternal Doom Prototype", Some(14), Some(2015), None, Some(5)),
                fixture(3, "Eternal Doom Side Story", Some(0), Some(2016), None, Some(20)),
            ],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Eternal Doom Side Story");
    }

    #[test]
    fn noise_floor_keeps_weak_only_pools() {
        let all_weak = rank_search_candidates(
            "doom eternal",
            vec![
                fixture(1, "Legend of Doom", Some(0), Some(2010), None, None),
                fixture(2, "Doom 3", Some(0), Some(2004), None, None),
            ],
        );
        assert_eq!(
            all_weak.len(),
            2,
            "an obscure but real title must not be filtered down to nothing"
        );
    }

    #[test]
    fn noise_floor_prunes_weak_candidates_when_a_strong_hit_exists() {
        let out = rank_search_candidates(
            "doom eternal",
            vec![
                fixture(1, "Legend of Doom", Some(0), Some(2010), None, None),
                fixture(2, "Doom 3", Some(0), Some(2004), None, None),
                fixture(3, "Doom Eternal", Some(0), Some(2020), Some(88.0), Some(9000)),
            ],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Doom Eternal");
    }

    #[test]
    fn dedup_keeps_same_title_in_different_years() {
        let out = rank_search_candidates(
            "prey",
            vec![
                fixture(1, "Prey", Some(0), Some(2006), Some(80.0), Some(1000)),
                fixture(2, "Prey", Some(0), Some(2017), Some(79.0), Some(2000)),
                fixture(3, "Prey", Some(0), Some(2017), Some(60.0), Some(50)),
            ],
        );
        assert_eq!(out.len(), 2, "Prey (2006) and Prey (2017) must both survive");
        let years: Vec<String> = out
            .iter()
            .map(|g| format_unix_timestamp(g.first_release_date.unwrap())[..4].to_string())
            .collect();
        assert!(years.contains(&"2006".to_string()));
        assert!(years.contains(&"2017".to_string()));
    }

    #[test]
    fn relevance_mode_detection() {
        assert!(is_relevance_mode(None));
        assert!(is_relevance_mode(Some("default")));
        assert!(!is_relevance_mode(Some("name")));
        assert!(!is_relevance_mode(Some("popularity")));
    }

    #[test]
    fn pagination_slices_one_pool_without_overlap() {
        let pool: Vec<u64> = (0..50).collect();
        let p1 = paginate_pool(pool.clone(), 0, 20);
        let p2 = paginate_pool(pool.clone(), 20, 20);
        let p3 = paginate_pool(pool.clone(), 40, 20);
        let p4 = paginate_pool(pool, 60, 20);
        assert_eq!((p1.len(), p2.len(), p3.len(), p4.len()), (20, 20, 10, 0));

        let mut all: Vec<u64> = p1.into_iter().chain(p2).chain(p3).collect();
        let before = all.len();
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), before, "pages must not overlap");
    }
}
