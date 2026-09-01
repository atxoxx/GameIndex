use std::path::Path;
use std::sync::Arc;
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime};
use std::sync::OnceLock;
use serde::{Deserialize, Deserializer, Serialize};
use tauri::{Emitter, Listener, Manager, WindowEvent};
use tokio::sync::Mutex;

mod config;
mod discord_presence;
mod crackwatch;
mod steamgriddb;
mod price;
mod protondb;
mod db;
mod game_scraper;
mod game_watcher;
mod gpu_detector;
mod metrics_collector;
mod rtss_reader;
mod mahm_reader;
mod deals;
mod steam;
mod epic;
#[cfg_attr(not(test), allow(dead_code))] // re-exported only via `inventory`
mod gog;
mod humble;
mod steam_game_watcher;
mod rockstar;
mod uplay;
mod size;
// New modules for the download feature. See each module's
// top-of-file doc comment for the design rationale.
mod source_manager;
mod store_checker;
mod downloads;
mod updater;
mod achievements;
mod local_achievements;
mod achievement_watcher;
mod manual_links;
mod mods;
mod tray;
mod system_screenshots;
mod emulator_install;
mod plugins;
mod retro;
use game_scraper::{GameMetadataResult, LaunchBoxImageResult, StoreGameSummary, TimeToBeat, SimilarGame, ReleaseDateInfo, IgdbReview, LanguageSupportInfo, ReviewFetchResult, PcRequirementsPayload, IgdbPlatformInfo};
use game_watcher::{GameWatcher, GameRefInput};
use gpu_detector::GpuInfo;
use epic::auth::{epic_start_login, epic_finish_login, epic_login_with_refresh_token, epic_is_authenticated, epic_logout};
use epic::sync::epic_sync_library;
use gog::auth::{gog_is_authenticated, gog_logout, gog_start_login};
use gog::sync::gog_sync_library;
use humble::{
    humble_get_settings, humble_is_authenticated, humble_logout, humble_save_settings,
    humble_start_login, humble_sync_library,
};
use rockstar::sync::{rockstar_launch_game, rockstar_sync_library};
use uplay::{
    uplay_get_settings, uplay_launch_game, uplay_save_settings, uplay_sync_library,
};
use steam::auth::{steam_connect, steam_logout, steam_get_session};
use steam::launch_options::SteamLaunchOption;
use steam::sync::steam_sync_games;
use size::{detect_game_size, check_paths_exist, open_folder, disk_usage, move_game_install, uninstall_game, measure_path_size};
use system_screenshots::detect_system_screenshot_folders;

mod games;
mod emulation;
mod system;
mod launcher;
mod media;
mod store;
mod sessions;
mod steam_stats;
mod webview;
mod friends;

use crate::games::*;
use crate::emulation::*;
use crate::system::*;
use crate::launcher::*;
use crate::media::*;
use crate::store::*;
use crate::sessions::*;
use crate::steam_stats::*;
use crate::webview::*;
use crate::friends::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // L4: autostart-on-boot. Pass an empty args vec â€” we don't
        // currently ship a `--minimized` flag, so the binary just
        // launches into the regular window. The plugin also writes
        // the right per-OS artifact (LaunchAgent on macOS,
        // `HKCU\â€¦\Run` regkey on Windows, .desktop autostart on
        // Linux) so calling `enable()` is the only API surface the
        // frontend needs.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, force_close_game, save_games, save_game, load_games, close_splashscreen, update_game_last_played, read_cover_image, search_game_metadata, get_igdb_game_by_id, fetch_game_images, download_image, download_artwork, store_artwork_file, artwork_asset_url, cleanup_artwork_cache, search_launchbox_images, detect_gpus, list_media_files, save_screenshot, save_text_file, load_sessions, get_sessions, delete_session, delete_sessions_for_game, insert_session, get_system_ram_gb, get_system_info, refresh_hardware, set_metrics_config, detect_game_size, check_paths_exist, open_folder, disk_usage, move_game_install, uninstall_game, measure_path_size, detect_steam_screenshot_folders, detect_system_screenshot_folders, save_store_cache, load_store_cache, fetch_store_games, search_store_games, get_igdb_platforms,            get_store_game_detail, get_collection_games,            fetch_game_reviews, fetch_external_reviews, get_recommended_config,
            get_language, set_language, get_about_bundle,             save_wishlist, load_wishlist, get_last_session_for_game, save_source_cache, load_source_cache, deals::fetch_gamepass_catalog, deals::fetch_isthereanydeal_deals, deals::fetch_giveaways, deals::open_deal_url, deals::fetch_playtester_games, deals::fetch_playtester_game_detail,            steam_sync_games,
            steam_connect, steam_logout, steam_get_session,
            steam_launch_options,
            epic_start_login, epic_finish_login, epic_login_with_refresh_token, epic_sync_library, epic_is_authenticated, epic_logout,
            epic::achievements::epic_fetch_achievements,
            gog_start_login, gog_sync_library, gog_is_authenticated, gog_logout,
            gog::achievements::gog_fetch_achievements,
            humble_start_login, humble_sync_library, humble_is_authenticated, humble_logout,
            humble_get_settings, humble_save_settings,
            // Rockstar Games Launcher integration — installed-games scan
            // + launcher client actions (no cloud auth).
            rockstar_sync_library, rockstar_launch_game,
            // Ubisoft Connect (Uplay) integration — installed + library
            // scan + client actions (uplay:// protocol).
            uplay_sync_library, uplay_launch_game, uplay_get_settings,
            uplay_save_settings,
            // Download-feature commands. The torrent engine manages
            // its own global session; the source manager and store
            // checker are passed through `tauri::State`.
            source_manager::sources_add,
            source_manager::sources_add_bulk,
            source_manager::sources_remove,
            source_manager::sources_toggle,
            source_manager::sources_list,
            source_manager::sources_refresh,
            source_manager::sources_refresh_all,
            source_manager::sources_search_game,
            plugins::plugins_list,
            plugins::plugins_import_file,
            plugins::plugins_install,
            plugins::plugins_remove,
            plugins::plugins_toggle,
            plugins::plugins_set_all_enabled,
            plugins::search_downloads,
            plugins::search_downloads_stream,
            get_random_store_games,
            store_checker::check_ownership,
            store_checker::check_ownership_for_ids,
            store_checker::set_steam_owned,
            store_checker::set_epic_owned,
            downloads::torrent_add,
            downloads::torrent_pause,
            downloads::torrent_resume,
            downloads::torrent_remove,
            downloads::torrent_get_all,
            downloads::torrent_select_save_path,
            downloads::torrent_pause_all,
            downloads::torrent_resume_all,
            downloads::torrent_update_only_files,
            downloads::debrid_update_only_files,
            downloads::torrent_start_selected,
            downloads::torrent_set_speed_limits,
            downloads::torrent_open_folder,
            downloads::download_set_seed_config,
            downloads::download_set_seeding,
            downloads::download_history_get,
            downloads::download_history_clear,
            crackwatch::fetch_crackwatch_status,
            crackwatch::fetch_crackwatch_status_batch,
            steamgriddb::sgdb_get_assets,
            steamgriddb::sgdb_get_all_assets,
            steamgriddb::sgdb_get_assets_batch,
            price::fetch_game_prices_batch,
            protondb::fetch_protondb_status,
            fetch_url,
            webview_history_navigate,
            webview_current_url,
            create_preview_webview,
            webview_eval,
            rebuild_watcher_index,
            achievements::fetch_achievements,
            achievements::save_achievements_cache,
            achievements::load_achievements_cache,
            achievements::sync_local_achievements,
            // RetroAchievements provider (L1a) — settings, console/game
            // lookup, per-game link override, and full achievement sync.
            retro::retro_get_settings,
            retro::retro_save_settings,
            retro::retro_get_consoles,
            retro::retro_search_games,
            retro::retro_set_forced_game_id,
            retro::retro_sync_game,
            achievement_links_list,
            // Manual achievement provider (L1b): link a game to a public
            // Steam appid and track its achievements by hand.
            manual_links::manual_search_steam,
            manual_links::manual_link_create,
            manual_links::manual_link_remove,
            manual_links::manual_fetch_schema,
            manual_links::manual_save_unlocks,
            manual_links::manual_sync,
            achievement_watcher::set_local_achievements_enabled,
            downloads::test_debrid_key,
            downloads::debrid_check_cache,
            downloads::direct_download_start,
            downloads::debrid_download_start,
            downloads::download_set_debrid_config,
            downloads::direct_download_update_url,
            downloads::debrid_unrestrict_link,
            downloads::browser_resolver::open_download_resolver,
            downloads::browser_resolver::close_download_resolver,
            // Live Steam concurrent-player count. Powers the player
            // badges on the store hero, store detail, and game detail
            // banners â€” see PlayerCountCache above for caching policy.
            get_steam_player_count,
            lookup_steam_app_id_for_game,
            // Popover payload: developer/publisher/release/price + reviews.
            // See SteamGameStatsCache above for per-section caching policy.
            get_steam_game_stats,
            // Long-range concurrent-player history from steamcharts.com
            // (free CCU feed, same data SteamDB charts show). Powers the
            // hover popover's historical line chart.
            get_steam_player_history,
            // New launcher settings â€” close-to-tray (L2), minimize
            // on launch (L3), disable UAC elevation prompts (L5),
            // and OS auto-launch on boot (L4 via tauri-plugin-autostart).
            get_launcher_settings,
            set_close_to_tray_enabled,
            set_minimize_on_launch_enabled,
            set_restore_on_exit_enabled,
            set_disable_elevation_prompts,
            set_autostart_enabled,
            is_autostart_enabled,
            write_sync_file,
            read_sync_file,
            get_friends_sync_dir,
            get_friends_device_id,
            get_friends_nostr_privkey,
            set_friends_nostr_privkey,
            list_friend_outboxes,
            load_friends_db,
            save_friends_db,
            set_discord_presence_enabled,
            // Emulation support — emulator configs + ROM scanning.
            list_emulators,
            save_emulator,
            delete_emulator,
            scan_emulator_roms,
            // Downloadable emulator catalog + install pipeline.
            emulator_install::list_emulator_downloads,
            emulator_install::start_emulator_install,
            finish_emulator_install,
            add_rom_file,
            rename_rom_file,
            delete_rom_file,
            recalc_rom_sizes,
            // Mod support — engine-aware detection, enable/disable,
            // load order, conflicts, and Nexus Mods integration.
            mods::mods_scan_game,
            mods::mods_list,
            mods::mods_set_enabled,
            mods::mods_reorder,
            mods::mods_delete,
            mods::mods_list_files,
            mods::mods_conflicts,
            mods::mods_overview,
            mods::mods_set_nexus_domain,
            mods::mods_set_custom_root,
            mods::nexus_set_api_key,
            mods::nexus_get_status,
            mods::nexus_check_updates,
            updater::updater_install_mode,
            updater::portable_update_download,
            updater::portable_update_cancel,
            updater::portable_update_apply])
        .on_window_event(|window, event| {
            // L2: intercept the user clicking the OS-level close
            // button (or the in-app WindowControls close button, since
            // both end up at the same CloseRequested event). When
            // close_to_tray is on, hide the window instead of letting
            // it close â€” the app keeps running with no visible chrome
            // and the user reopens it from the taskbar. The lock is
            // held briefly (one bool read) and never across an
            // .await, so the std sync Mutex is the simplest correct
            // primitive here.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let settings = window
                        .app_handle()
                        .state::<Arc<std::sync::Mutex<LauncherSettings>>>();
                    let close_to_tray = settings
                        .lock()
                        .map(|s| s.close_to_tray_enabled)
                        .unwrap_or(false);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                }
            }
            // Unpause / unhide from taskbar click â€” when the window
            // is hidden and the user clicks the dock/taskbar icon,
            // tauri emits a Focused event. Re-show + unminimize so
            // the user sees the app without manual intervention.
            if let WindowEvent::Focused(true) = event {
                if window.label() == "main" {
                    if let Some(win) = window.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                    }
                }
            }
        })
        .setup(|app| {
            // Load .env file for development (production builds have
            // credentials baked in at compile time via option_env!()).
            config::load_env_file();

            // ── Discord Rich Presence ──────────────────────────────────
            // Manages the command sender + enabled flag. The connection
            // thread itself is spawned lazily when the user enables the
            // setting (see `set_discord_presence_enabled`). The frontend
            // emits rich presence payloads (details / stateText / assets /
            // button) on game-started/game-exited, and "browsing" payloads
            // from the useDiscordPresence hook while the app is idle; we
            // translate those into thread commands here. The thread owns
            // the IPC connection, reconnects with retry, and emits
            // `discord-presence-status`.
            let discord_state = discord_presence::DiscordPresenceState::new();
            app.manage(discord_state);

            {
                let handle = app.handle().clone();
                let _ = handle.listen("discord-presence-update", {
                    let handle = handle.clone();
                    move |event| {
                        let Ok(payload) =
                            serde_json::from_str::<discord_presence::PresenceData>(event.payload())
                        else {
                            return;
                        };
                        let state = handle.state::<discord_presence::DiscordPresenceState>();
                        // `"stopped"` is the explicit clear sentinel; every other
                        // state (`"playing"`, `"browsing"`, …) carries an activity
                        // payload that is built and pushed to Discord.
                        if payload.state == "stopped" {
                            state.clear();
                        } else {
                            state.set_playing(payload);
                        }
                    }
                });
            }

            // â”€â”€ Initialize the SQLite database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Phase 1â€“4 storage layer. opened & migrated before
            // every other state so commands can take a `Db` via
            // `tauri::State`. We register `Db` directly (NOT wrapped
            // in an `Arc`) because the inner `r2d2::Pool` is already
            // `Arc`-backed internally; `Db: Clone` because the pool
            // field is Clone. The previous `Arc::new(db)` wrapping
            // registered a TypeId of `Arc<Db>` while the commands
            // declared `state::<db::Db>()` (different TypeIds),
            // causing "state() called before manage()" panics on
            // every command invocation.
            let app_data_dir = app.path().app_data_dir()?;
            db::artwork::cleanup_non_library_caches(&app_data_dir, Duration::from_secs(30 * 24 * 60 * 60));
            let db = match db::init(&app_data_dir) {
                Ok(db) => db,
                Err(e) => {
                    eprintln!("[gameindex] db::init failed: {e}");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("db::init: {e}"),
                    )) as Box<dyn std::error::Error>);
                }
            };
            app.manage(db.clone());

            // Reconcile any in-progress `sessions` rows orphaned by a crash
            // on a previous run: back-date their `ended_at` from the last
            // heartbeat's elapsed so the partial playtime is credited rather
            // than left dangling (zero-elapsed rows are deleted).
            if let Err(e) = db::sessions::finalize_orphaned_running(&db) {
                eprintln!("[gameindex] failed to reconcile orphaned sessions: {e}");
            }

            // â”€â”€ Initialize the launcher settings (L2/L3/L5) â”€â”€â”€â”€â”€â”€â”€â”€
            // Read the persisted close-to-tray/minimize/disable-UAC
            // toggles from kv, then manage the in-memory mirror so
            // `launch_game`, `force_close_game`, and the
            // CloseRequested event handler can all read it on the
            // hot path without an extra DB round-trip. The setters
            // update both the mirror and the kv_store.
            let db_state: tauri::State<'_, db::Db> = app.state();
            let launcher_settings = Arc::new(std::sync::Mutex::new(
                load_launcher_settings(db_state.inner()),
            ));
            app.manage(launcher_settings);

            // â”€â”€ Initialize the GameWatcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Long-lived background service that polls WMI for running
            // game processes. Handles both app-launched sessions and
            // passive detection (games launched outside GameIndex).
            //
            // Phase 3: the watcher now holds an Arc<Db> so its
            // background poller thread can write session rows to the
            // `sessions` table on every session-end before emitting
            // the `game-exited` event.
            let game_watcher = Arc::new(std::sync::Mutex::new(GameWatcher::new(db.clone())));
            app.manage(game_watcher.clone());

            // Start the background poll loop (every 5s, picks up
            // running processes and tracks sessions).
            game_watcher::start_background_poll(
                game_watcher,
                app.handle().clone(),
            );

            // ── L6: restore-window-on-last-exit ────────────────────────
            // When `restore_on_exit_enabled` is on and the main window
            // was hidden by minimize-on-launch, re-show + unminimize it
            // once the LAST running game exits. The "last" signal comes
            // from the payload's `remainingGameName` (snapshotted by
            // `finish_session` before its emit, excluding the exiting
            // session — so `None` means zero sessions remain). We
            // deliberately do NOT lock the GameWatcher here: `game-exited`
            // is emitted synchronously while the watcher mutex is held,
            // so re-locking from this listener would deadlock (same
            // constraint as the tray listener in tray.rs). The
            // `WINDOW_HIDDEN_ON_LAUNCH` atomic scopes the restore to
            // windows we actually hid, and is cleared once restored.
            {
                let handle = app.handle().clone();
                let _ = handle.listen("game-exited", {
                    let handle = handle.clone();
                    move |event| {
                        let settings = handle
                            .state::<Arc<std::sync::Mutex<LauncherSettings>>>();
                        let restore_enabled = settings
                            .lock()
                            .map(|s| s.restore_on_exit_enabled)
                            .unwrap_or(false);
                        if !restore_enabled {
                            return;
                        }
                        if !WINDOW_HIDDEN_ON_LAUNCH.load(std::sync::atomic::Ordering::Relaxed) {
                            return;
                        }
                        // `remainingGameName` is None only when this exit
                        // leaves zero active sessions — i.e. the last game quit.
                        let last_exit =
                            match serde_json::from_str::<serde_json::Value>(event.payload()) {
                                Ok(val) => val
                                    .get("remainingGameName")
                                    .and_then(|v| v.as_str())
                                    .is_none(),
                                Err(_) => return,
                            };
                        if !last_exit {
                            return;
                        }
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                        }
                        WINDOW_HIDDEN_ON_LAUNCH
                            .store(false, std::sync::atomic::Ordering::Relaxed);
                    }
                });
            }

            // ── Local (crack / emulator) achievement watcher ──────────
            // Pre-scans on startup to pick up offline unlocks, then
            // polls crack/emulator files for changes and merges them
            // into the achievements cache (schema from Steam's public
            // Web API). Emits `achievements-updated` /
            // `achievement-unlocked` events.
            achievement_watcher::start(app.handle().clone());

            // â”€â”€ Source manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Phase 2: the in-memory state maps are gone. All reads
            // and writes go through the SQLite pool. The
            // `Arc<SourceManager>` (no Mutex) is shared across
            // commands; concurrency is provided by SQLite WAL.
            let source_manager = Arc::new(source_manager::SourceManager::new(db.clone()));
            app.manage(source_manager);

            // ── Plugin manager (sandboxed JS search plugins) ────────────
            // Loads every enabled plugin's source into memory at startup
            // so searches never touch disk. `load_enabled` records
            // `last_error` for files that fail to read/evaluate instead
            // of blocking startup.
            let plugins_manager =
                Arc::new(plugins::PluginManager::new(db.clone(), app_data_dir.clone()));
            plugins_manager.load_enabled();
            app.manage(plugins_manager);

            let store_checker = Arc::new(Mutex::new(store_checker::StoreChecker::new()));
            app.manage(store_checker);

            // Live Steam concurrent-player count cache. Sized at 0
            // entries on startup â€” grows on first miss per-appid and
            // is bounded by how many distinct Steam appids the user
            // actually opens (single-digit hundreds at worst for a
            // large library). We never expire old entries: a long-lived
            // map with O(N) work per banner refresh is fine for N â‰¤ a
            // few hundred, and skipping the cleanup avoids dropping
            // a user's just-fetched count behind their back.
            app.manage(PlayerCountCache::default());

            // Steam game-stats cache (appdetails + appreviews, used by
            // the player-count popover). Same growth model as
            // PlayerCountCache: 0 entries on startup, bounded by the
            // number of distinct Steam appids the user actually opens.
            app.manage(SteamGameStatsCache::default());

            // Long-range concurrent-player history cache
            // (steamcharts.com feed, 6h TTL). Grows on first fetch per
            // appid; see SteamPlayerHistoryCache above for the
            // fetch-once / filter-in-memory policy.
            app.manage(SteamPlayerHistoryCache::default());


            // Spin the torrent engine up on the async runtime.
            // We use `spawn` (fire-and-forget) rather than
            // `block_on` so the `setup` closure returns
            // immediately and the app window can appear without
            // waiting for the torrent session to open + walk
            // existing torrents from disk. Init failures are
            // logged but don't block startup â€” the rest of the
            // app works without the engine, and the user can
            // retry by restarting.
            let app_handle = app.handle().clone();
            let app_data_dir_for_engine = app_data_dir.clone();
            let db_for_engine = db.clone();
            let _ = tauri::async_runtime::spawn(async move {
                if let Err(e) = downloads::initialize_engine(
                    app_handle,
                    app_data_dir_for_engine,
                    db_for_engine,
                )
                .await
                {
                    eprintln!("[gameindex] downloads::initialize_engine failed: {}", e);
                }
            });

            tray::build_tray(app).unwrap_or_else(|e| eprintln!("[gameindex] tray setup failed: {e}"));

            let app_handle = app.handle().clone();
            let (tx, rx) = tokio::sync::mpsc::channel(10);
            init_internet_sync(tx);
            tauri::async_runtime::spawn(async move {
                start_internet_sync_loop(app_handle, rx).await;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Close the Discord IPC pipe and let the presence thread
                // finish before the process exits.
                let state = _app_handle.state::<discord_presence::DiscordPresenceState>();
                state.shutdown();
                std::thread::sleep(std::time::Duration::from_millis(200));
                downloads::cleanup_extractions();
                std::process::exit(0);
            }
        });
}

// ── Friends Sync (local shared-file P2P) ─────────────────────────────

