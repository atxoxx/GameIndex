//! Nexus Mods API client (v1 REST).
//!
//! The user's personal API key (from
//! <https://www.nexusmods.com/users/myaccount?tab=api>) is stored in
//! the OS keychain under the `nexus_api_key` account — never on disk.
//! All calls send it via the `apikey` header per the API docs.
//!
//! Endpoints used:
//! - `GET /v1/users/validate.json` — key check + account info.
//! - `GET /v1/games/{domain}/mods/md5_search/{md5}.json` — identify a
//!   local file (the same trick Vortex uses to link manually-installed
//!   mods to their Nexus page).
//! - `GET /v1/games/{domain}/mods/{id}.json` — latest version for
//!   update checks.

use serde::Serialize;
use serde_json::Value;

use crate::db::secrets::SecretStore;

pub const NEXUS_KEY_ACCOUNT: &str = "nexus_api_key";
const API: &str = "https://api.nexusmods.com/v1";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("GameIndex/0.1 (+https://github.com)")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn get_api_key() -> Result<Option<String>, String> {
    SecretStore::new().get(NEXUS_KEY_ACCOUNT)
}

/// Connection status surfaced to the frontend settings popover.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusStatus {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_premium: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl NexusStatus {
    pub fn disconnected() -> Self {
        Self {
            connected: false,
            user_name: None,
            is_premium: None,
            error: None,
        }
    }
}

/// `GET /users/validate.json` — returns account info when the key is
/// valid, a status object with `error` set otherwise.
pub async fn validate(key: &str) -> NexusStatus {
    let resp = client()
        .get(format!("{API}/users/validate.json"))
        .header("apikey", key)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => NexusStatus {
                connected: true,
                user_name: v.get("name").and_then(|n| n.as_str()).map(String::from),
                is_premium: v.get("is_premium").and_then(|p| p.as_bool()),
                error: None,
            },
            Err(e) => NexusStatus {
                connected: false,
                user_name: None,
                is_premium: None,
                error: Some(format!("decode: {e}")),
            },
        },
        Ok(r) => NexusStatus {
            connected: false,
            user_name: None,
            is_premium: None,
            error: Some(format!("HTTP {}", r.status())),
        },
        Err(e) => NexusStatus {
            connected: false,
            user_name: None,
            is_premium: None,
            error: Some(e.to_string()),
        },
    }
}

/// A successful MD5 identification.
pub struct Md5Match {
    pub mod_id: i64,
    pub mod_name: Option<String>,
    pub author: Option<String>,
    pub file_version: Option<String>,
}

/// `GET /games/{domain}/mods/md5_search/{md5}.json`
pub async fn md5_search(key: &str, domain: &str, md5: &str) -> Result<Option<Md5Match>, String> {
    let resp = client()
        .get(format!("{API}/games/{domain}/mods/md5_search/{md5}.json"))
        .header("apikey", key)
        .send()
        .await
        .map_err(|e| format!("nexus md5_search: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("nexus md5_search: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus md5_search decode: {e}"))?;
    let Some(first) = v.as_array().and_then(|a| a.first()) else {
        return Ok(None);
    };
    let m = first.get("mod").cloned().unwrap_or(Value::Null);
    let Some(mod_id) = m.get("mod_id").and_then(|i| i.as_i64()) else {
        return Ok(None);
    };
    Ok(Some(Md5Match {
        mod_id,
        mod_name: m.get("name").and_then(|n| n.as_str()).map(String::from),
        author: m.get("author").and_then(|a| a.as_str()).map(String::from),
        file_version: first
            .get("file_details")
            .and_then(|f| f.get("version"))
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
    }))
}

/// `GET /games/{domain}/mods/{id}.json` → latest published version.
pub async fn mod_latest_version(
    key: &str,
    domain: &str,
    mod_id: i64,
) -> Result<Option<String>, String> {
    let resp = client()
        .get(format!("{API}/games/{domain}/mods/{mod_id}.json"))
        .header("apikey", key)
        .send()
        .await
        .map_err(|e| format!("nexus mod info: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("nexus mod info: HTTP {}", resp.status()));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("nexus mod info decode: {e}"))?;
    Ok(v.get("version")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from))
}

/// Streaming MD5 of a local file (used for `md5_search`). Skips files
/// larger than 256 MiB — hashing multi-GB paks isn't worth the IO.
pub fn file_md5(path: &std::path::Path) -> Result<Option<String>, String> {
    use md5::{Digest, Md5};
    use std::io::Read;
    const MAX: u64 = 256 * 1024 * 1024;
    let md = std::fs::metadata(path).map_err(|e| format!("md5 stat: {e}"))?;
    if !md.is_file() || md.len() > MAX {
        return Ok(None);
    }
    let mut file = std::fs::File::open(path).map_err(|e| format!("md5 open: {e}"))?;
    let mut hasher = Md5::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("md5 read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(Some(format!("{:x}", hasher.finalize())))
}
