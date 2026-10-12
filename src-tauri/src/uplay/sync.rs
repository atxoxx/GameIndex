//! Ubisoft Connect sync orchestrator + client actions.
//!
//! Mirrors Playnite's `UplayLibrary.GetGames`:
//! 1. (optional) Scan installed games from the registry
//!    (`SOFTWARE\ubisoft\Launcher\Installs\`).
//! 2. (optional) Read the local product cache for the full owned
//!    library, keeping base games while ignoring addon (DLC) ids and
//!    dropping third-party / ULC entries.
//! 3. Merge: installed games get their metadata (cover/icon/background)
//!    from the library scan; uninstalled library entries are appended.
//! 4. Emit a [`UplaySyncResult`] the frontend Settings tile renders +
//!    the library import path consumes.
//!
//! Client actions mirror `UplayClient` / `UplayGameController`:
//! `uplay://launch`, `uplay://install`, `uplay://uninstall`, and
//! opening the Ubisoft Connect client.

use std::sync::{Arc, Mutex};
use rayon::prelude::*;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::{cache, client_install_path, is_client_installed};
use super::types::{ProductInformation, UplaySettings, UplaySyncResult, UplaySyncedGame};
use crate::game_watcher::GameWatcher;
use crate::metrics_collector;
use crate::size;
use crate::uplay::settings::load as load_settings;
use crate::util::current_unix;

/// Public Tauri command — scans installed + owned Ubisoft Connect games
/// per the user's settings toggles and returns a typed result.
#[tauri::command]
pub async fn uplay_sync_library(app: AppHandle) -> Result<UplaySyncResult, String> {
    let settings = load_settings(&app);
    Ok(sync_library_inner(&settings))
}

/// Build the sync result from current on-disk state + the given
/// settings. Pure (no auth) so it's trivially testable.
pub fn sync_library_inner(settings: &UplaySettings) -> UplaySyncResult {
    let client_installed = is_client_installed();
    let client_path = client_install_path();

    let mut errors: Vec<String> = Vec::new();
    let mut games_imported = 0usize;

    // ── Installed games (registry) ──
    let mut installed: Vec<UplayInstalledGameLite> = Vec::new();
    if settings.import_installed_games {
        let scanned = cache::scan_installed_uplay_games();
        for g in &scanned {
            if g.is_installed {
                games_imported += 1;
            } else {
                errors.push(format!(
                    "Ubisoft game {} installation directory {} not detected.",
                    g.name, g.install_dir
                ));
            }
            installed.push(UplayInstalledGameLite {
                uplay_id: g.uplay_id.clone(),
                name: g.name.clone(),
                install_dir: g.install_dir.clone(),
                is_installed: g.is_installed,
                cover_image: None,
                background_image: None,
                icon_image: None,
            });
        }
    }

    // ── Library games (cache) ──
    if settings.import_uninstalled_games {
        let products = cache::get_local_product_cache();
        if products.is_empty() {
            errors.push("Ubisoft Connect library cache is missing, empty or unreadable. Start Ubisoft Connect, log in, then sync again.".to_string());
        }

        // Playnite treats an entry's `addons` as the set of DLC ids to
        // ignore, keeping the base game that references them.
        let dlc_ids: std::collections::HashSet<u64> = products
            .iter()
            .flat_map(|p| p.root.addon_ids.iter().copied())
            .collect();

        for prod in filter_library_products(&products, &dlc_ids) {
            let Some(uplay_id) = prod.uplay_id else { continue };

            let uplay_id_str = uplay_id.to_string();
            let name = prod
                .root
                .name
                .clone()
                .unwrap_or_else(|| format!("Ubisoft Game {uplay_id_str}"));

            // If already installed, enrich the installed entry. Else
            // append as an uninstalled library entry.
            if let Some(inst) = installed.iter_mut().find(|i| i.uplay_id == uplay_id_str) {
                inst.cover_image = prod.root.thumb_image.clone();
                inst.background_image = prod.root.background_image.clone();
                inst.icon_image = prod.root.icon_image.clone();
            } else {
                installed.push(UplayInstalledGameLite {
                    uplay_id: uplay_id_str,
                    name,
                    install_dir: String::new(),
                    is_installed: false,
                    cover_image: None,
                    background_image: None,
                    icon_image: None,
                });
            }
        }
    }

    // ── Materialize DTOs ──
    // Measuring a Ubisoft install walks its folder tree, so the per-game
    // work runs on rayon rather than serially.
    let synced: Vec<UplaySyncedGame> = installed
        .par_iter()
        .map(|g| {
            let install_dir_opt = if g.install_dir.is_empty() {
                None
            } else {
                Some(std::path::Path::new(&g.install_dir))
            };
            let size_info = install_dir_opt.and_then(size::measure_folder_size);

            UplaySyncedGame {
                id: format!("uplay-{}", g.uplay_id),
                title: g.name.clone(),
                uplay_id: g.uplay_id.clone(),
                is_installed: g.is_installed,
                install_dir: if g.install_dir.is_empty() {
                    None
                } else {
                    Some(g.install_dir.clone())
                },
                background_image: g.background_image.clone(),
                cover_image: g.cover_image.clone(),
                icon_image: g.icon_image.clone(),
                size_bytes: size_info.as_ref().map(|s| s.size_bytes),
                size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
            }
        })
        .collect();

    UplaySyncResult {
        success: true,
        games_imported,
        games_skipped: 0,
        errors,
        last_sync: current_unix(),
        client_installed,
        client_path,
        synced_games: synced,
    }
}

/// Lightweight merge accumulator used during sync.
struct UplayInstalledGameLite {
    uplay_id: String,
    name: String,
    install_dir: String,
    is_installed: bool,
    cover_image: Option<String>,
    background_image: Option<String>,
    icon_image: Option<String>,
}

/// Pure Playnite-parity filter over the parsed product cache: keeps base
/// games, drops DLC entries whose id is referenced by another product's
/// `addons`, plus third-party-platform re-skins, `is_ulc` entries,
/// products without a `start_game` block, and anything lacking a
/// `uplay_id` (nothing to launch).
fn filter_library_products<'a>(
    products: &'a [ProductInformation],
    dlc_ids: &std::collections::HashSet<u64>,
) -> Vec<&'a ProductInformation> {
    products
        .iter()
        .filter(|p| {
            let Some(uplay_id) = p.uplay_id else {
                return false;
            };
            if dlc_ids.contains(&uplay_id) {
                return false;
            }
            if p.root.third_party_platform || p.root.is_ulc || !p.root.has_start_game {
                return false;
            }
            true
        })
        .collect()
}

/// Launch a specific Ubisoft Connect game via the `uplay://launch/<id>`
/// protocol. Returns the spawned PID (`0` when the protocol handler
/// (UbisoftConnect.exe) takes over). Mirrors Playnite's
/// `UplayPlayController.Play` → `Uplay.GetLaunchString`.
///
/// Registers a pending watcher session (initial PID 0) so the running
/// indicator, playtime recording, and `game-exited` / force-close all
/// work — the poll loop detects the real process via install-dir/exe
/// matching when the game launches (see game_watcher.rs pending-session
/// handling).
#[tauri::command]
pub async fn uplay_launch_game(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
    game_path: Option<String>,
    uplay_id: String,
) -> Result<u32, String> {
    let url = format!("uplay://launch/{}", uplay_id);
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to launch Ubisoft game: {e}"))?;

    let initial_pid = 0u32;

    // Lock the watcher once here (std::sync::Mutex is not reentrant) —
    // mirrors lib.rs::launch_game.
    let watcher: tauri::State<'_, Arc<Mutex<GameWatcher>>> = app.state();
    let mut w = watcher.lock().map_err(|e| e.to_string())?;

    // Pending session (initial_pid == 0) — wire dummy channels. Sends
    // will fail silently in finish_session — acceptable because metrics
    // were never started; the poll loop starts real collection when it
    // finds the process and transitions the session.
    let (dummy_stop_tx, _) = std::sync::mpsc::channel::<()>();
    let (_, dummy_metrics_rx) =
        std::sync::mpsc::channel::<Option<metrics_collector::SessionMetrics>>();

    w.register_launched_session(
        &app,
        &game_id,
        &game_name,
        "Uplay",
        None,
        game_path.as_deref(),
        initial_pid,
        dummy_stop_tx,
        dummy_metrics_rx,
        None,
    );

    Ok(initial_pid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::uplay::types::Product;
    use std::collections::HashSet;

    fn product(uplay_id: u64, addon_ids: Vec<u64>) -> ProductInformation {
        ProductInformation {
            root: Product {
                name: Some(format!("Game {uplay_id}")),
                background_image: None,
                thumb_image: None,
                logo_image: None,
                dialog_image: None,
                icon_image: None,
                third_party_platform: false,
                is_ulc: false,
                has_start_game: true,
                addon_ids,
            },
            uplay_id: Some(uplay_id),
            install_id: None,
        }
    }

    /// The regression this fix targets: a base game that has DLC must be
    /// kept, while the DLC's own cache entry is dropped.
    #[test]
    fn base_game_with_dlc_is_kept_and_dlc_entries_dropped() {
        let products = vec![product(100, vec![200, 300]), product(200, vec![])];
        let dlc_ids: HashSet<u64> = products
            .iter()
            .flat_map(|p| p.root.addon_ids.iter().copied())
            .collect();

        let kept = filter_library_products(&products, &dlc_ids);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].uplay_id, Some(100));
    }

    /// Third-party re-skins, ULC entries, missing `start_game` and
    /// missing ids are all filtered out; an ordinary base game survives.
    #[test]
    fn playnite_filters_drop_non_base_entries() {
        let mut third_party = product(1, vec![]);
        third_party.root.third_party_platform = true;
        let mut ulc = product(2, vec![]);
        ulc.root.is_ulc = true;
        let mut no_start = product(3, vec![]);
        no_start.root.has_start_game = false;
        let mut no_id = product(4, vec![]);
        no_id.uplay_id = None;

        let products = vec![third_party, ulc, no_start, no_id, product(5, vec![])];

        let kept = filter_library_products(&products, &HashSet::new());
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].uplay_id, Some(5));
    }
}

