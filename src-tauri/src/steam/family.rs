//! Steam Family Sharing and Steam Families detection.
//!
//! Steam Families (2024+) stores family group data locally in:
//! `<steam_root>\userdata\<account_id>\config\localconfig.vdf` under `"FamilyGroup"`.
//!
//! Each member has an `accountid` which maps to SteamID64:
//! `steam_id_64 = 76561197960265728 + accountid`.
//!
//! When games are installed on disk, `steamapps\appmanifest_<appid>.acf` contains
//! `"LastOwner"`. If `LastOwner` is different from the logged-in user's Steam ID,
//! the game is accessed via Family Sharing.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::db::secrets::SecretStore;
use crate::steam_game_watcher;
use super::auth::USER_AGENT;
use super::sync::scan_steam_manifests;
use super::types::{SteamFamilyGroup, SteamFamilyMember, SteamFamilyShareInfo, SteamSession};

const STEAMID64_BASE: u64 = 76_561_197_960_265_728;

pub fn account_id_to_steam_id64(account_id: u32) -> u64 {
    STEAMID64_BASE + account_id as u64
}

pub fn steam_id64_to_account_id(steam_id64: u64) -> Option<u32> {
    if steam_id64 >= STEAMID64_BASE {
        Some((steam_id64 - STEAMID64_BASE) as u32)
    } else {
        None
    }
}

/// Find the Steam userdata directory (`<steam_root>\userdata`).
pub fn find_steam_userdata_dir() -> Option<PathBuf> {
    let root = steam_game_watcher::find_steam_install_dir()?;
    let userdata = root.join("userdata");
    if userdata.is_dir() {
        Some(userdata)
    } else {
        None
    }
}

/// Locate the `localconfig.vdf` for the specified SteamID or best matching local account.
pub fn find_localconfig_path(target_steam_id: Option<&str>) -> Option<PathBuf> {
    let userdata = find_steam_userdata_dir()?;

    // 1. Try target Steam ID if supplied
    if let Some(sid_str) = target_steam_id {
        if let Ok(sid) = sid_str.trim().parse::<u64>() {
            if let Some(aid) = steam_id64_to_account_id(sid) {
                let candidate = userdata.join(aid.to_string()).join("config").join("localconfig.vdf");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // 2. Otherwise scan subdirectories in userdata
    let entries = fs::read_dir(&userdata).ok()?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str != "anonymous" && name_str.chars().all(|c| c.is_ascii_digit()) {
            let config_vdf = entry.path().join("config").join("localconfig.vdf");
            if config_vdf.is_file() {
                candidates.push(config_vdf);
            }
        }
    }

    // Return the most recently modified localconfig.vdf
    candidates.sort_by_key(|p| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    candidates.pop()
}

/// Lightweight parser extracting the `FamilyGroup` block from `localconfig.vdf`.
pub fn parse_family_group_block(content: &str) -> Option<(String, String, u32, Vec<(u32, u32)>)> {
    let marker = "\"FamilyGroup\"";
    let start_pos = content.find(marker)?;
    let open_brace = content[start_pos..].find('{')? + start_pos;

    // Count balanced braces to slice the entire FamilyGroup block
    let mut depth = 0;
    let mut end_pos = open_brace;
    for (i, c) in content[open_brace..].char_indices() {
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                end_pos = open_brace + i;
                break;
            }
        }
    }

    if depth != 0 {
        return None;
    }

    let block = &content[open_brace..=end_pos];

    // Extract groupid
    let group_id = extract_vdf_string(block, "groupid").unwrap_or_default();
    let name = extract_vdf_string(block, "name").unwrap_or_default();
    let role = extract_vdf_string(block, "role")
        .and_then(|r| r.parse::<u32>().ok())
        .unwrap_or(1);

    // Extract all member accountids and roles inside the block
    let mut members = Vec::new();
    let parts: Vec<&str> = block.split('"').collect();
    let mut i = 1;
    let mut current_account: Option<u32> = None;
    let mut current_role = 1u32;

    while i + 2 < parts.len() {
        let key = parts[i];
        let val = parts[i + 2];
        if key == "accountid" {
            if let Ok(aid) = val.trim().parse::<u32>() {
                if let Some(prev) = current_account {
                    members.push((prev, current_role));
                }
                current_account = Some(aid);
                current_role = 1;
            }
        } else if key == "role" && current_account.is_some() {
            if let Ok(r) = val.trim().parse::<u32>() {
                current_role = r;
            }
        }
        i += 2;
    }

    if let Some(last) = current_account {
        members.push((last, current_role));
    }

    Some((group_id, name, role, members))
}

fn extract_vdf_string(block: &str, key: &str) -> Option<String> {
    let parts: Vec<&str> = block.split('"').collect();
    let mut i = 1;
    while i + 2 < parts.len() {
        if parts[i] == key {
            return Some(parts[i + 2].to_string());
        }
        i += 2;
    }
    None
}

/// Retrieve the active SteamSession from OS keychain if available.
pub fn get_saved_steam_session() -> Option<SteamSession> {
    let store = SecretStore::new();
    let raw = store.get("steam_session").ok()??;
    serde_json::from_str::<SteamSession>(&raw).ok()
}

/// Fetch player summaries for multiple SteamID64s from Steam Web API.
async fn fetch_player_summaries(
    api_key: &str,
    steam_ids: &[String],
) -> HashMap<String, (String, Option<String>, Option<String>)> {
    let mut out = HashMap::new();
    if steam_ids.is_empty() {
        return out;
    }

    let client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return out,
    };

    let joined_ids = steam_ids.join(",");
    let url = format!(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={}",
        api_key, joined_ids
    );

    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(players) = json.get("response").and_then(|r| r.get("players")).and_then(|p| p.as_array()) {
                for player in players {
                    if let Some(sid) = player.get("steamid").and_then(|v| v.as_str()) {
                        let persona = player.get("personaname").and_then(|v| v.as_str()).unwrap_or("Steam User").to_string();
                        let avatar = player.get("avatarfull")
                            .or_else(|| player.get("avatarmedium"))
                            .or_else(|| player.get("avatar"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        let profile_url = player.get("profileurl").and_then(|v| v.as_str()).map(str::to_string);
                        out.insert(sid.to_string(), (persona, avatar, profile_url));
                    }
                }
            }
        }
    }

    out
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FriendCacheEntry {
    steamid: String,
    persona_name: Option<String>,
    avatar_hash: Option<String>,
}

/// Parse friendstore_playercache from localconfig.vdf
pub fn parse_friendstore_playercache(content: &str) -> HashMap<String, (String, Option<String>)> {
    let mut map = HashMap::new();
    let marker = "\"friendstore_playercache\"";
    let pos = match content.find(marker) {
        Some(p) => p + marker.len(),
        None => return map,
    };
    let rest = &content[pos..];
    let start_idx = match rest.find('[') {
        Some(i) => i,
        None => return map,
    };
    let end_idx = match rest[start_idx..].find(']') {
        Some(i) => start_idx + i,
        None => return map,
    };

    let slice = &rest[start_idx..=end_idx];
    let unescaped = slice.replace("\\\"", "\"");
    if let Ok(entries) = serde_json::from_str::<Vec<FriendCacheEntry>>(&unescaped) {
        for entry in entries {
            if let Some(name) = entry.persona_name {
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    let avatar = entry.avatar_hash.as_ref().and_then(|h| {
                        let h = h.trim();
                        if h.is_empty() {
                            None
                        } else if h.starts_with("http") {
                            Some(h.to_string())
                        } else {
                            Some(format!("https://avatars.steamstatic.com/{h}_full.jpg"))
                        }
                    });
                    map.insert(entry.steamid, (trimmed.to_string(), avatar));
                }
            }
        }
    }
    map
}

/// Parse Steam loginusers.vdf to get offline personas and find active user
pub fn parse_local_loginusers() -> (HashMap<String, (String, Option<String>)>, Option<String>) {
    let mut map = HashMap::new();
    let mut active_sid: Option<String> = None;
    let mut max_timestamp: u64 = 0;

    let root = match steam_game_watcher::find_steam_install_dir() {
        Some(r) => r,
        None => return (map, active_sid),
    };

    let loginusers_path = root.join("config").join("loginusers.vdf");
    let content = match fs::read_to_string(&loginusers_path) {
        Ok(c) => c,
        Err(_) => return (map, active_sid),
    };

    let parts: Vec<&str> = content.split('"').collect();
    let mut i = 1;
    let mut current_sid: Option<String> = None;
    let mut current_persona: Option<String> = None;
    let mut current_autologin = false;
    let mut current_timestamp: u64 = 0;

    while i + 2 < parts.len() {
        let key = parts[i].trim();
        let val = parts[i + 2].trim();

        if key.len() == 17 && key.starts_with("7656119") && key.chars().all(|c| c.is_ascii_digit()) {
            if let Some(sid) = current_sid.take() {
                if let Some(p) = current_persona.take() {
                    map.insert(sid.clone(), (p, None));
                }
                if current_autologin || current_timestamp > max_timestamp {
                    max_timestamp = current_timestamp;
                    active_sid = Some(sid);
                }
            }
            current_sid = Some(key.to_string());
            current_persona = None;
            current_autologin = false;
            current_timestamp = 0;
        } else if current_sid.is_some() {
            if key.eq_ignore_ascii_case("PersonaName") {
                current_persona = Some(val.to_string());
            } else if key.eq_ignore_ascii_case("AutoLogin") {
                current_autologin = val == "1";
            } else if key.eq_ignore_ascii_case("Timestamp") {
                current_timestamp = val.parse::<u64>().unwrap_or(0);
            }
        }
        i += 2;
    }

    if let Some(sid) = current_sid {
        if let Some(p) = current_persona {
            map.insert(sid.clone(), (p, None));
        }
        if current_autologin || current_timestamp > max_timestamp || active_sid.is_none() {
            active_sid = Some(sid);
        }
    }

    (map, active_sid)
}

/// Parse FriendsOwnedGames_storage_<accountid> entries from localconfig.vdf
pub fn parse_friends_owned_games(content: &str) -> HashMap<u32, Vec<u32>> {
    let mut map = HashMap::new();
    let marker = "\"FriendsOwnedGames_storage_";
    let mut search_from = 0;

    while let Some(rel_pos) = content[search_from..].find(marker) {
        let key_start = search_from + rel_pos + marker.len();
        if let Some(quote_end) = content[key_start..].find('"') {
            let account_id_str = &content[key_start..key_start + quote_end];
            if let Ok(account_id) = account_id_str.parse::<u32>() {
                let val_search = &content[key_start + quote_end..];
                if let Some(mut set_apps_idx) = val_search.find("setApps\":[") {
                    set_apps_idx += "setApps\":[".len();
                    if let Some(close_bracket) = val_search[set_apps_idx..].find(']') {
                        let array_slice = &val_search[set_apps_idx..set_apps_idx + close_bracket];
                        let apps: Vec<u32> = array_slice
                            .split(',')
                            .filter_map(|s| s.trim().parse::<u32>().ok())
                            .collect();
                        if !apps.is_empty() {
                            map.insert(account_id, apps);
                        }
                    }
                }
            }
            search_from = key_start + quote_end;
        } else {
            break;
        }
    }

    map
}

/// Extract all owned AppIDs from apptickets block in localconfig.vdf
pub fn parse_owned_apptickets(content: &str) -> std::collections::HashSet<u32> {
    let mut set = std::collections::HashSet::new();
    let marker = "\"apptickets\"";
    let pos = match content.find(marker) {
        Some(p) => p + marker.len(),
        None => return set,
    };
    let rest = &content[pos..];
    let open_brace = match rest.find('{') {
        Some(i) => i,
        None => return set,
    };
    let close_brace = match rest[open_brace..].find('}') {
        Some(i) => open_brace + i,
        None => return set,
    };

    let block = &rest[open_brace..=close_brace];
    let parts: Vec<&str> = block.split('"').collect();
    let mut i = 1;
    while i + 2 < parts.len() {
        let key = parts[i].trim();
        if let Ok(appid) = key.parse::<u32>() {
            set.insert(appid);
        }
        i += 2;
    }

    set
}

/// Tauri command: retrieve detected Steam Family group and members.
#[tauri::command]
pub async fn steam_get_family_group(
    _app: AppHandle,
) -> Result<Option<SteamFamilyGroup>, String> {
    let session = get_saved_steam_session();
    let (login_users, detected_active_sid) = parse_local_loginusers();
    let current_steam_id = session.as_ref().map(|s| s.steam_id.clone()).or(detected_active_sid);

    let config_path = match find_localconfig_path(current_steam_id.as_deref()) {
        Some(p) => p,
        None => return Ok(None),
    };

    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let (group_id, name, role, raw_members) = match parse_family_group_block(&content) {
        Some(parsed) => parsed,
        None => return Ok(None),
    };

    let member_steam_ids: Vec<String> = raw_members
        .iter()
        .map(|(aid, _)| account_id_to_steam_id64(*aid).to_string())
        .collect();

    // 1. Check local playercache from localconfig.vdf
    let local_cache = parse_friendstore_playercache(&content);

    // 2. Fetch summaries if we have an API key
    let summaries = if let Some(ref s) = session {
        fetch_player_summaries(&s.api_key, &member_steam_ids).await
    } else {
        HashMap::new()
    };

    let mut members = Vec::new();
    for (account_id, m_role) in raw_members {
        let sid_str = account_id_to_steam_id64(account_id).to_string();
        let is_curr = current_steam_id.as_deref() == Some(&sid_str);

        let (p_name, avatar, prof_url) = if let Some((n, a, p)) = summaries.get(&sid_str) {
            (Some(n.clone()), a.clone(), p.clone())
        } else if let Some((n, a)) = local_cache.get(&sid_str) {
            (Some(n.clone()), a.clone(), None)
        } else if let Some((n, a)) = login_users.get(&sid_str) {
            (Some(n.clone()), a.clone(), None)
        } else if is_curr && session.as_ref().and_then(|s| s.display_name.clone()).is_some() {
            (session.as_ref().and_then(|s| s.display_name.clone()), None, None)
        } else {
            (Some(format!("Member #{account_id}")), None, None)
        };

        members.push(SteamFamilyMember {
            steam_id: sid_str,
            account_id,
            role: m_role,
            persona_name: p_name,
            avatar_url: avatar,
            profile_url: prof_url,
            is_current_user: is_curr,
        });
    }

    Ok(Some(SteamFamilyGroup {
        group_id,
        name,
        role,
        members,
    }))
}

/// Tauri command: retrieve family sharing information for a specific game AppID.
#[tauri::command]
pub async fn steam_get_family_share_info(
    app: AppHandle,
    app_id: u32,
) -> Result<SteamFamilyShareInfo, String> {
    let session = get_saved_steam_session();
    let (login_users, detected_active_sid) = parse_local_loginusers();
    let current_steam_id = session.as_ref().map(|s| s.steam_id.clone()).or(detected_active_sid);

    let config_path = find_localconfig_path(current_steam_id.as_deref());
    let local_content = config_path.as_ref().and_then(|p| fs::read_to_string(p).ok());

    let owned_tickets = local_content.as_deref().map(parse_owned_apptickets).unwrap_or_default();
    let friends_owned_games = local_content.as_deref().map(parse_friends_owned_games).unwrap_or_default();
    let local_player_cache = local_content.as_deref().map(parse_friendstore_playercache).unwrap_or_default();

    let manifest_states = scan_steam_manifests();
    let manifest_state = manifest_states.get(&app_id);

    let last_owner = manifest_state
        .and_then(|s| s.last_owner.as_deref())
        .filter(|o| !o.is_empty() && *o != "0");

    let is_last_owner_current = match (current_steam_id.as_deref(), last_owner) {
        (Some(cur), Some(owner)) => cur == owner,
        _ => false,
    };

    // If local user has an app ticket for this base game, it's not a shared copy
    if owned_tickets.contains(&app_id) {
        return Ok(SteamFamilyShareInfo {
            is_shared: false,
            owner_steam_id: current_steam_id,
            ..Default::default()
        });
    }

    // Try to get group info to find the member name/avatar
    let family_group = steam_get_family_group(app).await.ok().flatten();
    let group_name = family_group.as_ref().map(|g| g.name.clone());

    // 1. If last_owner in manifest is someone other than the current user:
    if let Some(owner_sid) = last_owner {
        if !is_last_owner_current {
            // Check in family group members
            if let Some(ref fg) = family_group {
                if let Some(member) = fg.members.iter().find(|m| m.steam_id == owner_sid) {
                    return Ok(SteamFamilyShareInfo {
                        is_shared: true,
                        owner_steam_id: Some(owner_sid.to_string()),
                        owner_name: member.persona_name.clone(),
                        owner_avatar_url: member.avatar_url.clone(),
                        family_group_name: group_name,
                    });
                }
            }

            // Fallback to local_player_cache or login_users
            let (name, avatar) = if let Some((n, a)) = local_player_cache.get(owner_sid) {
                (Some(n.clone()), a.clone())
            } else if let Some((n, a)) = login_users.get(owner_sid) {
                (Some(n.clone()), a.clone())
            } else {
                (Some("Family Member".to_string()), None)
            };

            return Ok(SteamFamilyShareInfo {
                is_shared: true,
                owner_steam_id: Some(owner_sid.to_string()),
                owner_name: name,
                owner_avatar_url: avatar,
                family_group_name: group_name,
            });
        }
    }

    // 2. If last_owner was "0", missing, or matched local user but local user has no ticket:
    // Check which family member owns this app_id in friends_owned_games!
    if let Some(ref fg) = family_group {
        for member in &fg.members {
            if member.is_current_user {
                continue;
            }
            if let Some(apps) = friends_owned_games.get(&member.account_id) {
                if apps.contains(&app_id) {
                    return Ok(SteamFamilyShareInfo {
                        is_shared: true,
                        owner_steam_id: Some(member.steam_id.clone()),
                        owner_name: member.persona_name.clone(),
                        owner_avatar_url: member.avatar_url.clone(),
                        family_group_name: group_name,
                    });
                }
            }
        }
    }

    // Also check any account in friends_owned_games even if not in group
    for (account_id, apps) in &friends_owned_games {
        if apps.contains(&app_id) {
            let sid_str = account_id_to_steam_id64(*account_id).to_string();
            let (name, avatar) = if let Some((n, a)) = local_player_cache.get(&sid_str) {
                (Some(n.clone()), a.clone())
            } else {
                (Some(format!("Member #{account_id}")), None)
            };
            return Ok(SteamFamilyShareInfo {
                is_shared: true,
                owner_steam_id: Some(sid_str),
                owner_name: name,
                owner_avatar_url: avatar,
                family_group_name: group_name,
            });
        }
    }

    Ok(SteamFamilyShareInfo {
        is_shared: false,
        owner_steam_id: current_steam_id,
        ..Default::default()
    })
}
