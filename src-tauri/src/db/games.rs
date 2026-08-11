// level allow keeps the public API stable for future callers.
#![allow(dead_code)]

//! Games DAO.
//!
//! One row per library game. Many optional `GameData` fields collapse
//! into compact-JSON columns; reads/writes marshal via `serde_json`.
//!
//! Every `?` after a rusqlite call routes through
//! `.map_err(|e| e.to_string())?`. Closes compile-blocking E0277
//! without changing the public `Result<T, String>` API.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::pool::Db;

// DAO functions are part of the public storage-migration API surface
// — getters/deleters (`get`, `delete`, `delete_many`) are kept on
// stand-by for upcoming bulk-edit and sync-conflict paths. Module-
/// Subset of `lib.rs::GameData` we persist via the DAO. Mirrors the
/// frontend's `Game` shape after serde camelCase rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub platform: String,
    pub installed: bool,
    pub play_time: String,
    pub added_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_url: Option<String>,
    /// Original public https URL the cover was downloaded from (mirrors
    /// lib.rs `GameData::cover_source_url`). Lets Discord Rich Presence
    /// show the poster — base64 `cover_art_url` can't be fetched by
    /// Discord's media proxy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_detected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
    /// Path of the game's linked mods folder (None = no mods tracked).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods_folder: Option<String>,
    /// On-disk footprint of `mods_folder` in bytes, folded into the game's
    /// total (game + mods) reported by the Storage tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods_size_bytes: Option<u64>,
    /// ISO-8601 timestamp of the last mods-folder measurement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods_detected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storyline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_playtime: Option<u32>,
    // ── GOG Galaxy integration columns (v2 migration) ──
    /// GOG product id (stringified int, e.g. `"1207658925"`). Drives
    /// the dedup key on `gog_sync_library` and the gog-`{id}` slug
    /// used by the Library page's GameRelationsCard. Stored as
    /// `String` because `api.gog.com/products` returns IDs as both
    /// integers and strings depending on the endpoint, and we want
    /// lossless round-trips through serde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gog_game_id: Option<String>,
    /// Playtime in MINUTES, sourced from
    /// `https://gameplay.gog.com/clients/<user_id>/playtime`.
    /// Persisted on sync so a sync-less reload still surfaces the
    /// correct playtime in the Library page's play-time column.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gog_playtime: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epic_namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epic_catalog_item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_as_admin: Option<bool>,
    /// When true, launching this Steam game goes through Steam's
    /// launch-action picker (`steam://launch/<appid>/dialog`) so games
    /// with multiple launch actions offer a choose-executable window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_steam_launch_selection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_launch_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_launch_admin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_exit_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_exit_admin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub companion_apps: Option<Vec<serde_json::Value>>,
    // ── Emulation linkage (v2 migration) ──
    /// Id of the owning emulator instance. Lets `delete_emulator`
    /// cascade-remove its ROMs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emulator_id: Option<String>,
    /// Absolute path to the ROM file handed to the emulator as a
    /// launch argument.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rom_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genres: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_perspectives: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub videos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_to_beat: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similar_games: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub releases: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_reviews: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternative_names: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_achievements: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_supports: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub franchise: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_status: Option<String>,
}

/// Bulk upsert: replace the entire library with `rows`. Wrapped in
/// one transaction so we never have a partial library on disk.
pub fn upsert_all(db: &Db, rows: &[GameRow]) -> Result<(), String> {
    let mut conn = db.games().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM games", [])
        .map_err(|e| format!("games delete: {e}"))?;
    let mut stmt = tx
        .prepare(
            "INSERT INTO games(
                 id, name, path, platform, installed, play_time, added_at,
                 cover_art_url, notes, size_bytes, size_detected_at, size_root_path,
                 icon_url, banner_url, logo_url,
                description, developer, publisher, release_date,
                metadata_source, metadata_url, storyline, igdb_rating, critic_rating,
                steam_app_id, steam_playtime, store_source,
                epic_namespace, epic_catalog_item_id, launch_arguments, run_as_admin,
                last_played, play_status,
                genres_json, themes_json, game_modes_json, player_perspectives_json,
                screenshots_json, videos_json, websites_json,
                time_to_beat_json, similar_games_json, releases_json,
                igdb_reviews_json, alternative_names_json, steam_achievements_json,
                language_supports_json,
                collection, franchise, game_category, release_status,
                gog_game_id, gog_playtime,
                 pre_launch_script, pre_launch_admin, post_exit_script, post_exit_admin,
                 companion_apps_json,
                 mods_folder, mods_size_bytes, mods_detected_at,
                 cover_source_url,
                 show_steam_launch_selection
             ) VALUES (
                 ?1,?2,?3,?4,?5,?6,?7,
                 ?8,?9,?10,?11,?12,
                 ?13,?14,?15,
                 ?16,?17,?18,?19,
                 ?20,?21,?22,?23,?24,
                 ?25,?26,?27,
                 ?28,?29,?30,?31,
                 ?32,?33,
                 ?34,?35,?36,?37,
                 ?38,?39,?40,
                 ?41,?42,?43,
                 ?44,?45,?46,
                 ?47,
                 ?48,?49,?50,?51,
                 ?52,?53,
                 ?54,?55,?56,?57,
                 ?58,
                 ?59,?60,?61,?62,
                 ?63
             )",
        )
        .map_err(|e| format!("games prepare: {e}"))?;
    for (i, r) in rows.iter().enumerate() {
        stmt.execute(params![
            r.id,
            r.name,
            r.path,
            r.platform,
            r.installed as i32,
            r.play_time,
            r.added_at as i64,
            r.cover_art_url,
            r.notes,
            r.size_bytes.map(|n| n as i64),
            r.size_detected_at,
            r.size_root_path,
            r.icon_url,
            r.banner_url,
            r.logo_url,
            r.description,
            r.developer,
            r.publisher,
            r.release_date,
            r.metadata_source,
            r.metadata_url,
            r.storyline,
            r.igdb_rating,
            r.critic_rating,
            r.steam_app_id,
            r.steam_playtime,
            r.store_source,
            r.epic_namespace,
            r.epic_catalog_item_id,
            r.launch_arguments,
            r.run_as_admin.map(|b| b as i32),
            // NOTE: params below MUST follow the INSERT column list order
            // above (last_played, play_status, the JSON columns, then the
            // v2 gog columns, then the v5 launch-orchestration columns and
            // companion_apps LAST). The struct-field order differs, so a
            // naive field-order binding silently wrote every value from
            // position 32 onward into the wrong column — last_played,
            // play_status, genres, screenshots, etc. all round-tripped as
            // NULL/garbage and appeared to "not persist".
            r.last_played,
            r.play_status,
            json_opt(&r.genres),
            json_opt(&r.themes),
            json_opt(&r.game_modes),
            json_opt(&r.player_perspectives),
            json_opt(&r.screenshots),
            json_opt(&r.videos),
            json_opt(&r.websites),
            json_opt(&r.time_to_beat),
            json_opt(&r.similar_games),
            json_opt(&r.releases),
            json_opt(&r.igdb_reviews),
            json_opt(&r.alternative_names),
            json_opt(&r.steam_achievements),
            json_opt(&r.language_supports),
            r.collection,
            r.franchise,
            r.game_category,
            r.release_status,
            // v2 migration columns — NULL when the row pre-dates the
            // GOG integration (i.e. the user upgraded an existing
            // library). The GameRow struct's Option-typed fields
            // handle the NULL path uniformly.
            r.gog_game_id,
            r.gog_playtime,
            // v5 launch-orchestration columns (LAST in the column list).
            r.pre_launch_script,
            r.pre_launch_admin.map(|b| b as i32),
            r.post_exit_script,
            r.post_exit_admin.map(|b| b as i32),
            json_opt(&r.companion_apps),
            r.mods_folder,
            r.mods_size_bytes.map(|n| n as i64),
            r.mods_detected_at,
            r.cover_source_url,
            r.show_steam_launch_selection.map(|b| b as i32),
        ])
        .map_err(|e| format!("games insert {i}: {e}"))?;
        persist_emulation_link(&tx, &r.id, &r.emulator_id, &r.rom_path)?;
    }
    drop(stmt);
    tx.commit().map_err(|e| format!("games commit: {e}"))?;
    Ok(())
}

/// Upsert a SINGLE game row without touching the rest of the library.
///
/// Used by the metadata-enrichment path: when the library-card
/// observer fetches a cover/banner/logo during a scroll we persist
/// that one game immediately, rather than waiting for the debounced
/// full-library `save_games` (which can be lost if the app closes
/// mid-scroll, and which races when many enrichments fire at once).
///
/// `INSERT OR REPLACE` keys on the `id` PRIMARY KEY. `steam_app_id`
/// is `UNIQUE`, but a row being re-saved carries its own appid, so no
/// sibling row is affected.
pub fn upsert_one(db: &Db, r: &GameRow) -> Result<(), String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO games(
            id, name, path, platform, installed, play_time, added_at,
            cover_art_url, notes, size_bytes, size_detected_at, size_root_path,
            icon_url, banner_url, logo_url,
            description, developer, publisher, release_date,
            metadata_source, metadata_url, storyline, igdb_rating, critic_rating,
            steam_app_id, steam_playtime, store_source,
            epic_namespace, epic_catalog_item_id, launch_arguments, run_as_admin,
            last_played, play_status,
            genres_json, themes_json, game_modes_json, player_perspectives_json,
            screenshots_json, videos_json, websites_json,
            time_to_beat_json, similar_games_json, releases_json,
            igdb_reviews_json, alternative_names_json, steam_achievements_json,
            language_supports_json,
            collection, franchise, game_category, release_status,
            gog_game_id, gog_playtime,
            pre_launch_script, pre_launch_admin, post_exit_script, post_exit_admin,
            companion_apps_json,
            mods_folder, mods_size_bytes, mods_detected_at,
            cover_source_url,
            show_steam_launch_selection
        ) VALUES (
            ?1,?2,?3,?4,?5,?6,?7,
            ?8,?9,?10,?11,?12,
            ?13,?14,?15,
            ?16,?17,?18,?19,
            ?20,?21,?22,?23,?24,
            ?25,?26,?27,
            ?28,?29,?30,?31,
            ?32,?33,
            ?34,?35,?36,?37,
            ?38,?39,?40,
            ?41,?42,?43,
            ?44,?45,?46,
            ?47,
            ?48,?49,?50,?51,
            ?52,?53,
            ?54,?55,?56,?57,
            ?58,
            ?59,?60,?61,?62,
            ?63
        )",
        params![
            r.id,
            r.name,
            r.path,
            r.platform,
            r.installed as i32,
            r.play_time,
            r.added_at as i64,
            r.cover_art_url,
            r.notes,
            r.size_bytes.map(|n| n as i64),
            r.size_detected_at,
            r.size_root_path,
            r.icon_url,
            r.banner_url,
            r.logo_url,
            r.description,
            r.developer,
            r.publisher,
            r.release_date,
            r.metadata_source,
            r.metadata_url,
            r.storyline,
            r.igdb_rating,
            r.critic_rating,
            r.steam_app_id,
            r.steam_playtime,
            r.store_source,
            r.epic_namespace,
            r.epic_catalog_item_id,
            r.launch_arguments,
            r.run_as_admin.map(|b| b as i32),
            // Column-list order (see upsert_all for the alignment note).
            r.last_played,
            r.play_status,
            json_opt(&r.genres),
            json_opt(&r.themes),
            json_opt(&r.game_modes),
            json_opt(&r.player_perspectives),
            json_opt(&r.screenshots),
            json_opt(&r.videos),
            json_opt(&r.websites),
            json_opt(&r.time_to_beat),
            json_opt(&r.similar_games),
            json_opt(&r.releases),
            json_opt(&r.igdb_reviews),
            json_opt(&r.alternative_names),
            json_opt(&r.steam_achievements),
            json_opt(&r.language_supports),
            r.collection,
            r.franchise,
            r.game_category,
            r.release_status,
            r.gog_game_id,
            r.gog_playtime,
            r.pre_launch_script,
            r.pre_launch_admin.map(|b| b as i32),
            r.post_exit_script,
            r.post_exit_admin.map(|b| b as i32),
            json_opt(&r.companion_apps),
            r.mods_folder,
            r.mods_size_bytes.map(|n| n as i64),
            r.mods_detected_at,
            r.cover_source_url,
            r.show_steam_launch_selection.map(|b| b as i32),
        ],
    )
    .map_err(|e| format!("games upsert_one: {e}"))?;
    persist_emulation_link(&conn, &r.id, &r.emulator_id, &r.rom_path)?;
    Ok(())
}

/// Hot-path: bump one game's `last_played` without rewriting the
/// rest of the row or the whole library.
pub fn update_last_played(db: &Db, game_id: &str, last_played_ms: u64) -> Result<(), String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE games SET last_played = ?1 WHERE id = ?2",
        params![last_played_ms, game_id],
    )
    .map_err(|e| format!("games last_played: {e}"))?;
    Ok(())
}

/// Read every game, in Continue-Playing-friendly order.
pub fn list_all(db: &Db) -> Result<Vec<GameRow>, String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(GAMES_SELECT_SQL)
        .map_err(|e| format!("games list prepare: {e}"))?;
    let rows = stmt
        .query_map([], game_row_from_row)
        .map_err(|e| format!("games list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("games row: {e}"))?);
    }
    Ok(out)
}

/// Read a single game by id.
pub fn get(db: &Db, id: &str) -> Result<Option<GameRow>, String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(format!("{GAMES_SELECT_SQL} WHERE id = ?1").as_str())
        .map_err(|e| format!("games get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|e| format!("games get query: {e}"))?;
    if let Some(r) = rows.next().map_err(|e| format!("games get row: {e}"))? {
        return Ok(Some(
            game_row_from_row(r).map_err(|e| format!("games get decode: {e}"))?,
        ));
    }
    Ok(None)
}

/// Delete a game by id.
pub fn delete(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM games WHERE id = ?1", params![id])
        .map_err(|e| format!("games delete: {e}"))?;
    Ok(())
}

/// Bulk delete (used by `removeGames`/bulk operations).
pub fn delete_many(db: &Db, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut conn = db.games().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut stmt = tx
        .prepare("DELETE FROM games WHERE id = ?1")
        .map_err(|e| format!("games delete_many prepare: {e}"))?;
    for id in ids {
        stmt.execute(params![id])
            .map_err(|e| format!("games delete_many {id}: {e}"))?;
    }
    drop(stmt);
    tx.commit().map_err(|e| format!("games delete_many commit: {e}"))?;
    Ok(())
}

/// Delete every game tied to a given emulator instance (cascade when an
/// emulator is removed).
pub fn delete_by_emulator(db: &Db, emulator_id: &str) -> Result<(), String> {
    let conn = db.games().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM games WHERE emulator_id = ?1",
        params![emulator_id],
    )
    .map_err(|e| format!("games delete_by_emulator: {e}"))?;
    Ok(())
}

const GAMES_SELECT_SQL: &str = "SELECT id, name, path, platform, installed, play_time, added_at, cover_art_url, notes, size_bytes, size_detected_at, size_root_path, icon_url, banner_url, logo_url, description, developer, publisher, release_date, metadata_source, metadata_url, storyline, igdb_rating, critic_rating, steam_app_id, steam_playtime, store_source, epic_namespace, epic_catalog_item_id, launch_arguments, run_as_admin, last_played, play_status, genres_json, themes_json, game_modes_json, player_perspectives_json, screenshots_json, videos_json, websites_json, time_to_beat_json, similar_games_json, releases_json, igdb_reviews_json, alternative_names_json, steam_achievements_json, language_supports_json, collection, franchise, game_category, release_status, gog_game_id, gog_playtime, pre_launch_script, pre_launch_admin, post_exit_script, post_exit_admin, companion_apps_json, emulator_id, rom_path, mods_folder, mods_size_bytes, mods_detected_at, cover_source_url, show_steam_launch_selection FROM games";

fn game_row_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<GameRow> {
    Ok(GameRow {
        id: r.get(0)?,
        name: r.get(1)?,
        path: r.get(2)?,
        platform: r.get(3)?,
        installed: r.get::<_, i64>(4)? != 0,
        play_time: r.get(5)?,
        added_at: r.get::<_, i64>(6)? as u64,
        cover_art_url: r.get(7)?,
        notes: r.get(8)?,
        size_bytes: r.get::<_, Option<i64>>(9)?.map(|n| n as u64),
        size_detected_at: r.get(10)?,
        size_root_path: r.get(11)?,
        icon_url: r.get(12)?,
        banner_url: r.get(13)?,
        logo_url: r.get(14)?,
        description: r.get(15)?,
        developer: r.get(16)?,
        publisher: r.get(17)?,
        release_date: r.get(18)?,
        metadata_source: r.get(19)?,
        metadata_url: r.get(20)?,
        storyline: r.get(21)?,
        igdb_rating: r.get(22)?,
        critic_rating: r.get(23)?,
        steam_app_id: r.get(24)?,
        steam_playtime: r.get(25)?,
        store_source: r.get(26)?,
        epic_namespace: r.get(27)?,
        epic_catalog_item_id: r.get(28)?,
        launch_arguments: r.get(29)?,
        run_as_admin: r.get::<_, Option<i64>>(30)?.map(|n| n != 0),
        last_played: r.get(31)?,
        play_status: r.get(32)?,
        genres: json_opt_get(r, 33)?,
        themes: json_opt_get(r, 34)?,
        game_modes: json_opt_get(r, 35)?,
        player_perspectives: json_opt_get(r, 36)?,
        screenshots: json_opt_get(r, 37)?,
        videos: json_opt_get(r, 38)?,
        websites: json_opt_get(r, 39)?,
        time_to_beat: json_opt_get(r, 40)?,
        similar_games: json_opt_get(r, 41)?,
        releases: json_opt_get(r, 42)?,
        igdb_reviews: json_opt_get(r, 43)?,
        alternative_names: json_opt_get(r, 44)?,
        steam_achievements: json_opt_get(r, 45)?,
        language_supports: json_opt_get(r, 46)?,
        collection: r.get(47)?,
        franchise: r.get(48)?,
        game_category: r.get(49)?,
        release_status: r.get(50)?,
        // v2 migration columns — read past the original 51 columns.
        // `rusqlite::Row::get` returns `Ok(None)` for a NULL TEXT /
        // NULL INTEGER cell with the requested `Option<String>` /
        // `Option<u32>` target, so a pre-v2 row reads back with both
        // fields `None` and silently adopts the new shape.
        gog_game_id: r.get(51)?,
        gog_playtime: r.get::<_, Option<i64>>(52)?.map(|n| n as u32),
        // v5 migration columns — read past the original 53 columns.
        pre_launch_script: r.get(53)?,
        pre_launch_admin: r.get::<_, Option<i64>>(54)?.map(|n| n != 0),
        post_exit_script: r.get(55)?,
        post_exit_admin: r.get::<_, Option<i64>>(56)?.map(|n| n != 0),
        companion_apps: json_opt_get(r, 57)?,
        // v2 migration columns — read after the original 58 columns.
        emulator_id: r.get(58)?,
        rom_path: r.get(59)?,
        // v3 migration columns — mods-tracking, read after rom_path.
        mods_folder: r.get(60)?,
        mods_size_bytes: r.get::<_, Option<i64>>(61)?.map(|n| n as u64),
        mods_detected_at: r.get(62)?,
        // v4 migration column — read after the original 63 columns.
        // NULL rows (pre-v4) read back as `None`.
        cover_source_url: r.get(63)?,
        // v5 migration column — read after the original 64 columns.
        // NULL rows (pre-v5) read back as `None`.
        show_steam_launch_selection: r.get::<_, Option<i64>>(64)?.map(|n| n != 0),
    })
}

/// Persist the emulation-linkage columns (`emulator_id`, `rom_path`)
/// for an already-inserted game row. Kept separate from the 58-column
/// bulk INSERT so the legacy positional binding stays untouched.
fn persist_emulation_link(
    conn: &rusqlite::Connection,
    id: &str,
    emulator_id: &Option<String>,
    rom_path: &Option<String>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE games SET emulator_id = ?1, rom_path = ?2 WHERE id = ?3",
        params![emulator_id, rom_path, id],
    )
    .map_err(|e| format!("games persist_emulation_link: {e}"))?;
    Ok(())
}

fn json_opt<T: serde::Serialize>(v: &Option<T>) -> Option<String> {
    v.as_ref()
        .and_then(|x| serde_json::to_string(x).ok())
}

fn json_opt_get<T: serde::de::DeserializeOwned>(
    r: &rusqlite::Row<'_>,
    idx: usize,
) -> rusqlite::Result<Option<T>> {
    let s: Option<String> = r.get(idx)?;
    Ok(s.and_then(|raw| serde_json::from_str(&raw).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{GAMES_DDL, GAMES_V2_DDL, GAMES_V3_DDL, GAMES_V4_DDL, GAMES_V5_DDL, EMULATORS_DDL};
    use serde_json::json;

    fn test_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        {
            let conn = db.games().unwrap();
            conn.execute_batch(GAMES_DDL).unwrap();
            conn.execute_batch(GAMES_V2_DDL).unwrap();
            conn.execute_batch(GAMES_V3_DDL).unwrap();
            conn.execute_batch(GAMES_V4_DDL).unwrap();
            conn.execute_batch(GAMES_V5_DDL).unwrap();
        }
        (dir, db)
    }

    fn sample_row() -> GameRow {
        serde_json::from_value(json!({
            "id": "g1",
            "name": "Test Game",
            "path": "",
            "platform": "GOG",
            "installed": true,
            "playTime": "3h",
            "addedAt": 111u64,
            "coverArtUrl": "data:image/png;base64,AAAA",
            "coverSourceUrl": "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
            "bannerUrl": "data:image/png;base64,BBBB",
            "logoUrl": "data:image/png;base64,CCCC",
            "lastPlayed": 1700000000000u64,
            "playStatus": "playing",
            "genres": ["Action", "RPG"],
            "screenshots": ["s1", "s2"],
            "companionApps": [{"name": "overlay"}],
            "preLaunchScript": "echo hi",
            "showSteamLaunchSelection": true,
        }))
        .unwrap()
    }

    /// Regression: every field must round-trip through the exact column
    /// it belongs to. A prior bug bound `params!` in struct-field order
    /// while the INSERT column list used a different order, so everything
    /// from `last_played` onward (play_status, genres, screenshots, ...)
    /// silently landed in the wrong column and read back as NULL.
    #[test]
    fn upsert_one_round_trips_all_columns() {
        let (_dir, db) = test_db();
        let row = sample_row();
        upsert_one(&db, &row).unwrap();

        let got = get(&db, "g1").unwrap().expect("row should exist");
        assert_eq!(got.cover_art_url.as_deref(), Some("data:image/png;base64,AAAA"));
        assert_eq!(got.cover_source_url.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg"));
        assert_eq!(got.last_played, Some(1700000000000));
        assert_eq!(got.play_status.as_deref(), Some("playing"));
        assert_eq!(got.genres, Some(vec!["Action".into(), "RPG".into()]));
        assert_eq!(got.screenshots, Some(vec!["s1".into(), "s2".into()]));
        assert_eq!(got.pre_launch_script.as_deref(), Some("echo hi"));
        assert_eq!(got.show_steam_launch_selection, Some(true));
        assert!(got.companion_apps.is_some());
    }

    /// Same alignment guarantee for the full-library `upsert_all` path.
    #[test]
    fn upsert_all_round_trips_all_columns() {
        let (_dir, db) = test_db();
        upsert_all(&db, &[sample_row()]).unwrap();

        let all = list_all(&db).unwrap();
        assert_eq!(all.len(), 1);
        let got = &all[0];
        assert_eq!(got.last_played, Some(1700000000000));
        assert_eq!(got.play_status.as_deref(), Some("playing"));
        assert_eq!(got.genres, Some(vec!["Action".into(), "RPG".into()]));
        assert_eq!(got.screenshots, Some(vec!["s1".into(), "s2".into()]));
        assert_eq!(got.pre_launch_script.as_deref(), Some("echo hi"));
        assert_eq!(got.show_steam_launch_selection, Some(true));
    }
}
