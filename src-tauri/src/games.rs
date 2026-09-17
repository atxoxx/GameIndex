//! Library persistence + the shared `GameData` serde model.

use tauri::Manager;
use serde::{Deserialize, Deserializer, Serialize};
use crate::db;
use crate::game_scraper::{IgdbReview, LanguageSupportInfo, ReleaseDateInfo, SimilarGame, TimeToBeat};
use crate::launcher::CompanionApp;
use std::collections::HashSet;

/// Serializable game data matching the frontend Game type.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameData {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) platform: String,
    pub(crate) installed: bool,
    pub(crate) play_time: String,
    pub(crate) added_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cover_art_url: Option<String>,
    /// Original public https URL the cover was downloaded from — kept
    /// so the frontend can show the game poster in Discord Rich
    /// Presence (Discord fetches images server-side; the base64
    /// `cover_art_url` data URI can't be fetched). `default` keeps
    /// older payloads deserializing cleanly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cover_source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) notes: Option<String>,
    /// Total disk footprint of the game's root folder in bytes (None = not yet measured).
    /// `default` is required so older `games.json` payloads (without these
    /// fields) deserialize cleanly instead of erroring out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) size_bytes: Option<u64>,
    /// ISO-8601 timestamp of the last successful size detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) size_detected_at: Option<String>,
    /// Path of the folder the size was measured against. Auditable from the
    /// size-edit modal so users can see (and override) the root we summed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) size_root_path: Option<String>,
    /// Path of the game's linked mods folder (None = no mods tracked).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mods_folder: Option<String>,
    /// On-disk footprint of `mods_folder` in bytes, folded into the game's
    /// total (game + mods) reported by the Storage tab.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mods_size_bytes: Option<u64>,
    /// ISO-8601 timestamp of the last mods-folder measurement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mods_detected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) banner_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) genres: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) metadata_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) metadata_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) storyline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) igdb_rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) critic_rating: Option<f64>,
    /// Numeric IGDB game id (`IgdbGame.id`) persisted as a stable
    /// identity key — it survives deletion so the Activity page can
    /// still identify removed titles. `None` = no IGDB match at import.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) igdb_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) themes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) game_modes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) player_perspectives: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) screenshots: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) videos: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) websites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) time_to_beat: Option<TimeToBeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) similar_games: Option<Vec<SimilarGame>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) releases: Option<Vec<ReleaseDateInfo>>,
    #[serde(
        default,
        deserialize_with = "deserialize_tolerant_igdb_reviews",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) igdb_reviews: Option<Vec<IgdbReview>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) alternative_names: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) collection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) franchise: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) game_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) release_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) steam_app_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) steam_playtime: Option<u32>,
    // â”€â”€ GOG Galaxy integration fields â”€â”€
    /// GOG numeric product id (e.g. `"1207658925"`). Stored as
    /// `String` because `api.gog.com/products` returns IDs as both
    /// ints and strings depending on the endpoint, and we want
    /// lossless round-trips through serde.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) gog_game_id: Option<String>,
    /// Playtime in minutes, sourced from
    /// `https://gameplay.gog.com/clients/<user_id>/playtime`.
    /// Optional: missing on first sync or when the gameplay endpoint
    /// 403s on a private account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) gog_playtime: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) steam_achievements: Option<Vec<SteamAchievementSerde>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) language_supports: Option<Vec<LanguageSupportInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) store_source: Option<String>,
    // Epic Games Store integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) epic_namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) epic_catalog_item_id: Option<String>,
    // Humble Bundle integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) humble_game_id: Option<String>,
    /// True when sourced from the Humble Trove catalog (subscriber
    /// streaming library) — drives `humble://launch/` behaviour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) humble_is_trove: Option<bool>,
    /// True when this entry is a non-game extra (soundtrack/artbook/…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) humble_is_extra: Option<bool>,
    // Ubisoft Connect integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) uplay_game_id: Option<String>,
    /// `true` when the game was installed/launched via Ubisoft Connect
    /// (drives `uplay://launch/<id>` behaviour).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) uplay_is_connect: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) launch_arguments: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) run_as_admin: Option<bool>,
    /// When true, launching this Steam game goes through Steam's
    /// launch-action picker (`steam://launch/<appid>/dialog`) so games
    /// with multiple launch actions offer a choose-executable window.
    /// Defaults to the plain `steam://run/<appid>` path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) show_steam_launch_selection: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pre_launch_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pre_launch_admin: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) post_exit_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) post_exit_admin: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) companion_apps: Option<Vec<CompanionApp>>,
    /// Unix-millisecond timestamp of when the user most recently exited a
    /// session for this game. `None` until the first session ends. Used by
    /// the Library page's "Continue Playing" rail to surface recently-active
    /// titles. Persisted via the existing `save_games` round-trip â€” no
    /// separate write path needed. `default` keeps older `games.json` files
    /// (which predate this field) deserializing cleanly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_played: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) play_status: Option<String>,
    // ── Emulation linkage ──
    /// Id of the owning emulator instance when this row is a scanned
    /// ROM. Lets the backend cascade-delete ROMs when the emulator is
    /// removed, and lets the frontend show a console badge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) emulator_id: Option<String>,
    /// Absolute path to the ROM file handed to the emulator as a
    /// launch argument.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_path: Option<String>,
    // ── ROM management fields (v7 migration) ──
    /// Quick hash of the ROM file used for duplicate detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_hash: Option<String>,
    /// Region tag parsed from the filename (No-Intro style).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_region: Option<String>,
    /// Language tag parsed from the filename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_language: Option<String>,
    /// Multi-disc group key (cleaned shared title).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_group: Option<String>,
    /// 1-based disc index for multi-disc sets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_disc: Option<u32>,
    /// True when the ROM file is an archive needing extraction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_archived: Option<bool>,
    /// User flag: favorite ROM.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) favorite: Option<bool>,
    /// Personal compatibility notes ("use Vulkan", "requires BIOS").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) compat_notes: Option<String>,
    /// Per-ROM launch profile overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rom_profile: Option<RomProfile>,
    /// Game version string (user-edited or auto-detected).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) version: Option<String>,
    /// Wine / Proton compatibility profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) compatibility: Option<serde_json::Value>,
}

/// Per-ROM emulator launch profile. Every field is optional — an
/// unset field falls back to the owning emulator's default (template
/// arguments, fullscreen flag, …). Persisted as a JSON object in the
/// `games.rom_profile` column; the frontend edits it in the ROM
/// detail modal.
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RomProfile {
    /// Full launch-argument string. When set, REPLACES the emulator's
    /// `arguments_template` for this ROM (the `%ROM%` placeholder is
    /// still substituted).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) arguments_override: Option<String>,
    /// Graphics backend, e.g. `vulkan` / `opengl` / `direct3d11`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) graphics_backend: Option<String>,
    /// Preferred internal resolution, e.g. `1080p` / `4x` / `native`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolution: Option<String>,
    /// Controller layout name, e.g. `default`, `xbox`, `ps`, or a
    /// custom per-ROM mapping id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) controller_layout: Option<String>,
    /// Shader preset name, e.g. `crt-royale`, `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) shaders: Option<String>,
    /// Force fullscreen for this ROM.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fullscreen: Option<bool>,
    /// Extra per-ROM launch environment variables (`KEY=VALUE`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) env_vars: Option<Vec<String>>,
}

/// Serializable Steam achievement for the GameData struct.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamAchievementSerde {
    pub(crate) apiname: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) achieved: bool,
    pub(crate) unlocktime: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) icongray: Option<String>,
}

/// Tolerant deserializer for `GameData::igdb_reviews`.
///
/// A handful of legacy game rows stored a raw URL string (e.g. a
/// YouTube link) inside the `igdb_reviews` array instead of an
/// `IgdbReview` object. Deserializing that naively into
/// `Vec<IgdbReview>` aborts the *entire* library load. This keeps only
/// the elements that actually parse as `IgdbReview`, dropping the
/// malformed ones so the game still loads — and self-heals on the
/// next save (which re-serializes only the good reviews).
fn deserialize_tolerant_igdb_reviews<'de, D>(
    d: D,
) -> Result<Option<Vec<IgdbReview>>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = Option::<Vec<serde_json::Value>>::deserialize(d)?;
    match raw {
        None => Ok(None),
        Some(values) => {
            let mut out = Vec::with_capacity(values.len());
            for v in values {
                if let Ok(review) = serde_json::from_value::<IgdbReview>(v) {
                    out.push(review);
                }
            }
            if out.is_empty() {
                Ok(None)
            } else {
                Ok(Some(out))
            }
        }
    }
}

/// Direct `GameData` -> `GameRow` conversion for the write path.
///
/// The serde round-trip (`GameData` -> `Value` -> `GameRow`) copied every
/// field — including multi-MB artwork strings — into a `Value` tree before
/// the row existed, and the DAO then serialized the row again to
/// fingerprint it. Both structs mirror the same camelCase shape, so they
/// convert field-for-field instead: artwork strings move, and the row is
/// serialized exactly once, for its content hash. The struct literals are
/// exhaustive, so a new column is a compile error rather than a silently
/// dropped field.
///
/// Non-finite ratings are dropped to keep the old JSON round-trip's
/// behaviour: a NaN serialized as `null` and read back as `None`.
impl From<GameData> for db::games::GameRow {
    fn from(g: GameData) -> Self {
        db::games::GameRow {
            id: g.id,
            name: g.name,
            path: g.path,
            platform: g.platform,
            installed: g.installed,
            play_time: g.play_time,
            added_at: g.added_at,
            cover_art_url: g.cover_art_url,
            cover_source_url: g.cover_source_url,
            notes: g.notes,
            size_bytes: g.size_bytes,
            size_detected_at: g.size_detected_at,
            size_root_path: g.size_root_path,
            mods_folder: g.mods_folder,
            mods_size_bytes: g.mods_size_bytes,
            mods_detected_at: g.mods_detected_at,
            icon_url: g.icon_url,
            banner_url: g.banner_url,
            logo_url: g.logo_url,
            description: g.description,
            developer: g.developer,
            publisher: g.publisher,
            release_date: g.release_date,
            metadata_source: g.metadata_source,
            metadata_url: g.metadata_url,
            storyline: g.storyline,
            igdb_rating: g.igdb_rating.filter(|v| v.is_finite()),
            critic_rating: g.critic_rating.filter(|v| v.is_finite()),
            igdb_id: g.igdb_id.map(|v| v as i64),
            steam_app_id: g.steam_app_id,
            steam_playtime: g.steam_playtime,
            gog_game_id: g.gog_game_id,
            gog_playtime: g.gog_playtime,
            store_source: g.store_source,
            epic_namespace: g.epic_namespace,
            epic_catalog_item_id: g.epic_catalog_item_id,
            launch_arguments: g.launch_arguments,
            run_as_admin: g.run_as_admin,
            show_steam_launch_selection: g.show_steam_launch_selection,
            pre_launch_script: g.pre_launch_script,
            pre_launch_admin: g.pre_launch_admin,
            post_exit_script: g.post_exit_script,
            post_exit_admin: g.post_exit_admin,
            companion_apps: to_json_array(&g.companion_apps),
            emulator_id: g.emulator_id,
            rom_path: g.rom_path,
            rom_hash: g.rom_hash,
            rom_region: g.rom_region,
            rom_language: g.rom_language,
            rom_group: g.rom_group,
            rom_disc: g.rom_disc,
            rom_archived: g.rom_archived,
            favorite: g.favorite,
            compat_notes: g.compat_notes,
            rom_profile: to_json_value(&g.rom_profile),
            last_played: g.last_played,
            play_status: g.play_status,
            genres: g.genres,
            themes: g.themes,
            game_modes: g.game_modes,
            player_perspectives: g.player_perspectives,
            screenshots: g.screenshots,
            videos: g.videos,
            websites: g.websites,
            time_to_beat: to_json_value(&g.time_to_beat),
            similar_games: to_json_array(&g.similar_games),
            releases: to_json_array(&g.releases),
            igdb_reviews: to_json_array(&g.igdb_reviews),
            alternative_names: g.alternative_names,
            steam_achievements: to_json_array(&g.steam_achievements),
            language_supports: to_json_array(&g.language_supports),
            collection: g.collection,
            // Not represented on `GameData`; writes through the serde
            // round-trip dropped it too. Kept out of the frontend shape.
            collection_id: None,
            franchise: g.franchise,
            game_category: g.game_category,
            release_status: g.release_status,
            version: g.version,
            compatibility_json: g.compatibility,
        }
    }
}

/// Direct `GameRow` -> `GameData` conversion for `load_games`.
///
/// Loading used to round-trip every row through `serde_json::Value`
/// (serialize the row, parse it back as `GameData`) — two full passes over
/// the whole library on every boot. Every persisted field is already on the
/// row, so map it straight across. Fields that exist only on `GameData`
/// (`humble_*`, `uplay_*`) were never persisted by the old round-trip
/// either and stay `None`.
impl From<db::games::GameRow> for GameData {
    fn from(r: db::games::GameRow) -> Self {
        GameData {
            id: r.id,
            name: r.name,
            path: r.path,
            platform: r.platform,
            installed: r.installed,
            play_time: r.play_time,
            added_at: r.added_at,
            cover_art_url: r.cover_art_url,
            cover_source_url: r.cover_source_url,
            notes: r.notes,
            size_bytes: r.size_bytes,
            size_detected_at: r.size_detected_at,
            size_root_path: r.size_root_path,
            mods_folder: r.mods_folder,
            mods_size_bytes: r.mods_size_bytes,
            mods_detected_at: r.mods_detected_at,
            icon_url: r.icon_url,
            banner_url: r.banner_url,
            logo_url: r.logo_url,
            description: r.description,
            developer: r.developer,
            publisher: r.publisher,
            release_date: r.release_date,
            genres: r.genres,
            metadata_source: r.metadata_source,
            metadata_url: r.metadata_url,
            storyline: r.storyline,
            igdb_rating: r.igdb_rating,
            critic_rating: r.critic_rating,
            igdb_id: r.igdb_id.and_then(|v| u64::try_from(v).ok()),
            themes: r.themes,
            game_modes: r.game_modes,
            player_perspectives: r.player_perspectives,
            screenshots: r.screenshots,
            videos: r.videos,
            websites: r.websites,
            time_to_beat: r.time_to_beat.and_then(|v| serde_json::from_value(v).ok()),
            similar_games: from_json_array(r.similar_games),
            releases: from_json_array(r.releases),
            igdb_reviews: tolerant_igdb_reviews(r.igdb_reviews),
            alternative_names: r.alternative_names,
            collection: r.collection,
            franchise: r.franchise,
            game_category: r.game_category,
            release_status: r.release_status,
            steam_app_id: r.steam_app_id,
            steam_playtime: r.steam_playtime,
            gog_game_id: r.gog_game_id,
            gog_playtime: r.gog_playtime,
            steam_achievements: from_json_array(r.steam_achievements),
            language_supports: from_json_array(r.language_supports),
            store_source: r.store_source,
            epic_namespace: r.epic_namespace,
            epic_catalog_item_id: r.epic_catalog_item_id,
            humble_game_id: None,
            humble_is_trove: None,
            humble_is_extra: None,
            uplay_game_id: None,
            uplay_is_connect: None,
            launch_arguments: r.launch_arguments,
            run_as_admin: r.run_as_admin,
            show_steam_launch_selection: r.show_steam_launch_selection,
            pre_launch_script: r.pre_launch_script,
            pre_launch_admin: r.pre_launch_admin,
            post_exit_script: r.post_exit_script,
            post_exit_admin: r.post_exit_admin,
            companion_apps: from_json_array(r.companion_apps),
            last_played: r.last_played,
            play_status: r.play_status,
            emulator_id: r.emulator_id,
            rom_path: r.rom_path,
            rom_hash: r.rom_hash,
            rom_region: r.rom_region,
            rom_language: r.rom_language,
            rom_group: r.rom_group,
            rom_disc: r.rom_disc,
            rom_archived: r.rom_archived,
            favorite: r.favorite,
            compat_notes: r.compat_notes,
            rom_profile: r.rom_profile.and_then(|v| serde_json::from_value(v).ok()),
            version: r.version,
            compatibility: r.compatibility_json,
        }
    }
}

/// Mirrors `deserialize_tolerant_igdb_reviews` for the direct row
/// conversion: a legacy row may hold a stray URL string among the review
/// objects, so keep only the elements that parse.
fn tolerant_igdb_reviews(raw: Option<Vec<serde_json::Value>>) -> Option<Vec<IgdbReview>> {
    let values = raw?;
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        if let Ok(review) = serde_json::from_value::<IgdbReview>(value) {
            out.push(review);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn to_json_value<T: Serialize>(value: &Option<T>) -> Option<serde_json::Value> {
    value.as_ref().and_then(|v| serde_json::to_value(v).ok())
}

fn to_json_array<T: Serialize>(value: &Option<Vec<T>>) -> Option<Vec<serde_json::Value>> {
    let items = value.as_ref()?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        out.push(serde_json::to_value(item).ok()?);
    }
    Some(out)
}

fn from_json_array<T: serde::de::DeserializeOwned>(
    raw: Option<Vec<serde_json::Value>>,
) -> Option<Vec<T>> {
    serde_json::from_value(serde_json::Value::Array(raw?)).ok()
}

/// Persist the game library.
///
/// Phase 3: reconciles the `games` SQLite table against the incoming
/// library in a single transaction, rewriting only rows whose content
/// actually changed and deleting ids no longer present. `GameRow`
/// mirrors the camelCase `GameData` shape, so entries convert directly
/// instead of being serialized into a `Value` first. Returns the
/// write/delete counts so the caller can tell a no-op save apart from a
/// real one.
#[tauri::command]
pub async fn save_games(
    app: tauri::AppHandle,
    games: Vec<GameData>,
) -> Result<db::games::SaveStats, String> {
    let db = app.state::<db::Db>().inner().clone();
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Sync `#[tauri::command]` bodies run inline on the GTK main thread
    // (async ones run on the tokio runtime), so the whole-library rewrite
    // is moved off it explicitly. Serializing/deserializing hundreds of
    // rows must not stall the event loop while the user is interacting.
    tauri::async_runtime::spawn_blocking(move || {
        let mut rows: Vec<db::games::GameRow> = Vec::with_capacity(games.len());
        let mut compat_items: Vec<(String, serde_json::Value)> = Vec::new();

        for g in games {
            if let Some(ref c) = g.compatibility {
                compat_items.push((g.id.clone(), c.clone()));
            }
            rows.push(db::games::GameRow::from(g));
        }
        let result = db::games::upsert_all(&db, &rows);
        if let Ok(stats) = &result {
            let _ = db::compatibility::upsert_batch_for_games(&db, &compat_items);
            // A save that wrote and deleted nothing must not walk the
            // artwork tree hunting for orphans.
            if stats.written > 0 || stats.deleted > 0 {
                let ids = rows.iter().map(|row| row.id.clone()).collect();
                db::artwork::cleanup_unreferenced_artwork(&app_data_dir, &ids);
            }
        }
        result
    })
    .await
    .map_err(|e| format!("save_games task: {e}"))?
}

/// Persist a targeted subset of the library.
///
/// This is the debounced write path the frontend uses when only a handful
/// of rows changed (a per-row edit, a few enriched covers) instead of
/// re-serializing the whole library through `save_games`. Running it as an
/// async command keeps the body off the GTK main thread (see the note on
/// `save_games`), and the DAO applies the batch in a single transaction, so
/// a 75-column insert carrying multi-MB JSON never stalls the event loop.
///
/// Merge mode: rows absent from the payload are left untouched — a subset
/// save must never delete the rest of the library.
#[tauri::command]
pub async fn save_games_subset(
    app: tauri::AppHandle,
    games: Vec<GameData>,
) -> Result<db::games::SaveStats, String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rows: Vec<db::games::GameRow> = Vec::with_capacity(games.len());
        let mut compat_items: Vec<(String, serde_json::Value)> = Vec::new();

        for g in games {
            // Only rows that actually carry a profile are upserted. A
            // missing `compatibility` field must NOT delete the stored
            // profile: the payload is a subset, so absence just means this
            // batch did not touch it. Removing a profile stays the explicit
            // single-row `save_game` path.
            if let Some(ref c) = g.compatibility {
                compat_items.push((g.id.clone(), c.clone()));
            }
            rows.push(db::games::GameRow::from(g));
        }
        let result = db::games::upsert_batch(&db, &rows, false);
        if result.is_ok() {
            let _ = db::compatibility::upsert_batch_for_games(&db, &compat_items);
            // No `cleanup_unreferenced_artwork` here — merge mode never
            // deletes a game, so this path cannot orphan an artwork file.
        }
        result
    })
    .await
    .map_err(|e| format!("save_games_subset task: {e}"))?
}

/// Persist a SINGLE game immediately, without rewriting the whole
/// library. Used by the frontend metadata-enrichment path: when a
/// cover/banner/logo is fetched during a library scroll we write that
/// one row straight away, so it survives even if the app is closed
/// before the debounced full-library `save_games` fires.
///
/// Async so the per-cover write runs on a blocking thread rather than
/// inline on the GTK main thread.
#[tauri::command]
pub async fn save_game(app: tauri::AppHandle, game: GameData) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let compat_opt = game.compatibility.clone();
        let game_id = game.id.clone();
        let row = db::games::GameRow::from(game);
        // NOTE: no artwork cleanup here — `save_game` fires per image write
        // during a library scroll, and pruning cache dirs on that hot path
        // walks the filesystem for every fetched cover. Both cleanups now run
        // once per session from a background thread spawned in `load_games`.
        let res = db::games::upsert_one(&db, &row);
        if res.is_ok() {
            if let Some(ref c) = compat_opt {
                let _ = db::compatibility::upsert_for_game(&db, &game_id, c);
            } else {
                let _ = db::compatibility::delete_for_game(&db, &game_id);
            }
        }
        res
    })
    .await
    .map_err(|e| format!("save_game task: {e}"))?
}

/// Load the game library. Returns every row in Continue-Playing order
/// (most recent `last_played` first, then alpha by name).
///
/// Runs on a blocking thread: on a large library this is tens of MB of
/// JSON and it must not block WebKitGTK's main loop while the splash is
/// still up.
#[tauri::command]
pub async fn load_games(app: tauri::AppHandle) -> Result<Vec<GameData>, String> {
    let db = app.state::<db::Db>().inner().clone();
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || load_games_blocking(&db, &app_data_dir))
        .await
        .map_err(|e| format!("load_games task: {e}"))?
}

fn load_games_blocking(db: &db::Db, app_data_dir: &std::path::Path) -> Result<Vec<GameData>, String> {
    let mut rows = db::games::list_all(db).map_err(|e| e.to_string())?;

    // Legacy rows stored artwork as base64 data URLs in the games table —
    // ~67 MB of `icon_url` alone on a 268-game library. Move those into
    // the disk-backed artwork store (the same place `download_artwork`
    // already writes) so the library read no longer ships tens of MB of
    // base64 to the webview on every boot. Rows that fail to externalize
    // keep their data URL and are retried next launch.
    for row in rows.iter_mut() {
        externalize_row_artwork(db, app_data_dir, row);
    }

    // The row already carries every persisted field, so convert straight to
    // `GameData` instead of serializing each row to JSON and parsing it
    // back — that doubled the boot cost on a large library. A field that
    // fails to parse (e.g. a legacy `rom_profile` blob) now degrades to
    // `None` instead of dropping the whole game.
    let mut out: Vec<GameData> = rows.into_iter().map(GameData::from).collect();

    // Enrich games with isolated compatibility profiles from compatibility.db
    if let Ok(mut compat_map) = db::compatibility::list_all_for_games(db) {
        for g in &mut out {
            if let Some(c) = compat_map.remove(&g.id) {
                g.compatibility = Some(c);
            }
        }
    }

    let ids: HashSet<String> = out.iter().map(|game| game.id.clone()).collect();
    // Referenced-artwork + stale non-library cache cleanup used to run
    // synchronously here (and on every `save_game`), walking the artwork
    // dirs on the boot path the UI waits on. Defer both to a background
    // thread a few seconds after startup: `load_games` returns as fast as
    // the query allows, and pruning still happens once per session.
    {
        let dir = app_data_dir.to_path_buf();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            db::artwork::cleanup_unreferenced_artwork(&dir, &ids);
            db::artwork::cleanup_non_library_caches(
                &dir,
                std::time::Duration::from_secs(30 * 24 * 60 * 60),
            );
        });
    }
    Ok(out)
}

/// Move the four base64 artwork columns of one row onto disk, rewriting
/// the stored URL to a `file://` URL the frontend already knows how to
/// convert (`normalizeGameArtworkUrls`). No-op for non-data URLs.
fn externalize_row_artwork(
    db: &db::Db,
    app_data_dir: &std::path::Path,
    row: &mut db::games::GameRow,
) {
    use db::games::ArtworkSlot;

    let game_id = row.id.clone();
    let slots = [
        (ArtworkSlot::Cover, row.cover_art_url.take()),
        (ArtworkSlot::Icon, row.icon_url.take()),
        (ArtworkSlot::Banner, row.banner_url.take()),
        (ArtworkSlot::Logo, row.logo_url.take()),
    ];
    for (slot, value) in slots {
        let next = match value {
            Some(v) if v.starts_with("data:") => {
                Some(externalize_data_url(db, app_data_dir, &game_id, slot, v))
            }
            other => other,
        };
        match slot {
            ArtworkSlot::Cover => row.cover_art_url = next,
            ArtworkSlot::Icon => row.icon_url = next,
            ArtworkSlot::Banner => row.banner_url = next,
            ArtworkSlot::Logo => row.logo_url = next,
        }
    }
}

/// Returns the new `file://` URL on success, or the original data URL so
/// the caller never loses artwork when a disk write fails.
fn externalize_data_url(
    db: &db::Db,
    app_data_dir: &std::path::Path,
    game_id: &str,
    slot: db::games::ArtworkSlot,
    value: String,
) -> String {
    let stored = db::artwork::store_data_url(app_data_dir, game_id, slot.store_slot(), &value)
        .ok()
        .flatten();
    if let Some(relative) = stored {
        if let Ok(url) = tauri::Url::from_file_path(app_data_dir.join(&relative)) {
            let url = url.to_string();
            if db::games::set_artwork_url(db, game_id, slot, &url).is_ok() {
                return url;
            }
        }
    }
    value
}

// === Emulation support =====================================================
//
// Emulators are configured in their own `emulators` table. Scanning an
// emulator's ROM folder produces `Game` rows (in the `games` table)
// that carry `emulator_id` + `rom_path` and whose `path`/`launch_arguments`
// point at the emulator exe with the ROM as an argument. This lets ROMs
// reuse the existing `launch_game` path, the GameWatcher playtime tracking,
// and the sidebar/platform filter — ROMs are just games with a console
// `platform`.

/// Phase-3 hot path: bump one game's `last_played` without rewriting
/// the rest of the row or the whole library. Called by the
/// `game-exited` event path; replaces what used to be a
/// `save_games(round_trip)` on every session-end.
#[tauri::command]
pub fn update_game_last_played(
    app: tauri::AppHandle,
    game_id: String,
    last_played_ms: u64,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::games::update_last_played(db_state.inner(), &game_id, last_played_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::games::GameRow;
    use serde_json::json;

    /// A `GameData` with every field populated, including the Humble /
    /// Ubisoft linkage the games table does not persist.
    fn full_game_data() -> GameData {
        serde_json::from_str(
            r#"{
            "id": "g1",
            "name": "Test Game",
            "path": "C:/Games/Test/game.exe",
            "platform": "GOG",
            "installed": true,
            "playTime": "3h",
            "addedAt": 111,
            "coverArtUrl": "data:image/png;base64,AAAA",
            "coverSourceUrl": "https://images.igdb.com/x.jpg",
            "notes": "note",
            "sizeBytes": 1234,
            "sizeDetectedAt": "2026-01-01T00:00:00Z",
            "sizeRootPath": "C:/Games/Test",
            "modsFolder": "C:/Games/Test/mods",
            "modsSizeBytes": 55,
            "modsDetectedAt": "2026-01-02T00:00:00Z",
            "iconUrl": "data:image/png;base64,BBBB",
            "bannerUrl": "data:image/png;base64,CCCC",
            "logoUrl": "data:image/png;base64,DDDD",
            "description": "desc",
            "developer": "dev",
            "publisher": "pub",
            "releaseDate": "2020-05-05",
            "genres": ["Action", "RPG"],
            "metadataSource": "igdb",
            "metadataUrl": "https://igdb.com/g/1",
            "storyline": "story",
            "igdbRating": 88.5,
            "criticRating": 90.0,
            "igdbId": 1942,
            "themes": ["Fantasy"],
            "gameModes": ["Single player"],
            "playerPerspectives": ["Third person"],
            "screenshots": ["s1", "s2"],
            "videos": ["v1"],
            "websites": ["https://example.com"],
            "timeToBeat": {
                "hastily": 100,
                "normally": 200,
                "completely": 300,
                "mainExtra": 400,
                "allStyles": 500
            },
            "similarGames": [{"id": 7, "name": "Sim", "coverUrl": "https://x/c.jpg"}],
            "releases": [{"platform": "PC", "dateStr": "2020-05-05", "region": "US"}],
            "igdbReviews": [
                {"title": "Great", "content": "Nice", "rating": 4.5, "username": "u", "votesUp": 3}
            ],
            "alternativeNames": ["Alt"],
            "collection": "Series",
            "franchise": "Franchise",
            "gameCategory": "Main game",
            "releaseStatus": "Released",
            "steamAppId": 440,
            "steamPlaytime": 120,
            "gogGameId": "1207658925",
            "gogPlaytime": 60,
            "steamAchievements": [{
                "apiname": "ACH",
                "name": "Ach",
                "description": "d",
                "achieved": true,
                "unlocktime": 123,
                "icon": "https://i",
                "icongray": "https://g"
            }],
            "languageSupports": [{"language": "English", "supportType": "full"}],
            "storeSource": "gog",
            "epicNamespace": "ns",
            "epicCatalogItemId": "cat",
            "humbleGameId": "hum-1",
            "humbleIsTrove": true,
            "humbleIsExtra": false,
            "uplayGameId": "uplay-1",
            "uplayIsConnect": true,
            "launchArguments": "-windowed",
            "runAsAdmin": true,
            "showSteamLaunchSelection": true,
            "preLaunchScript": "pre.ps1",
            "preLaunchAdmin": false,
            "postExitScript": "post.ps1",
            "postExitAdmin": true,
            "companionApps": [{
                "path": "C:/Tools/a.exe",
                "arguments": "-x",
                "delayMs": 100,
                "runAsAdmin": false
            }],
            "lastPlayed": 1700000000000,
            "playStatus": "playing",
            "emulatorId": "emu-1",
            "romPath": "C:/roms/game.iso",
            "romHash": "cafebabe",
            "romRegion": "USA",
            "romLanguage": "En,Fr",
            "romGroup": "Final Fantasy VII",
            "romDisc": 2,
            "romArchived": true,
            "favorite": true,
            "compatNotes": "use Vulkan",
            "romProfile": {
                "argumentsOverride": "-f",
                "graphicsBackend": "vulkan",
                "resolution": "1080p",
                "controllerLayout": "xbox",
                "shaders": "crt",
                "fullscreen": true,
                "envVars": ["A=1"]
            },
            "version": "1.0.4",
            "compatibility": {"enabled": true, "runnerType": "custom"}
        }"#,
        )
        .expect("full GameData sample must deserialize")
    }

    /// The persisted shape of the same sample. `GameRow` has no Humble /
    /// Ubisoft columns, and `collectionId` is not part of `GameData`.
    fn full_game_row() -> GameRow {
        serde_json::from_str(
            r#"{
            "id": "g1",
            "name": "Test Game",
            "path": "C:/Games/Test/game.exe",
            "platform": "GOG",
            "installed": true,
            "playTime": "3h",
            "addedAt": 111,
            "coverArtUrl": "data:image/png;base64,AAAA",
            "coverSourceUrl": "https://images.igdb.com/x.jpg",
            "notes": "note",
            "sizeBytes": 1234,
            "sizeDetectedAt": "2026-01-01T00:00:00Z",
            "sizeRootPath": "C:/Games/Test",
            "modsFolder": "C:/Games/Test/mods",
            "modsSizeBytes": 55,
            "modsDetectedAt": "2026-01-02T00:00:00Z",
            "iconUrl": "data:image/png;base64,BBBB",
            "bannerUrl": "data:image/png;base64,CCCC",
            "logoUrl": "data:image/png;base64,DDDD",
            "description": "desc",
            "developer": "dev",
            "publisher": "pub",
            "releaseDate": "2020-05-05",
            "metadataSource": "igdb",
            "metadataUrl": "https://igdb.com/g/1",
            "storyline": "story",
            "igdbRating": 88.5,
            "criticRating": 90.0,
            "igdbId": 1942,
            "steamAppId": 440,
            "steamPlaytime": 120,
            "gogGameId": "1207658925",
            "gogPlaytime": 60,
            "storeSource": "gog",
            "epicNamespace": "ns",
            "epicCatalogItemId": "cat",
            "launchArguments": "-windowed",
            "runAsAdmin": true,
            "showSteamLaunchSelection": true,
            "preLaunchScript": "pre.ps1",
            "preLaunchAdmin": false,
            "postExitScript": "post.ps1",
            "postExitAdmin": true,
            "companionApps": [{
                "path": "C:/Tools/a.exe",
                "arguments": "-x",
                "delayMs": 100,
                "runAsAdmin": false
            }],
            "emulatorId": "emu-1",
            "romPath": "C:/roms/game.iso",
            "romHash": "cafebabe",
            "romRegion": "USA",
            "romLanguage": "En,Fr",
            "romGroup": "Final Fantasy VII",
            "romDisc": 2,
            "romArchived": true,
            "favorite": true,
            "compatNotes": "use Vulkan",
            "romProfile": {
                "argumentsOverride": "-f",
                "graphicsBackend": "vulkan",
                "resolution": "1080p",
                "controllerLayout": "xbox",
                "shaders": "crt",
                "fullscreen": true,
                "envVars": ["A=1"]
            },
            "lastPlayed": 1700000000000,
            "playStatus": "playing",
            "genres": ["Action", "RPG"],
            "themes": ["Fantasy"],
            "gameModes": ["Single player"],
            "playerPerspectives": ["Third person"],
            "screenshots": ["s1", "s2"],
            "videos": ["v1"],
            "websites": ["https://example.com"],
            "timeToBeat": {
                "hastily": 100,
                "normally": 200,
                "completely": 300,
                "mainExtra": 400,
                "allStyles": 500
            },
            "similarGames": [{"id": 7, "name": "Sim", "coverUrl": "https://x/c.jpg"}],
            "releases": [{"platform": "PC", "dateStr": "2020-05-05", "region": "US"}],
            "igdbReviews": [
                {"title": "Great", "content": "Nice", "rating": 4.5, "username": "u", "votesUp": 3}
            ],
            "alternativeNames": ["Alt"],
            "steamAchievements": [{
                "apiname": "ACH",
                "name": "Ach",
                "description": "d",
                "achieved": true,
                "unlocktime": 123,
                "icon": "https://i",
                "icongray": "https://g"
            }],
            "languageSupports": [{"language": "English", "supportType": "full"}],
            "collection": "Series",
            "collectionId": 420,
            "franchise": "Franchise",
            "gameCategory": "Main game",
            "releaseStatus": "Released",
            "version": "1.0.4",
            "compatibility": {"enabled": true, "runnerType": "custom"}
        }"#,
        )
        .expect("full GameRow sample must deserialize")
    }

    /// The write path must build a row that serializes byte-for-byte like
    /// the old `GameData -> Value -> GameRow` round-trip, because that
    /// serialization is the persisted `content_hash` input. A drift here
    /// would invalidate every stored fingerprint and rewrite the library.
    #[test]
    fn game_data_to_row_matches_serde_round_trip() {
        let direct = GameRow::from(full_game_data());
        let legacy: GameRow =
            serde_json::from_value(serde_json::to_value(full_game_data()).unwrap()).unwrap();

        assert_eq!(
            serde_json::to_string(&legacy).unwrap(),
            serde_json::to_string(&direct).unwrap()
        );
    }

    /// The read path must produce the exact JSON shape the frontend used to
    /// receive: the same keys, the same values, `humble*`/`uplay*` absent.
    #[test]
    fn game_row_to_game_data_matches_serde_round_trip() {
        let row = full_game_row();
        let legacy: GameData = serde_json::from_value(serde_json::to_value(&row).unwrap()).unwrap();
        let direct = GameData::from(row);

        assert_eq!(
            serde_json::to_value(&legacy).unwrap(),
            serde_json::to_value(&direct).unwrap()
        );
    }

    /// A malformed nested blob used to fail the whole `GameData`
    /// deserialization and drop the game from the library. The direct
    /// conversion degrades just that field, and still filters the stray
    /// non-review entries the tolerant deserializer used to drop.
    #[test]
    fn game_row_conversion_degrades_on_malformed_nested_fields() {
        let row: GameRow = serde_json::from_value(json!({
            "id": "bad",
            "name": "Bad",
            "path": "",
            "platform": "GOG",
            "installed": false,
            "playTime": "0m",
            "addedAt": 1u64,
            "romProfile": "not-an-object",
            "igdbReviews": [
                "https://youtube.example/x",
                {"title": "ok", "content": "c", "rating": 5.0, "username": "u"}
            ]
        }))
        .unwrap();

        let game = GameData::from(row);
        assert!(game.rom_profile.is_none());
        let reviews = game.igdb_reviews.expect("valid review should survive");
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0].title.as_deref(), Some("ok"));
    }
}



