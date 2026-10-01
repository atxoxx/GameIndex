use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use reqwest::Client;
use serde::Deserialize;
use tauri::Manager;

use super::family::{
    account_id_to_steam_id64, find_localconfig_path, parse_family_group_block,
    parse_friends_owned_games, parse_owned_apptickets,
};
use super::types::{SteamSession, SteamSyncResult, SyncedGameEntry};
use crate::game_watcher;
use crate::size;
use crate::steam_game_watcher;

/// Response from `IPlayerService/GetOwnedGames/v1/`.
#[derive(Debug, Deserialize)]
struct GetOwnedGamesResponse {
    response: OwnedGamesBody,
}

#[derive(Debug, Deserialize)]
struct OwnedGamesBody {
    #[serde(default)]
    games: Vec<OwnedGame>,
}

#[derive(Debug, Deserialize)]
struct OwnedGame {
    appid: u32,
    name: String,
    /// Playtime in minutes (API returns minutes, not hours)
    playtime_forever: u32,
    #[serde(default)]
    rtime_last_played: u64,
}

/// Sync games from a Steam account using the official Steam Web API.
///
/// `session.api_key` is passed as the `key=` query parameter on
/// `IPlayerService/GetOwnedGames/v1/`. The API key is a long-lived
/// registration token from <https://steamcommunity.com/dev/apikey>,
/// tied to the Steam account but valid for all Steam Web API calls
/// that the API-key owner can access (their own profile, owned
/// games, achievements, etc.).
///
/// Achievements (`ISteamUserStats/GetPlayerAchievements/v1/`) also
/// accepts `key=` — `fetch_achievements_with_client` builds its URLs
/// with `&key=<token>` already, so we pass `session.api_key` through
/// unchanged.
#[tauri::command]
pub async fn steam_sync_games(
    app: tauri::AppHandle,
    session: SteamSession,
    include_playtime: bool,
    include_achievements: bool,
    // Import titles only available through Steam Family Sharing.
    // `None` (older callers) is treated as enabled.
    include_family_sharing: Option<bool>,
) -> Result<SteamSyncResult, String> {
    // Steam ID validation guard.
    if !session.steam_id.chars().all(|c| c.is_ascii_digit())
        || session.steam_id.len() != 17
    {
        return Err(format!(
            "Invalid Steam ID in session: {}",
            session.steam_id
        ));
    }

    // ── Call the Steam Web API ─────────────────────────────────────
    let client = Client::builder()
        .user_agent(super::auth::USER_AGENT)
        // Bounds every request made with this client (the owned-games
        // call AND the fan-out achievement fetches below). Without a
        // timeout a single stalled connection would hang the whole
        // sync forever — including the final achievements-cache save,
        // so nothing synced would ever land on disk.
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/\
         ?key={}&steamid={}&include_appinfo=true\
         &include_played_free_games=true&format=json",
        session.api_key, session.steam_id
    );

    // Retry on 429 (rate limit) — Steam API is notorious for returning
    // 429 even after long idle periods.  Playnite retries up to 5 times.
    let mut retries = 3u32;
    let (status, body) = loop {
        // The owned-games response with `include_appinfo` can be several
        // MB for large accounts — give it double the default client
        // timeout, which is tuned for the short per-game achievement
        // fetches. A timeout here aborts the whole sync, so headroom is
        // cheap insurance.
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Steam API request failed: {e}"))?;

        let s = response.status();
        if s.as_u16() == 429 && retries > 0 {
            retries -= 1;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }

        let b = response
            .text()
            .await
            .unwrap_or_else(|_| "<empty>".to_string());

        break (s, b);
    };

    if !status.is_success() {
        return Err(format!(
            "Steam API returned HTTP {}: {}",
            status.as_u16(),
            &body[..body.len().min(500)]
        ));
    }

    let parsed: GetOwnedGamesResponse = serde_json::from_str(&body)
        .map_err(|e| {
            format!(
                "Failed to parse Steam API response (HTTP {}): {e}",
                status.as_u16()
            )
        })?;

    let owned_games = parsed.response.games;

    // ── Detect installed games on disk ──────────────────────────────
    // One scan of the appmanifest files feeds both signals: the fully-
    // installed set (drives the `installed` flag) and the manifest-
    // presence set (drives uninstall detection — see
    // `scan_steam_manifests`). The resolved install dirs it carries are
    // reused by the exe/size pass below, so each manifest is read once.
    let manifest_states = scan_steam_manifests();
    let installed_set: HashSet<u32> = manifest_states
        .iter()
        .filter(|(_, state)| state.fully_installed)
        .map(|(appid, _)| *appid)
        .collect();
    let mut installed_appids: Vec<u32> = installed_set.iter().copied().collect();
    installed_appids.sort();
    let manifest_appids: Vec<u32> = {
        let mut v: Vec<u32> = manifest_states.keys().copied().collect();
        v.sort();
        v
    };

    // ── Family-shared library ───────────────────────────────────────
    // Steam's owned-games API only returns titles this account owns, so the
    // family's shared copies are read from `localconfig.vdf` instead. Their
    // names are not stored locally, so resolve each with a best-effort store
    // lookup; an unresolved name falls back to a placeholder the library can
    // still display. Gated so turning the setting off skips the extra calls.
    let owned_appids: HashSet<u32> = owned_games.iter().map(|game| game.appid).collect();
    let family_shared: BTreeMap<u32, String> = if include_family_sharing.unwrap_or(true) {
        collect_family_shared_appids(&session.steam_id, &owned_appids, &manifest_states)
    } else {
        BTreeMap::new()
    };
    let mut shared_names: HashMap<u32, String> = HashMap::new();
    if !family_shared.is_empty() {
        let name_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
        let mut name_handles = Vec::with_capacity(family_shared.len());
        for appid in family_shared.keys().copied() {
            let permit = name_sem
                .clone()
                .acquire_owned()
                .await
                .map_err(|e| format!("family name semaphore: {e}"))?;
            let client = client.clone();
            name_handles.push(tokio::spawn(async move {
                let _permit = permit;
                (appid, fetch_steam_app_name(&client, appid).await)
            }));
        }
        for handle in name_handles {
            if let Ok((appid, Some(name))) = handle.await {
                shared_names.insert(appid, name);
            }
        }
    }

    let synced = (owned_games.len() + family_shared.len()) as u32;
    let mut playtime_updated: u32 = 0;

    // ── Disk work (exe resolution + folder size) ─────────────────────
    // These are blocking filesystem walks. Running them sequentially for
    // every installed game is the dominant cost of a sync on large
    // libraries, so we fan them out across a bounded pool of blocking
    // tasks (cap ~8 concurrent) and map the results back by appid.
    let disk_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let mut disk_handles: Vec<
        tokio::task::JoinHandle<(u32, Option<String>, Option<u64>, Option<String>)>,
    > = Vec::new();
    // Owned installed games plus any family-shared copies installed on disk —
    // both get their exe resolved and folder measured the same way.
    let mut disk_targets: Vec<(u32, String)> = owned_games
        .iter()
        .map(|game| (game.appid, game.name.clone()))
        .collect();
    for appid in family_shared.keys() {
        if !installed_set.contains(appid) {
            continue;
        }
        let name = shared_names.get(appid).cloned().unwrap_or_default();
        disk_targets.push((*appid, name));
    }
    for (appid, name) in disk_targets {
        if !installed_set.contains(&appid) {
            continue;
        }
        let permit = disk_sem
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("disk semaphore: {e}"))?;
        // The install dir comes straight from the single manifest scan
        // above (canonical, NOT derived from the exe's parent — that would
        // under-count UE/Unity/Source games where the largest .exe lives in
        // a bin subfolder). Re-resolving it here via `game_install_path`
        // would re-read the registry, `libraryfolders.vdf` and the manifest
        // once per installed game, which is the dominant cost on large
        // libraries.
        let install_dir = manifest_states
            .get(&appid)
            .and_then(|state| state.install_dir.clone());
        let handle = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            // Derive exe_path from the already-known install dir via the
            // smart resolver (PE header + name scoring + depth), and
            // measure the install dir directly.
            let exe_path = match install_dir.as_deref() {
                Some(dir) => game_watcher::resolve_game_exe(dir, &name),
                None => None,
            };
            // Measure the install dir if we have one. Per-game failure
            // (folder gone, permission denied) just leaves the size
            // fields None; the sync itself is never aborted.
            let size_info = install_dir.as_deref().and_then(size::measure_folder_size);
            (
                appid,
                exe_path,
                size_info.as_ref().map(|s| s.size_bytes),
                size_info.as_ref().map(|s| s.root_path.clone()),
            )
        });
        disk_handles.push(handle);
    }

    let mut disk_map: std::collections::HashMap<u32, (Option<String>, Option<u64>, Option<String>)> =
        std::collections::HashMap::new();
    for h in disk_handles {
        if let Ok(res) = h.await {
            disk_map.insert(res.0, (res.1, res.2, res.3));
        }
    }

    // ── Build the synced game list ───────────────────────────────────
    let mut synced_games: Vec<SyncedGameEntry> = Vec::with_capacity(owned_games.len());
    for game in &owned_games {
        if include_playtime && game.playtime_forever > 0 {
            playtime_updated += 1;
        }
        let (exe_path, size_bytes, size_root_path) = disk_map
            .get(&game.appid)
            .map(|(e, b, r)| (e.clone(), *b, r.clone()))
            .unwrap_or((None, None, None));
        let family_shared_by = manifest_states.get(&game.appid).and_then(|m| {
            m.last_owner.as_deref().and_then(|o| {
                if !o.is_empty() && o != "0" && o != session.steam_id {
                    Some(o.to_string())
                } else {
                    None
                }
            })
        });
        synced_games.push(SyncedGameEntry {
            appid: game.appid,
            name: game.name.clone(),
            playtime_forever: game.playtime_forever,
            exe_path,
            size_bytes,
            size_root_path,
            rtime_last_played: if game.rtime_last_played > 0 {
                Some(game.rtime_last_played)
            } else {
                None
            },
            family_shared_by,
        });
    }

    // Family-shared titles: no playtime (the account doesn't own them) and
    // no last-played, but they still carry their owner and any local install.
    for (appid, owner) in &family_shared {
        let (exe_path, size_bytes, size_root_path) = disk_map
            .get(appid)
            .map(|(e, b, r)| (e.clone(), *b, r.clone()))
            .unwrap_or((None, None, None));
        let name = shared_names
            .get(appid)
            .cloned()
            .unwrap_or_else(|| format!("Steam App {appid}"));
        synced_games.push(SyncedGameEntry {
            appid: *appid,
            name,
            playtime_forever: 0,
            exe_path,
            size_bytes,
            size_root_path,
            rtime_last_played: None,
            family_shared_by: Some(owner.clone()),
        });
    }

    // ── Sync achievements if requested ──────────────────────────────
    let mut achievements_synced: u32 = 0;
    if include_achievements {
        // Re-fetch only the games that need it, then persist each row
        // individually. Reading the whole cache payload just to consult
        // `last_synced` (and rewriting it after) is exactly the kind of
        // multi-MB in-memory round-trip the per-game store avoids.
        let db = app.state::<crate::db::Db>().inner().clone();
        let last_synced = crate::db::achievements::last_synced_map(&db).unwrap_or_default();
        let mut to_fetch: Vec<(String, u32)> = Vec::new();
        for game in &owned_games {
            let game_key = format!("steam-{}", game.appid);
            let needs_sync = match last_synced.get(&game_key) {
                None => true, // Not in cache
                Some(&last_synced_ms) => {
                    if installed_set.contains(&game.appid) {
                        true
                    } else if game.playtime_forever > 0 {
                        let last_played_ms = game.rtime_last_played * 1000;
                        last_played_ms > last_synced_ms
                    } else {
                        false
                    }
                }
            };
            if needs_sync {
                to_fetch.push((game_key, game.appid));
            }
        }

        if !to_fetch.is_empty() {
            let ach_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
            let mut handles = Vec::with_capacity(to_fetch.len());
            for (game_key, appid) in to_fetch {
                let permit = ach_sem
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|e| format!("achievement semaphore: {e}"))?;
                let client = client.clone();
                let steam_id = session.steam_id.clone();
                let api_key = session.api_key.clone();
                let handle = tokio::spawn(async move {
                    let _permit = permit;
                    let res = crate::achievements::fetch_achievements_with_client(
                        &client,
                        appid,
                        &steam_id,
                        &api_key,
                    )
                    .await;
                    (game_key, res)
                });
                handles.push(handle);
            }

            for h in handles {
                match h.await {
                    Ok((game_key, Ok(mut data))) => {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        data.last_synced = Some(now_ms);
                        let payload = serde_json::to_string(&data).unwrap_or_default();
                        match crate::db::achievements::upsert(
                            &db,
                            &game_key,
                            data.steam_app_id,
                            &payload,
                            now_ms,
                            "steam",
                            data.provider_id.as_deref(),
                        ) {
                            Ok(()) => achievements_synced += 1,
                            Err(e) => eprintln!(
                                "[steam_sync] Failed to save achievements for {}: {}",
                                game_key, e
                            ),
                        }
                    }
                    Ok((game_key, Err(e))) => {
                        eprintln!(
                            "[steam_sync] Failed to fetch achievements for {}: {}",
                            game_key, e
                        );
                    }
                    Err(e) => {
                        eprintln!("[steam_sync] achievement task panicked: {}", e);
                    }
                }
            }
        }
    }

    Ok(SteamSyncResult {
        success: true,
        games_synced: synced,
        playtime_updated,
        achievements_synced,
        synced_games,
        installed_appids,
        manifest_appids,
        error: None,
    })
}

/// Merge the family-shared app IDs the current account can play into a map of
/// `appid -> owner SteamID64`. Two local sources feed it:
///
///   • installed shared copies, whose `appmanifest` `LastOwner` is another
///     account (the manifest scan already resolved these);
///   • the family group's per-member owned-games cache in `localconfig.vdf`
///     (`FriendsOwnedGames_storage_<accountid>`), which also covers titles the
///     user has not installed yet.
///
/// Apps the current account owns (from the Steam API or local app tickets) are
/// never reported as shared, so a title the user later buys stops showing as
/// shared. When both sources name an app, the manifest's `LastOwner` wins.
pub fn merge_family_shared_appids(
    current_steam_id: &str,
    owned_appids: &HashSet<u32>,
    manifest_last_owners: &HashMap<u32, String>,
    owned_tickets: &HashSet<u32>,
    friends_owned_games: &HashMap<u32, Vec<u32>>,
    family_member_account_ids: &HashSet<u32>,
) -> BTreeMap<u32, String> {
    let mut shared: BTreeMap<u32, String> = BTreeMap::new();

    for (appid, owner) in manifest_last_owners {
        if owned_appids.contains(appid) || owned_tickets.contains(appid) {
            continue;
        }
        if !owner.is_empty() && owner != "0" && owner != current_steam_id {
            shared.insert(*appid, owner.clone());
        }
    }

    for (account_id, appids) in friends_owned_games {
        if !family_member_account_ids.contains(account_id) {
            continue;
        }
        let owner = account_id_to_steam_id64(*account_id).to_string();
        for appid in appids {
            if owned_appids.contains(appid) || owned_tickets.contains(appid) {
                continue;
            }
            shared.entry(*appid).or_insert_with(|| owner.clone());
        }
    }

    shared
}

/// Read the local Steam config and build the family-shared app map for the
/// signed-in account. Best-effort: a missing `localconfig.vdf` still yields
/// the manifest-derived entries (installed shared copies).
fn collect_family_shared_appids(
    current_steam_id: &str,
    owned_appids: &HashSet<u32>,
    manifest_states: &HashMap<u32, SteamManifestState>,
) -> BTreeMap<u32, String> {
    let manifest_last_owners: HashMap<u32, String> = manifest_states
        .iter()
        .filter_map(|(appid, state)| state.last_owner.clone().map(|owner| (*appid, owner)))
        .collect();

    let mut owned_tickets: HashSet<u32> = HashSet::new();
    let mut friends_owned_games: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut family_member_account_ids: HashSet<u32> = HashSet::new();

    if let Some(content) =
        find_localconfig_path(Some(current_steam_id)).and_then(|path| fs::read_to_string(path).ok())
    {
        owned_tickets = parse_owned_apptickets(&content);
        friends_owned_games = parse_friends_owned_games(&content);
        family_member_account_ids = parse_family_group_block(&content)
            .map(|(_, _, _, members)| {
                members
                    .into_iter()
                    .map(|(account_id, _)| account_id)
                    .collect()
            })
            .unwrap_or_default();
    }

    merge_family_shared_appids(
        current_steam_id,
        owned_appids,
        &manifest_last_owners,
        &owned_tickets,
        &friends_owned_games,
        &family_member_account_ids,
    )
}

/// Best-effort Steam Store lookup for an app's display name. `None` when the
/// store is unreachable or the app has no page (soundtracks, tools).
async fn fetch_steam_app_name(client: &Client, app_id: u32) -> Option<String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={app_id}&cc=us&l=en"
    );
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let json: serde_json::Value = response.json().await.ok()?;
    json.get(app_id.to_string())?
        .get("data")?
        .get("name")?
        .as_str()
        .map(str::to_string)
}

// ── installed-game detection ────────────────────────────────────────

/// Per-AppID state from a single manifest scan. Carries the resolved
/// install directory alongside the install-state flag so callers that
/// need both (the sync's exe/size pass) don't have to re-read the
/// registry, `libraryfolders.vdf` and every manifest a second time.
#[derive(Debug, Clone)]
pub struct SteamManifestState {
    /// `true` when Steam reports the app fully installed (`StateFlags`
    /// bit 4). See `AppManifestFields::is_fully_installed`.
    pub fully_installed: bool,
    /// `<library>\steamapps\common\<installdir>` when the manifest parsed,
    /// `None` when the manifest was unreadable/unparseable (the AppID is
    /// still counted as present so uninstall detection stays conservative).
    pub install_dir: Option<PathBuf>,
    /// SteamID64 of the owner that installed/authorized the game (from LastOwner in the manifest).
    pub last_owner: Option<String>,
    /// Installed DLC AppIDs from InstalledDepots and optionaldlc
    pub installed_dlcs: Vec<u32>,
}

/// Scan every `appmanifest_<appid>.acf` under the Steam library folders
/// and report each AppID's full state, reading every manifest. Backs the
/// sync flow (which needs install dirs, owners and DLC lists); the
/// background watcher's install/uninstall detection uses the cheaper
/// presence-only [`scan_steam_manifest_paths`] instead.
///
/// The *presence* of a manifest is the load-bearing signal: Steam deletes
/// the file entirely when a game is uninstalled, but keeps it (and merely
/// flips `StateFlags`) while a game is downloading an update. So an AppID
/// disappearing from this map means a genuine uninstall, while an entry
/// present-but-`fully_installed == false` means "mid-download/update,
/// still registered". Unreadable/unparseable manifests are assumed
/// installed (historic behaviour — better to over-count than to lose a
/// tracked game).
pub fn scan_steam_manifests() -> std::collections::HashMap<u32, SteamManifestState> {
    let Some(paths) = scan_steam_manifest_paths() else {
        return std::collections::HashMap::new();
    };

    let mut states = std::collections::HashMap::with_capacity(paths.len());
    for (appid, manifest_path) in paths {
        // The library's `steamapps` dir is the manifest's parent, so the
        // install root composes identically to `game_install_path`
        // without a second manifest read.
        let steamapps_dir = manifest_path.parent();
        let (fully_installed, install_dir, last_owner, installed_dlcs) =
            match fs::read_to_string(&manifest_path) {
                Ok(raw) => match steam_game_watcher::parse_appmanifest(&raw, appid) {
                    Some(parsed) => (
                        parsed.is_fully_installed(),
                        steamapps_dir.map(|dir| dir.join("common").join(&parsed.install_dir)),
                        parsed.last_owner,
                        parsed.installed_dlcs,
                    ),
                    None => (true, None, None, Vec::new()), // unparseable → assume installed
                },
                Err(_) => (true, None, None, Vec::new()), // unreadable → assume installed
            };
        states.insert(
            appid,
            SteamManifestState {
                fully_installed,
                install_dir,
                last_owner,
                installed_dlcs,
            },
        );
    }

    states
}

/// Presence-only scan of every `appmanifest_<appid>.acf` under the Steam
/// library folders. Maps AppID → manifest path and reads **no file
/// contents**, so it stays cheap on very large libraries.
///
/// This is the primitive behind the background watcher's uninstall
/// detection: Steam deletes the manifest on uninstall, so the *set* of
/// files on disk is the signal, and re-reading every manifest to learn
/// `StateFlags` (as [`scan_steam_manifests`] must for sync) is wasted I/O.
///
/// Returns `None` when no local Steam install can be located, which the
/// caller must distinguish from "Steam with zero manifests" — only the
/// former makes an empty result meaningless rather than a wholesale
/// uninstall.
pub fn scan_steam_manifest_paths() -> Option<HashMap<u32, PathBuf>> {
    let library_folders = find_steam_library_folders();
    if library_folders.is_empty() {
        return None;
    }

    let mut paths = HashMap::new();
    for folder in &library_folders {
        let Ok(entries) = fs::read_dir(folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                let id_str = &name_str["appmanifest_".len()..name_str.len() - ".acf".len()];
                if let Ok(appid) = id_str.parse::<u32>() {
                    paths.insert(appid, entry.path());
                }
            }
        }
    }

    Some(paths)
}

/// Install-state-only view of a manifest scan (see [`scan_steam_manifests`]).
pub fn detect_steam_manifest_state() -> std::collections::HashMap<u32, bool> {
    scan_steam_manifests()
        .into_iter()
        .map(|(appid, state)| (appid, state.fully_installed))
        .collect()
}

/// AppIDs whose games are fully installed (subset of the manifest
/// state — see `detect_steam_manifest_state`). Kept as a convenience
/// for callers that only care about the playable set; currently
/// exercised by the integration tests (the live sync consumes the
/// richer per-appid map directly, and the watcher uses the
/// presence-only [`scan_steam_manifest_paths`]).
#[cfg_attr(not(test), allow(dead_code))]
pub fn detect_installed_steam_appids() -> Vec<u32> {
    let mut installed: Vec<u32> = detect_steam_manifest_state()
        .into_iter()
        .filter_map(|(appid, fully)| fully.then_some(appid))
        .collect();
    installed.sort();
    installed
}

fn find_steam_library_folders() -> Vec<PathBuf> {
    // Resolve the primary Steam root via the registry-aware detector so
    // non-default install locations (any drive / custom folder) are
    // picked up. Falls back to the classic default folders.
    let steam_root = match steam_game_watcher::find_steam_install_dir() {
        Some(r) => r,
        None => return Vec::new(),
    };

    let mut folders = vec![steam_root.join("steamapps")];

    // Reuse the watcher's VDF parser instead of the old line-based
    // `"path"` scan: the flat `"1" "/mnt/games/SteamLibrary"` layout
    // (older Steam clients, common on Linux) was invisible to that
    // scan, so games on secondary drives never got measured.
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(&vdf_path) {
        for lib_root in steam_game_watcher::parse_library_folders(&content) {
            let steamapps = lib_root.join("steamapps");
            if steamapps.exists() && !folders.contains(&steamapps) {
                folders.push(steamapps);
            }
        }
    }

    folders
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Integration check against the machine's real Steam install (when
    /// present): the appmanifest scan must exactly match an independent
    /// walk of the same library folders. This is the mechanism that
    /// picks up newly installed games — a fresh `appmanifest_<id>.acf`
    /// written by Steam is exactly what this detector reads. Skips
    /// gracefully when Steam is absent so the suite stays green on
    /// dev boxes without Steam.
    #[test]
    fn detect_installed_matches_independent_manifest_walk() {
        let folders = find_steam_library_folders();
        if folders.is_empty() {
            eprintln!("[test] Steam not installed — skipping integration check");
            return;
        }

        // Ground truth: every appmanifest_<appid>.acf in the same folders.
        let mut expected: Vec<u32> = Vec::new();
        for folder in &folders {
            if let Ok(entries) = fs::read_dir(folder) {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                        let id_str =
                            &name_str["appmanifest_".len()..name_str.len() - ".acf".len()];
                        if let Ok(appid) = id_str.parse::<u32>() {
                            expected.push(appid);
                        }
                    }
                }
            }
        }
        expected.sort();
        expected.dedup();

        let detected = detect_installed_steam_appids();
        assert_eq!(
            detected, expected,
            "detector must match the real appmanifest files on disk"
        );
    }

    /// The manifest-state scanner must report *every* appmanifest on disk
    /// (presence is the uninstall signal — Steam deletes the file on
    /// uninstall) and the fully-installed set must be a subset of it.
    /// Skips without Steam.
    #[test]
    fn manifest_state_presence_matches_independent_walk() {
        let folders = find_steam_library_folders();
        if folders.is_empty() {
            eprintln!("[test] Steam not installed — skipping integration check");
            return;
        }

        // Ground truth: every appmanifest_<appid>.acf in the same folders.
        let mut expected: Vec<u32> = Vec::new();
        for folder in &folders {
            if let Ok(entries) = fs::read_dir(folder) {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                        let id_str =
                            &name_str["appmanifest_".len()..name_str.len() - ".acf".len()];
                        if let Ok(appid) = id_str.parse::<u32>() {
                            expected.push(appid);
                        }
                    }
                }
            }
        }
        expected.sort();
        expected.dedup();

        let mut state_keys: Vec<u32> = detect_steam_manifest_state().into_keys().collect();
        state_keys.sort();
        assert_eq!(
            state_keys, expected,
            "manifest-state scanner must see every appmanifest file"
        );

        // Installed is a strict subset of present: a fully-installed game
        // always has a manifest, but a present manifest can be mid-update.
        let installed = detect_installed_steam_appids();
        for appid in &installed {
            assert!(
                expected.contains(appid),
                "installed appid {} must have a manifest on disk",
                appid
            );
        }
    }

    /// The sync.rs library-folder parser (naive `"path"` line scan) and
    /// the watcher's smart VDF parser must agree on the real
    /// libraryfolders.vdf — otherwise games on secondary drives are
    /// silently invisible to install detection. Skips without Steam.
    #[test]
    fn library_folder_parsers_agree_on_real_vdf() {
        let naive_steamapps = find_steam_library_folders();
        if naive_steamapps.is_empty() {
            eprintln!("[test] Steam not installed — skipping integration check");
            return;
        }

        let steam_root =
            crate::steam_game_watcher::find_steam_install_dir().expect("steam root present");
        let vdf = fs::read_to_string(steam_root.join("steamapps").join("libraryfolders.vdf"))
            .expect("read libraryfolders.vdf");
        let smart_roots = crate::steam_game_watcher::parse_library_folders(&vdf);

        // Smart parser yields library roots; map to steamapps folders and
        // keep only folders that actually exist on disk (the naive parser
        // skips missing ones, e.g. an unplugged drive).
        let mut smart_steamapps: Vec<PathBuf> = smart_roots
            .into_iter()
            .map(|r| r.join("steamapps"))
            .filter(|p| p.exists())
            .collect();
        smart_steamapps.push(steam_root.join("steamapps"));
        smart_steamapps.sort();
        smart_steamapps.dedup();

        let mut naive = naive_steamapps;
        naive.sort();
        naive.dedup();

        assert_eq!(naive, smart_steamapps);
    }

    fn appid_set(ids: &[u32]) -> HashSet<u32> {
        ids.iter().copied().collect()
    }

    fn owner_map(pairs: &[(u32, &str)]) -> HashMap<u32, String> {
        pairs
            .iter()
            .map(|(appid, owner)| (*appid, owner.to_string()))
            .collect()
    }

    #[test]
    fn family_shared_merge_excludes_owned_and_non_members() {
        let owned = appid_set(&[1]);
        let tickets = appid_set(&[9]);
        let manifest = owner_map(&[(2, "76561190000000002")]);
        let mut friends: HashMap<u32, Vec<u32>> = HashMap::new();
        friends.insert(42, vec![2, 3, 9]);
        friends.insert(99, vec![4]); // a friend, not a family member
        let members = appid_set(&[42]);

        let shared = merge_family_shared_appids(
            "76561190000000001",
            &owned,
            &manifest,
            &tickets,
            &friends,
            &members,
        );

        assert!(!shared.contains_key(&1), "owned app must not be shared");
        assert!(!shared.contains_key(&9), "owned ticket must not be shared");
        assert!(!shared.contains_key(&4), "non-member friend must not be shared");
        // The manifest owner wins over the friends cache for appid 2.
        assert_eq!(shared.get(&2).map(String::as_str), Some("76561190000000002"));
        // appid 3 comes only from the family member's cache.
        let expected_owner = account_id_to_steam_id64(42).to_string();
        assert_eq!(
            shared.get(&3).map(String::as_str),
            Some(expected_owner.as_str())
        );
    }

    #[test]
    fn family_shared_merge_ignores_current_user_and_zero_owner() {
        let owned = appid_set(&[]);
        let tickets = appid_set(&[]);
        let manifest = owner_map(&[
            (1, "76561190000000001"), // current user
            (2, "0"),                 // unset
            (3, ""),                  // empty
            (4, "76561190000000002"), // a real lender
        ]);

        let shared = merge_family_shared_appids(
            "76561190000000001",
            &owned,
            &manifest,
            &tickets,
            &HashMap::new(),
            &HashSet::new(),
        );

        assert_eq!(shared.len(), 1);
        assert_eq!(shared.get(&4).map(String::as_str), Some("76561190000000002"));
    }
}


