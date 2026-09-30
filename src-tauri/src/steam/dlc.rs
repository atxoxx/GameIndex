//! Steam DLC detection, store catalog fetch, and ownership tracking.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::db;
use crate::store_checker::StoreChecker;
use super::auth::USER_AGENT;
use super::family::steam_get_family_share_info;
use super::sync::scan_steam_manifests;
use super::types::{SteamDlcItem, SteamGameDlcsResult};

const DLC_CACHE_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours

/// Steam storefront `l=` code for each UI locale the app ships. Mirrors
/// `UI_LANGUAGES` in `src/i18n/languages.ts`; unknown locales fall back to
/// English. Kept here so the command localizes correctly even when a caller
/// omits `lang` (older frontends, direct IPC).
const STEAM_LANG_BY_UI_CODE: &[(&str, &str)] = &[
    ("en", "english"),
    ("fr", "french"),
    ("es", "spanish"),
    ("de", "german"),
    ("ru", "russian"),
    ("zh-CN", "schinese"),
];

/// Resolve the UI language stored in the kv table into its Steam `l=` code.
fn resolve_steam_lang(app: &AppHandle) -> String {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let ui_code = db::kv::get(db_state.inner(), "language")
        .ok()
        .flatten()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string());
    STEAM_LANG_BY_UI_CODE
        .iter()
        .find(|(code, _)| *code == ui_code)
        .map(|(_, steam)| steam.to_string())
        .unwrap_or_else(|| "english".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedDlcBlob {
    timestamp: u64,
    dlcs: Vec<SteamDlcItem>,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Fetch DLCs for a given Steam AppID.
#[tauri::command]
pub async fn steam_get_game_dlcs(
    app: AppHandle,
    store_checker: tauri::State<'_, Arc<Mutex<StoreChecker>>>,
    app_id: u32,
    lang: Option<String>,
    force_refresh: Option<bool>,
) -> Result<SteamGameDlcsResult, String> {
    // Prefer the caller's language; otherwise localize to the user's saved UI
    // language so the DLC names/descriptions/price strings match the app.
    let target_lang = lang.unwrap_or_else(|| resolve_steam_lang(&app));
    let db = app.state::<db::Db>().inner().clone();

    // 1. Check family share status for this game
    let family_share = steam_get_family_share_info(app.clone(), app_id)
        .await
        .ok()
        .filter(|f| f.is_shared);

    // 2. Scan local manifests to check if base game is installed and get installed DLC IDs
    let manifests = scan_steam_manifests();
    let base_game_installed = manifests.get(&app_id).map(|s| s.fully_installed).unwrap_or(false);
    let installed_dlc_ids: HashSet<u32> = manifests
        .get(&app_id)
        .map(|s| s.installed_dlcs.iter().copied().collect())
        .unwrap_or_default();

    // 3. Extract owned tickets and family shared DLCs from localconfig.vdf
    let local_content = {
        let (_login_users, detected_active_sid) = super::family::parse_local_loginusers();
        let session = super::family::get_saved_steam_session();
        let cur_sid = session.as_ref().map(|s| s.steam_id.clone()).or(detected_active_sid);
        super::family::find_localconfig_path(cur_sid.as_deref())
            .and_then(|p| std::fs::read_to_string(p).ok())
    };

    let owned_tickets = local_content.as_deref().map(super::family::parse_owned_apptickets).unwrap_or_default();
    let friends_games = local_content.as_deref().map(super::family::parse_friends_owned_games).unwrap_or_default();
    let mut family_shared_dlcs: HashSet<u32> = HashSet::new();
    for apps in friends_games.values() {
        for aid in apps {
            family_shared_dlcs.insert(*aid);
        }
    }

    // 4. Get owned Steam AppIDs from store_checker and local manifests
    let owned_appids: HashSet<u32> = {
        let checker = store_checker.lock().await;
        let mut set: HashSet<u32> = checker.get_steam_appids().clone();
        for id in manifests.keys() {
            set.insert(*id);
        }
        set
    };

    // Helper closure to evaluate ownership and installation status
    let evaluate_dlc = |item: &mut SteamDlcItem| {
        let is_manifest_installed = installed_dlc_ids.contains(&item.app_id);
        let is_ticket_owned = owned_tickets.contains(&item.app_id);
        let is_family_owned = family_shared_dlcs.contains(&item.app_id);
        let is_store_checker_owned = owned_appids.contains(&item.app_id);
        let is_free_with_base = item.is_free && base_game_installed;

        let manual_key = format!("steam_dlc_owned_{}", item.app_id);
        let manual_owned = db::kv::get(&db, &manual_key).ok().flatten();

        if let Some(val) = manual_owned {
            item.is_owned = val == "1";
        } else if is_manifest_installed || is_ticket_owned || is_family_owned || is_store_checker_owned || is_free_with_base {
            item.is_owned = true;
        }

        if is_manifest_installed || manifests.contains_key(&item.app_id) || (base_game_installed && item.is_owned) {
            item.is_installed = true;
        }
    };

    let cache_key = format!("steam_dlc_cache_{app_id}_{target_lang}");

    // Check cached DLC data
    if force_refresh != Some(true) {
        if let Ok(Some(cached_json)) = db::kv::get(&db, &cache_key) {
            if let Ok(blob) = serde_json::from_str::<CachedDlcBlob>(&cached_json) {
                if unix_now().saturating_sub(blob.timestamp) < DLC_CACHE_TTL_SECS {
                    let mut dlcs = blob.dlcs;
                    let mut owned_count = 0;
                    let mut installed_count = 0;

                    for item in &mut dlcs {
                        evaluate_dlc(item);
                        if item.is_owned {
                            owned_count += 1;
                        }
                        if item.is_installed {
                            installed_count += 1;
                        }
                    }

                    return Ok(SteamGameDlcsResult {
                        app_id,
                        total_dlcs: dlcs.len() as u32,
                        owned_count,
                        installed_count,
                        dlcs,
                        family_share,
                    });
                }
            }
        }
    }

    // 5. Fetch base game appdetails from Steam Store API to discover its DLCs
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    let store_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={app_id}&l={target_lang}"
    );

    let resp = client
        .get(&store_url)
        .send()
        .await
        .map_err(|e| format!("Steam store request: {e}"))?;

    let body = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Steam store json: {e}"))?;

    let app_str = app_id.to_string();
    let app_data = match body.get(&app_str).and_then(|v| v.get("data")) {
        Some(d) => d,
        None => {
            return Ok(SteamGameDlcsResult {
                app_id,
                total_dlcs: 0,
                owned_count: 0,
                installed_count: 0,
                dlcs: Vec::new(),
                family_share,
            });
        }
    };

    let mut dlc_appids: Vec<u32> = app_data
        .get("dlc")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|val| val.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();

    // Ensure any installed DLC IDs discovered from manifests are also included
    for id in &installed_dlc_ids {
        if !dlc_appids.contains(id) {
            dlc_appids.push(*id);
        }
    }

    if dlc_appids.is_empty() {
        return Ok(SteamGameDlcsResult {
            app_id,
            total_dlcs: 0,
            owned_count: 0,
            installed_count: 0,
            dlcs: Vec::new(),
            family_share,
        });
    }

    // Cap at 100 DLCs to prevent excessive fan-out on games like Train Simulator or Rocksmith
    let limited_dlcs: Vec<u32> = dlc_appids.into_iter().take(100).collect();

    // 6. Fan out requests across Semaphore
    let sem = Arc::new(tokio::sync::Semaphore::new(8));
    let mut handles = Vec::with_capacity(limited_dlcs.len());

    for dlc_id in limited_dlcs {
        let client = client.clone();
        let lang = target_lang.clone();
        let permit = sem.clone().acquire_owned().await.map_err(|e| e.to_string())?;

        let handle = tokio::spawn(async move {
            let _permit = permit;
            let url = format!(
                "https://store.steampowered.com/api/appdetails?appids={dlc_id}&l={lang}"
            );

            let res = client.get(&url).send().await;
            if let Ok(r) = res {
                if let Ok(json) = r.json::<serde_json::Value>().await {
                    let dlc_str = dlc_id.to_string();
                    if let Some(data) = json.get(&dlc_str).and_then(|v| v.get("data")) {
                        let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("DLC").to_string();
                        let header_image = data.get("header_image")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                            .or_else(|| Some(format!("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{dlc_id}/header.jpg")));

                        let is_free = data.get("is_free").and_then(|v| v.as_bool()).unwrap_or(false);
                        let price_overview = data.get("price_overview");
                        let price_formatted = price_overview
                            .and_then(|p| p.get("final_formatted"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        let initial_price_formatted = price_overview
                            .and_then(|p| p.get("initial_formatted"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        let discount_percent = price_overview
                            .and_then(|p| p.get("discount_percent"))
                            .and_then(|v| v.as_u64())
                            .map(|n| n as u32);

                        let release_date = data.get("release_date")
                            .and_then(|r| r.get("date"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);

                        let short_description = data.get("short_description")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);

                        return Some(SteamDlcItem {
                            app_id: dlc_id,
                            name,
                            header_image,
                            price_formatted,
                            initial_price_formatted,
                            discount_percent,
                            is_free,
                            release_date,
                            short_description,
                            is_owned: false,
                            is_installed: false,
                        });
                    }
                }
            }

            // Fallback lightweight item when appdetails fails or is unavailable
            Some(SteamDlcItem {
                app_id: dlc_id,
                name: format!("DLC #{dlc_id}"),
                header_image: Some(format!("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{dlc_id}/header.jpg")),
                price_formatted: None,
                initial_price_formatted: None,
                discount_percent: None,
                is_free: false,
                release_date: None,
                short_description: None,
                is_owned: false,
                is_installed: false,
            })
        });

        handles.push(handle);
    }

    let mut dlcs = Vec::with_capacity(handles.len());
    let mut owned_count = 0;
    let mut installed_count = 0;

    for h in handles {
        if let Ok(Some(mut item)) = h.await {
            evaluate_dlc(&mut item);
            if item.is_owned {
                owned_count += 1;
            }
            if item.is_installed {
                installed_count += 1;
            }

            dlcs.push(item);
        }
    }

    // Save to cache
    let blob = CachedDlcBlob {
        timestamp: unix_now(),
        dlcs: dlcs.clone(),
    };
    if let Ok(serialized) = serde_json::to_string(&blob) {
        let _ = db::kv::set(&db, &cache_key, &serialized);
    }

    Ok(SteamGameDlcsResult {
        app_id,
        total_dlcs: dlcs.len() as u32,
        owned_count,
        installed_count,
        dlcs,
        family_share,
    })
}

/// Tauri command: manually toggle user DLC ownership status.
#[tauri::command]
pub fn steam_toggle_dlc_owned(
    app: AppHandle,
    _app_id: u32,
    dlc_app_id: u32,
    owned: bool,
) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    let manual_key = format!("steam_dlc_owned_{dlc_app_id}");
    db::kv::set(&db, &manual_key, if owned { "1" } else { "0" })
}
