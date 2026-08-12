//! Background watcher for local (crack / emulator) achievements.
//!
//! A Rust port of Hydra Launcher's `achievement-watcher-manager.ts`.
//! On startup it runs a silent **pre-search** to pick up achievements
//! unlocked while the app was closed, then polls crack/emulator
//! achievement files for modification-time changes and re-syncs the
//! affected games. Newly-unlocked achievements are surfaced to the
//! frontend via Tauri events:
//!
//! - `achievements-updated` `{ gameId }` — the cache for a game changed;
//!   the UI should reload it.
//! - `achievement-unlocked` `{ gameId, gameName, achievements: [...] }` —
//!   one or more achievements were just unlocked (drives a toast).
//!
//! Gated by the `local_achievements_enabled` kv flag (default on).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{achievements, db, local_achievements};

/// kv flag controlling whether the watcher runs.
pub const KV_LOCAL_ACHIEVEMENTS: &str = "local_achievements_enabled";

/// Poll cadence — matches the game watcher's steady interval.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Max dirty games synced concurrently in one pass. Schema fetches carry
/// a 20s timeout; syncing sequentially would turn an offline startup
/// pre-search into N serial 20s stalls. 4 keeps the burst small while
/// still overlapping the per-game round-trips.
const MAX_CONCURRENT_SYNCS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlockedInfo {
    display_name: String,
    icon: String,
    is_rare: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AchievementUnlockedPayload {
    game_id: String,
    game_name: String,
    achievements: Vec<UnlockedInfo>,
}

fn is_enabled(app: &AppHandle) -> bool {
    let db_state: tauri::State<'_, db::Db> = app.state();
    match db::kv::get(db_state.inner(), KV_LOCAL_ACHIEVEMENTS) {
        Ok(Some(v)) => v.trim().trim_matches('"') != "false",
        _ => true, // default on
    }
}

fn resolve_language(app: &AppHandle) -> String {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::get(db_state.inner(), "language")
        .ok()
        .flatten()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string())
}

/// A library game reduced to what the watcher needs.
#[derive(Clone)]
struct WatchedGame {
    id: String,
    name: String,
    steam_app_id: u32,
    exe_path: Option<String>,
}

fn load_watched_games(app: &AppHandle) -> Vec<WatchedGame> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    match db::games::list_all(db_state.inner()) {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|g| {
                g.steam_app_id.map(|appid| WatchedGame {
                    id: g.id,
                    name: g.name,
                    steam_app_id: appid,
                    exe_path: if g.path.is_empty() { None } else { Some(g.path) },
                })
            })
            .collect(),
        Err(e) => {
            eprintln!("[achievement_watcher] failed to load games: {e}");
            Vec::new()
        }
    }
}

/// Gather the on-disk achievement files for a game, using a pre-built
/// `appid -> files` map (folder scan) plus per-game executable-dir files.
fn files_for_game(
    game: &WatchedGame,
    all_files: &HashMap<String, Vec<local_achievements::AchievementFile>>,
) -> Vec<local_achievements::AchievementFile> {
    let mut out = Vec::new();
    for object_id in local_achievements::get_alternative_object_ids(&game.steam_app_id.to_string())
    {
        if let Some(files) = all_files.get(&object_id) {
            out.extend(files.iter().cloned());
        }
    }
    out.extend(local_achievements::find_achievement_file_in_executable_directory(
        game.exe_path.as_deref(),
    ));
    out
}

/// Snapshot the mtime (ms) of a file, or `None` if it can't be read.
fn file_mtime_ms(path: &PathBuf) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Currently-achieved api names (uppercased) for a game, from cache.
fn cached_achieved(app: &AppHandle, game_id: &str) -> HashSet<String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::get(db_state.inner(), game_id)
        .ok()
        .flatten()
        .and_then(|(_, payload, _, _, _)| {
            serde_json::from_str::<achievements::GameAchievementData>(&payload).ok()
        })
        .map(|d| {
            d.achievements
                .iter()
                .filter(|a| a.achieved)
                .map(|a| a.api_name.to_uppercase())
                .collect()
        })
        .unwrap_or_default()
}

/// Spawn the watcher on the async runtime (reqwest needs an executor).
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .user_agent("GameIndex/1.0 (+steam-api)")
            .timeout(Duration::from_secs(20))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[achievement_watcher] failed to build client: {e}");
                return;
            }
        };

        // path -> last-seen mtime (ms). Seeded during the pre-search.
        let mut file_stats: HashMap<PathBuf, u64> = HashMap::new();

        // ── Pre-search (silent): catch offline unlocks ──────────────
        run_pass(&app, &client, &mut file_stats, false).await;

        // ── Steady poll ─────────────────────────────────────────────
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if !is_enabled(&app) {
                continue;
            }
            run_pass(&app, &client, &mut file_stats, true).await;
        }
    });
}

/// One scan pass. When `notify` is false (pre-search) we still update the
/// cache + emit `achievements-updated`, but suppress unlock toasts.
async fn run_pass(
    app: &AppHandle,
    client: &reqwest::Client,
    file_stats: &mut HashMap<PathBuf, u64>,
    notify: bool,
) {
    if !is_enabled(app) {
        return;
    }

    let games = load_watched_games(app);
    if games.is_empty() {
        return;
    }

    let all_files = local_achievements::find_all_achievement_files();
    let language = resolve_language(app);

    // Phase 1 (fast, local-only): detect which games changed and seed the
    // mtime map. Kept sequential — this is pure disk I/O, and `file_stats`
    // must be updated for every game (not just dirty ones) so the next
    // pass can tell a change from a no-op.
    let mut dirty_games: Vec<WatchedGame> = Vec::new();
    for game in &games {
        let files = files_for_game(game, &all_files);
        if files.is_empty() {
            continue;
        }

        // Detect whether any file changed since last pass.
        let mut dirty = false;
        for file in &files {
            let mtime = file_mtime_ms(&file.path).unwrap_or(0);
            let prev = file_stats.get(&file.path).copied();
            if prev != Some(mtime) {
                dirty = true;
            }
            file_stats.insert(file.path.clone(), mtime);
        }

        if dirty {
            dirty_games.push(game.clone());
        }
    }

    // Phase 2: sync dirty games with bounded concurrency so one slow or
    // offline game can't serialize N 20s timeouts and stall the whole
    // startup pass. Errors are logged per-game; the rest continue.
    // `dirty_games` holds owned `WatchedGame`s, so the stream's `map`
    // closure is a plain `FnMut(WatchedGame)` — no HRTB on the item
    // lifetime — and each future moves its game in.
    futures::stream::iter(dirty_games)
        .map(|game| {
            // Each future owns its own copy of the language string.
            let language = language.clone();
            async move {
            // Snapshot pre-merge unlocks so we can compute the delta.
            let before = cached_achieved(app, &game.id);

            match achievements::sync_local_for_game(
                app,
                client,
                &game.id,
                game.steam_app_id,
                game.exe_path.clone(),
                &language,
            )
            .await
            {
                Ok((data, new_count)) => {
                    // Always tell the UI to reload this game's cache.
                    let _ = app.emit(
                        "achievements-updated",
                        serde_json::json!({ "gameId": game.id }),
                    );

                    if notify && new_count > 0 {
                        let newly: Vec<UnlockedInfo> = data
                            .achievements
                            .iter()
                            .filter(|a| a.achieved && !before.contains(&a.api_name.to_uppercase()))
                            .map(|a| UnlockedInfo {
                                display_name: a.display_name.clone(),
                                icon: a.icon.clone(),
                                is_rare: a.percent > 0.0 && a.percent < 10.0,
                            })
                            .collect();

                        if !newly.is_empty() {
                            let _ = app.emit(
                                "achievement-unlocked",
                                AchievementUnlockedPayload {
                                    game_id: game.id.clone(),
                                    game_name: game.name.clone(),
                                    achievements: newly,
                                },
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[achievement_watcher] sync failed for {} ({}): {e}",
                        game.name, game.id
                    );
                }
            }
            }
        })
        .buffer_unordered(MAX_CONCURRENT_SYNCS)
        .collect::<Vec<()>>()
        .await;
}

/// Set the watcher on/off flag (persisted in kv).
#[tauri::command]
pub fn set_local_achievements_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(
        db_state.inner(),
        KV_LOCAL_ACHIEVEMENTS,
        if enabled { "true" } else { "false" },
    )
}

