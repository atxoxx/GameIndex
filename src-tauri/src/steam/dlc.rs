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
    #[serde(default)]
    total_available: u32,
}

/// Dedupe discovered DLC AppIDs (preserving first-seen order), move ids in
/// `known` to the front so owned/installed DLC survive the cap, then truncate
/// to `cap`. Returns the capped list plus the total count before truncation.
fn order_dlc_appids(discovered: Vec<u32>, known: &HashSet<u32>, cap: usize) -> (Vec<u32>, u32) {
    let mut seen: HashSet<u32> = HashSet::with_capacity(discovered.len());
    let mut deduped: Vec<u32> = Vec::with_capacity(discovered.len());
    for id in discovered {
        if seen.insert(id) {
            deduped.push(id);
        }
    }

    let total_available = deduped.len() as u32;

    let mut ordered: Vec<u32> = Vec::with_capacity(deduped.len());
    ordered.extend(deduped.iter().copied().filter(|id| known.contains(id)));
    ordered.extend(deduped.iter().copied().filter(|id| !known.contains(id)));
    ordered.truncate(cap);

    (ordered, total_available)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// GET a single app's `appdetails` payload and return its `data` object.
///
/// The body is read as text and parsed manually so a non-JSON reply (Steam
/// intermittently answers localized requests with an HTML error or age-gate
/// page) is logged with a snippet instead of surfacing a bare
/// `error decoding response body`. Transport, 429/5xx and decode failures
/// are retried up to `attempts` times.
async fn fetch_appdetails(
    client: &Client,
    app_id: u32,
    lang: &str,
    attempts: u32,
) -> Result<Option<serde_json::Value>, String> {
    let url =
        format!("https://store.steampowered.com/api/appdetails?appids={app_id}&l={lang}");

    let mut last_err = String::from("no response");
    for attempt in 0..attempts.max(1) {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("request failed: {e}");
                continue;
            }
        };

        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            last_err = format!("Steam store returned HTTP {status}");
            continue;
        }
        if !status.is_success() {
            return Err(format!("Steam store returned HTTP {status}"));
        }

        let body = match resp.text().await {
            Ok(b) => b,
            Err(e) => {
                last_err = format!("reading response body failed: {e}");
                continue;
            }
        };

        let json: serde_json::Value = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(e) => {
                let snippet: String = body.chars().take(300).collect();
                last_err = format!("invalid JSON ({e}); body starts with: {snippet}");
                continue;
            }
        };

        return Ok(appdetails_data(&json, app_id));
    }

    Err(last_err)
}

/// Pick the `data` object out of a parsed appdetails response. `None` when the
/// store reported `success: false`, answered with a non-object payload, or
/// keyed the response under a different app id.
fn appdetails_data(json: &serde_json::Value, app_id: u32) -> Option<serde_json::Value> {
    json.get(app_id.to_string())
        .and_then(|v| v.get("data"))
        .filter(|d| d.is_object())
        .cloned()
}

/// Lightweight DLC placeholder used when the store has no page for an app
/// (delisted/unreleased) or the request failed after retries.
fn fallback_dlc_item(dlc_id: u32) -> SteamDlcItem {
    SteamDlcItem {
        app_id: dlc_id,
        name: format!("DLC #{dlc_id}"),
        header_image: Some(format!(
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{dlc_id}/header.jpg"
        )),
        price_formatted: None,
        initial_price_formatted: None,
        discount_percent: None,
        is_free: false,
        release_date: None,
        short_description: None,
        is_owned: false,
        is_installed: false,
    }
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

    // Check cached DLC data. A fresh blob is served directly; an expired one
    // is retained as a fallback in case the store is unreachable below.
    let mut stale: Option<CachedDlcBlob> = None;
    if let Ok(Some(cached_json)) = db::kv::get(&db, &cache_key) {
        if let Ok(blob) = serde_json::from_str::<CachedDlcBlob>(&cached_json) {
            let is_fresh = unix_now().saturating_sub(blob.timestamp) < DLC_CACHE_TTL_SECS;
            if force_refresh != Some(true) && is_fresh {
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
                    total_available: blob.total_available,
                    owned_count,
                    installed_count,
                    dlcs,
                    family_share,
                });
            }
            stale = Some(blob);
        }
    }

    // 5. Fetch base game appdetails from Steam Store API to discover its DLCs
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    let app_data = match fetch_appdetails(&client, app_id, &target_lang, 2).await {
        Ok(Some(d)) => d,
        Ok(None) => {
            // The store has no data for this app (delisted, unreleased, or
            // region-locked) — an empty catalog is a valid, cacheable answer.
            return Ok(SteamGameDlcsResult {
                app_id,
                total_dlcs: 0,
                total_available: 0,
                owned_count: 0,
                installed_count: 0,
                dlcs: Vec::new(),
                family_share,
            });
        }
        Err(e) => {
            if let Some(blob) = stale {
                eprintln!(
                    "[steam dlc] base appdetails for {app_id} ({target_lang}) failed: {e}; serving cached catalog"
                );
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
                    total_available: blob.total_available,
                    owned_count,
                    installed_count,
                    dlcs,
                    family_share,
                });
            }
            eprintln!("[steam dlc] base appdetails for {app_id} ({target_lang}) failed: {e}");
            return Err(format!("Steam store: {e}"));
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
            total_available: 0,
            owned_count: 0,
            installed_count: 0,
            dlcs: Vec::new(),
            family_share,
        });
    }

    // Known-owned/installed ids are kept ahead of the cap so a large catalog
    // can never hide DLC the user already has.
    let mut known: HashSet<u32> = HashSet::with_capacity(
        installed_dlc_ids.len() + owned_tickets.len() + family_shared_dlcs.len(),
    );
    known.extend(installed_dlc_ids.iter().copied());
    known.extend(owned_tickets.iter().copied());
    known.extend(family_shared_dlcs.iter().copied());
    for id in &dlc_appids {
        let manual_key = format!("steam_dlc_owned_{id}");
        if db::kv::get(&db, &manual_key).ok().flatten().as_deref() == Some("1") {
            known.insert(*id);
        }
    }

    // Cap at 100 DLCs to prevent excessive fan-out on games like Train Simulator or Rocksmith
    let (limited_dlcs, total_available) = order_dlc_appids(dlc_appids, &known, 100);

    // 6. Fan out requests across Semaphore
    let sem = Arc::new(tokio::sync::Semaphore::new(8));
    let mut handles = Vec::with_capacity(limited_dlcs.len());

    for dlc_id in limited_dlcs {
        let client = client.clone();
        let lang = target_lang.clone();
        let permit = sem.clone().acquire_owned().await.map_err(|e| e.to_string())?;

        let handle = tokio::spawn(async move {
            let _permit = permit;
            let data = match fetch_appdetails(&client, dlc_id, &lang, 1).await {
                Ok(Some(data)) => data,
                Ok(None) => return (fallback_dlc_item(dlc_id), false),
                Err(e) => {
                    eprintln!("[steam dlc] appdetails for {dlc_id} ({lang}) failed: {e}");
                    return (fallback_dlc_item(dlc_id), true);
                }
            };

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

            (
                SteamDlcItem {
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
                },
                false,
            )
        });

        handles.push(handle);
    }

    let mut dlcs = Vec::with_capacity(handles.len());
    let mut owned_count = 0;
    let mut installed_count = 0;
    let mut fetch_failed = false;

    for h in handles {
        if let Ok((mut item, failed)) = h.await {
            fetch_failed |= failed;
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

    // Only cache a complete catalog. If any appdetails call failed we leave the
    // cache untouched so the next open retries instead of pinning placeholders
    // for the full TTL.
    if !fetch_failed {
        let blob = CachedDlcBlob {
            timestamp: unix_now(),
            dlcs: dlcs.clone(),
            total_available,
        };
        if let Ok(serialized) = serde_json::to_string(&blob) {
            let _ = db::kv::set(&db, &cache_key, &serialized);
        }
    }

    Ok(SteamGameDlcsResult {
        app_id,
        total_dlcs: dlcs.len() as u32,
        total_available,
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

/// Tauri command: set ownership for many DLCs in one round trip.
#[tauri::command]
pub fn steam_mark_dlcs_owned(
    app: AppHandle,
    _app_id: u32,
    dlc_app_ids: Vec<u32>,
    owned: bool,
) -> Result<u32, String> {
    let db = app.state::<db::Db>().inner().clone();
    let value = if owned { "1" } else { "0" };
    let mut written = 0u32;

    for dlc_app_id in dlc_app_ids.into_iter().take(1000) {
        let manual_key = format!("steam_dlc_owned_{dlc_app_id}");
        if db::kv::set(&db, &manual_key, value).is_ok() {
            written += 1;
        }
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appdetails_data_returns_payload_on_success() {
        let body = json!({
            "292030": {
                "success": true,
                "data": { "name": "The Witcher 3", "type": "game" }
            }
        });

        let data = appdetails_data(&body, 292030).expect("data payload");
        assert_eq!(data.get("name").and_then(|v| v.as_str()), Some("The Witcher 3"));
    }

    #[test]
    fn appdetails_data_is_none_without_a_data_object() {
        // Explicit failure from the store.
        let failed = json!({ "292030": { "success": false } });
        assert!(appdetails_data(&failed, 292030).is_none());

        // Non-object payloads are not a usable catalog entry.
        let array = json!({ "292030": { "success": true, "data": [] } });
        assert!(appdetails_data(&array, 292030).is_none());

        // The response is keyed under a different app id.
        let other = json!({ "1": { "success": true, "data": { "name": "x" } } });
        assert!(appdetails_data(&other, 292030).is_none());
    }

    #[test]
    fn order_dlc_appids_dedupes_preserving_first_seen_order() {
        let known = HashSet::new();
        let (ordered, total) = order_dlc_appids(vec![3, 1, 3, 2, 1], &known, 100);
        assert_eq!(ordered, vec![3, 1, 2]);
        assert_eq!(total, 3);
    }

    #[test]
    fn order_dlc_appids_moves_known_ids_to_the_front() {
        let known: HashSet<u32> = [4, 9].into_iter().collect();
        let (ordered, total) = order_dlc_appids(vec![1, 4, 2, 9, 3], &known, 100);
        assert_eq!(ordered, vec![4, 9, 1, 2, 3]);
        assert_eq!(total, 5);
    }

    #[test]
    fn order_dlc_appids_caps_after_known_and_reports_total() {
        let known: HashSet<u32> = [5].into_iter().collect();
        let (ordered, total) = order_dlc_appids(vec![1, 2, 3, 4, 5], &known, 2);
        assert_eq!(ordered, vec![5, 1]);
        assert_eq!(total, 5);
    }

    #[test]
    fn cached_dlc_blob_defaults_missing_total_available() {
        let json = json!({ "timestamp": 123, "dlcs": [] }).to_string();
        let blob: CachedDlcBlob = serde_json::from_str(&json).expect("old blob");
        assert_eq!(blob.timestamp, 123);
        assert_eq!(blob.total_available, 0);
    }
}
