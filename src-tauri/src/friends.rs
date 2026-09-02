//! Friends sync (local shared-file P2P) + internet sync loop.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::SystemTime;
use tauri::{Emitter, Manager};
use crate::db;

const FRIENDS_SYNC_FILE_NAME: &str = "gamelib-friends.json";

fn sanitize_segment(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

fn ensure_device_id(app: &tauri::AppHandle) -> Result<String, String> {
    let db = app.state::<db::Db>();
    if let Ok(Some(id)) = db::kv::get(&db, "friends_device_id") {
        return Ok(id);
    }
    let random_id = format!("device_{}_{:04x}", 
        SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        rand::random::<u16>()
    );
    if let Err(e) = db::kv::set(&db, "friends_device_id", &random_id) {
        return Err(e);
    }
    Ok(random_id)
}

#[tauri::command]
pub fn get_friends_device_id(app: tauri::AppHandle) -> Result<String, String> {
    ensure_device_id(&app)
}

/// Reads the Nostr signing key from the SQLite kv_store (the repo's
/// standard secret location — the OS keychain's Windows backend silently
/// fails). Returns `None` when no key has been generated yet.
#[tauri::command]
pub fn get_friends_nostr_privkey(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<db::Db>();
    db::kv::get(&db, "friends_nostr_privkey")
}

/// Persists the Nostr signing key to the SQLite kv_store, verifying the
/// write with a readback so a silent persistence failure is never mistaken
/// for success (mirrors the epic/gog token pattern).
#[tauri::command]
pub fn set_friends_nostr_privkey(app: tauri::AppHandle, hex: String) -> Result<(), String> {
    let db = app.state::<db::Db>();
    db::kv::set(&db, "friends_nostr_privkey", &hex)?;
    let stored = db::kv::get(&db, "friends_nostr_privkey")?;
    if stored.as_deref() != Some(hex.as_str()) {
        return Err("friends nostr key write failed verification".to_string());
    }
    Ok(())
}

/// The sync root is always `<app_data_dir>/sync`, right beside the DB.
fn friends_sync_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join("sync"))
}

#[tauri::command]
pub fn get_friends_sync_dir(app: tauri::AppHandle) -> Result<String, String> {
    friends_sync_root(&app).map(|p| p.to_string_lossy().to_string())
}

/// List peer device ids discovered in the shared sync directory
/// (every subfolder that contains our outbox file, excluding our own).
#[tauri::command]
pub fn list_friend_outboxes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = friends_sync_root(&app)?;
    let my_id = ensure_device_id(&app).ok();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let candidate = p.join(FRIENDS_SYNC_FILE_NAME);
            if !candidate.exists() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if Some(&name) == my_id.as_ref() {
                continue;
            }
            out.push(name);
        }
    }
    Ok(out)
}

/// Publish our outbox into `<syncRoot>/<deviceId>/gamelib-friends.json`.
/// Creates the subfolder if needed. Writes atomically (tmp + rename).
#[tauri::command]
pub fn write_sync_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let root = friends_sync_root(&app)?;
    let device_id = ensure_device_id(&app)?;
    let folder = root.join(sanitize_segment(&device_id));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file_path = folder.join(FRIENDS_SYNC_FILE_NAME);
    let tmp_path = folder.join(format!("{}.tmp", FRIENDS_SYNC_FILE_NAME));
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())
}

/// Read a peer's outbox from `<syncRoot>/<peerId>/gamelib-friends.json`.
#[tauri::command]
pub fn read_sync_file(app: tauri::AppHandle, peer_id: String) -> Result<Option<String>, String> {
    let root = friends_sync_root(&app)?;
    let folder = root.join(sanitize_segment(&peer_id));
    let file_path = folder.join(FRIENDS_SYNC_FILE_NAME);
    if !file_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}

// ── P2P Friends Sync Commands ────────────────────────────────────────

fn load_friends_db_internal(app: &tauri::AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    let db_path = db_dir.join("database.json");
    if !db_path.exists() {
        return Ok("{\"profile\":null,\"friends\":[],\"sessions\":[],\"recommendations\":[]}".to_string());
    }
    std::fs::read_to_string(db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_friends_db(app: tauri::AppHandle) -> Result<String, String> {
    load_friends_db_internal(&app)
}

#[tauri::command]
pub fn save_friends_db(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    let file_path = db_dir.join("database.json");
    let tmp_path = db_dir.join("database.json.tmp");
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())
}

async fn write_framed_string<S: tokio::io::AsyncWrite + Unpin>(stream: &mut S, data: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    let bytes = data.as_bytes();
    let len = bytes.len() as u32;
    stream.write_all(&len.to_be_bytes()).await?;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

async fn read_framed_string<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> std::io::Result<String> {
    use tokio::io::AsyncReadExt;
    let mut len_bytes = [0u8; 4];
    stream.read_exact(&mut len_bytes).await?;
    let len = u32::from_be_bytes(len_bytes) as usize;
    if len > 50 * 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Incoming P2P sync payload exceeds 50MB limit",
        ));
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    let s = String::from_utf8(buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(s)
}

// ── Internet Sync (Automatic P2P sync via KV discovery) ──────────────

pub struct InternetSyncState {
    pub bound_port: std::sync::Mutex<Option<u16>>,
    pub external_ip: std::sync::Mutex<Option<String>>,
    pub upnp_mapped: std::sync::Mutex<bool>,
    pub last_synced_times: std::sync::Mutex<HashMap<String, u64>>,
    pub error_message: std::sync::Mutex<Option<String>>,
}

static INTERNET_SYNC_STATE: OnceLock<Arc<InternetSyncState>> = OnceLock::new();

pub(crate) fn init_internet_sync() -> Arc<InternetSyncState> {
    let state = Arc::new(InternetSyncState {
        bound_port: std::sync::Mutex::new(None),
        external_ip: std::sync::Mutex::new(None),
        upnp_mapped: std::sync::Mutex::new(false),
        last_synced_times: std::sync::Mutex::new(HashMap::new()),
        error_message: std::sync::Mutex::new(None),
    });
    let _ = INTERNET_SYNC_STATE.set(state.clone());
    state
}

async fn fetch_external_ip() -> Option<String> {
    use std::str::FromStr;
    let urls = vec![
        "https://api.ipify.org",
        "https://icanhazip.com",
        "https://ident.me",
    ];
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    for url in urls {
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(text) = resp.text().await {
                let cleaned = text.trim().to_string();
                if std::net::IpAddr::from_str(&cleaned).is_ok() {
                    return Some(cleaned);
                }
            }
        }
    }
    None
}

async fn map_port_upnp(local_ip: std::net::IpAddr, port: u16) -> bool {
    let local_addr = std::net::SocketAddr::new(local_ip, port);
    
    let res = tokio::task::spawn_blocking(move || {
        let opts = igd_next::SearchOptions {
            bind_addr: std::net::SocketAddr::new(local_ip, 0),
            timeout: Some(std::time::Duration::from_secs(5)),
            ..Default::default()
        };
        match igd_next::search_gateway(opts) {
            Ok(gateway) => {
                match gateway.add_port(
                    igd_next::PortMappingProtocol::TCP,
                    port,
                    local_addr,
                    0,
                    "GameLib Internet Sync",
                ) {
                    Ok(_) => {
                        println!("[gameindex] UPnP: successfully mapped port {} to {}", port, local_addr);
                        true
                    }
                    Err(e) => {
                        eprintln!("[gameindex] UPnP: failed to map port: {}", e);
                        false
                    }
                }
            }
            Err(e) => {
                eprintln!("[gameindex] UPnP: gateway search failed: {}", e);
                false
            }
        }
    }).await;
    
    res.unwrap_or(false)
}

fn get_local_ip_internal() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local_addr = socket.local_addr().ok()?;
    Some(local_addr.ip())
}

const KV_APP_KEY: &str = "gamelib_v1_p2p_sync";

async fn publish_address_to_kv(sync_id: &str, address: &str) -> Result<(), String> {
    let sanitized_address = address.replace('.', "_").replace(':', "-");
    let url = format!(
        "https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/{}/{}/{}",
        KV_APP_KEY,
        urlencoding::encode(sync_id),
        urlencoding::encode(&sanitized_address)
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.post(&url)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP status {}", resp.status()))
    }
}

async fn fetch_address_from_kv(sync_id: &str) -> Option<String> {
    let url = format!(
        "https://keyvalue.immanuel.co/api/KeyVal/GetValue/{}/{}",
        KV_APP_KEY,
        urlencoding::encode(sync_id)
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let resp = client.get(&url).send().await.ok()?;
    if resp.status().is_success() {
        if let Ok(text) = resp.text().await {
            let val = text.trim();
            if val.is_empty() || val == "null" || val == "\"null\"" {
                return None;
            }
            let cleaned = val.strip_prefix('"').unwrap_or(val).strip_suffix('"').unwrap_or(val);
            if cleaned.contains('_') || cleaned.contains('-') {
                return Some(cleaned.replace('_', ".").replace('-', ":"));
            }
            if cleaned.contains(':') {
                return Some(cleaned.to_string());
            }
        }
    }
    None
}

#[derive(serde::Deserialize)]
struct ProfilePayloadShort {
    #[serde(rename = "syncId")]
    sync_id: String,
}

#[derive(serde::Deserialize)]
struct FriendPayloadShort {
    #[serde(rename = "syncId")]
    sync_id: String,
}

#[derive(serde::Deserialize)]
struct DbPayloadShort {
    profile: Option<ProfilePayloadShort>,
    friends: Option<Vec<FriendPayloadShort>>,
}

fn load_friends_db_payload(app: &tauri::AppHandle) -> Option<DbPayloadShort> {
    if let Ok(raw) = load_friends_db_internal(app) {
        if let Ok(payload) = serde_json::from_str::<DbPayloadShort>(&raw) {
            return Some(payload);
        }
    }
    None
}

async fn run_tcp_host(app: tauri::AppHandle, state: Arc<InternetSyncState>, listener: tokio::net::TcpListener) {
    loop {
        match listener.accept().await {
            Ok((mut socket, peer_addr)) => {
                println!("[gameindex] Accepted internet sync connection from {}", peer_addr);
                let app_clone = app.clone();
                let state_clone = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_inbound_connection(&app_clone, &state_clone, &mut socket).await {
                        eprintln!("[gameindex] Error handling inbound connection: {}", e);
                    }
                });
            }
            Err(e) => {
                eprintln!("[gameindex] TCP listener accept error: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}

async fn handle_inbound_connection(
    app: &tauri::AppHandle,
    state: &Arc<InternetSyncState>,
    socket: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let client_db = read_framed_string(socket).await
        .map_err(|e| format!("Failed to read client data: {}", e))?;

    let client_sync_id = if let Ok(payload) = serde_json::from_str::<DbPayloadShort>(&client_db) {
        payload.profile.map(|p| p.sync_id)
    } else {
        None
    };

    let host_db = load_friends_db_internal(app)?;
    write_framed_string(socket, &host_db).await
        .map_err(|e| format!("Failed to send host data: {}", e))?;

    if let Some(ref sync_id) = client_sync_id {
        let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        state.last_synced_times.lock().unwrap().insert(sync_id.clone(), now);
    }
    
    app.emit("internet-sync-received", client_db).map_err(|e| e.to_string())?;

    Ok(())
}

async fn sync_with_friend(
    app: &tauri::AppHandle,
    state: &Arc<InternetSyncState>,
    friend_sync_id: &str,
    friend_addr: &str,
) -> Result<(), String> {
    use tokio::time::timeout;
    use std::time::Duration;

    println!("[gameindex] Connecting to friend {} at {}", friend_sync_id, friend_addr);
    let mut socket = match timeout(Duration::from_secs(8), tokio::net::TcpStream::connect(friend_addr)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => return Err(format!("TCP connect error: {}", e)),
        Err(_) => return Err("Connection timed out".to_string()),
    };

    let our_db = load_friends_db_internal(app)?;
    write_framed_string(&mut socket, &our_db).await
        .map_err(|e| format!("Failed to send our database: {}", e))?;

    let remote_db = read_framed_string(&mut socket).await
        .map_err(|e| format!("Failed to read remote database: {}", e))?;

    let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    state.last_synced_times.lock().unwrap().insert(friend_sync_id.to_string(), now);

    app.emit("internet-sync-received", remote_db).map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) async fn start_internet_sync_loop(app: tauri::AppHandle) {
    let state = match INTERNET_SYNC_STATE.get() {
        Some(s) => s.clone(),
        None => return,
    };
    
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    let mut active_listener: Option<u16> = None;
    
    loop {
        interval.tick().await;

        let db_payload = match load_friends_db_payload(&app) {
            Some(p) => p,
            None => continue,
        };

        let profile = match db_payload.profile {
            Some(p) => p,
            None => continue,
        };

        if profile.sync_id.is_empty() {
            continue;
        }

        if active_listener.is_none() {
            let bind_res = match tokio::net::TcpListener::bind("0.0.0.0:54321").await {
                Ok(l) => Ok(l),
                Err(_) => tokio::net::TcpListener::bind("0.0.0.0:0").await,
            };

            match bind_res {
                Ok(listener) => {
                    if let Ok(local_addr) = listener.local_addr() {
                        let port = local_addr.port();
                        active_listener = Some(port);
                        *state.bound_port.lock().unwrap() = Some(port);
                        println!("[gameindex] Internet sync host listening on port {}", port);

                        let app_clone = app.clone();
                        let state_clone = state.clone();
                        tokio::spawn(async move {
                            run_tcp_host(app_clone, state_clone, listener).await;
                        });
                    }
                }
                Err(e) => {
                    let err_msg = format!("Failed to start TCP listener: {}", e);
                    eprintln!("[gameindex] {}", err_msg);
                    *state.error_message.lock().unwrap() = Some(err_msg);
                }
            }
        }

        if let Some(port) = active_listener {
            if let Some(ext_ip) = fetch_external_ip().await {
                let current_addr = format!("{}:{}", ext_ip, port);
                let (has_changed, needs_upnp) = {
                    let last_published = state.external_ip.lock().unwrap();
                    let changed = last_published.as_ref() != Some(&ext_ip);
                    let upnp_needed = !*state.upnp_mapped.lock().unwrap();
                    (changed, upnp_needed)
                };

                if has_changed || needs_upnp {
                    {
                        *state.external_ip.lock().unwrap() = Some(ext_ip.clone());
                    }
                    
                    if let Some(local_ip) = get_local_ip_internal() {
                        let upnp_ok = map_port_upnp(local_ip, port).await;
                        *state.upnp_mapped.lock().unwrap() = upnp_ok;
                    }
                    
                    if let Err(e) = publish_address_to_kv(&profile.sync_id, &current_addr).await {
                        eprintln!("[gameindex] Failed to publish sync address to KV: {}", e);
                        *state.error_message.lock().unwrap() = Some(format!("KV publish failed: {}", e));
                    } else {
                        println!("[gameindex] Published sync address {} to KV", current_addr);
                        *state.error_message.lock().unwrap() = None;
                    }
                }
            } else {
                eprintln!("[gameindex] Failed to fetch external IP");
                *state.error_message.lock().unwrap() = Some("Could not resolve external IP".to_string());
            }
        }

        if let Some(friends) = db_payload.friends {
            let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
            for friend in friends {
                if friend.sync_id.is_empty() || friend.sync_id == profile.sync_id {
                    continue;
                }

                let last_sync = {
                    let map = state.last_synced_times.lock().unwrap();
                    map.get(&friend.sync_id).copied().unwrap_or(0)
                };

                // Sync if never synced, or synced > 5 minutes ago (300 secs)
                if now - last_sync > 300 {
                    if let Some(friend_addr) = fetch_address_from_kv(&friend.sync_id).await {
                        let app_clone = app.clone();
                        let state_clone = state.clone();
                        let f_sync_id = friend.sync_id.clone();
                        tokio::spawn(async move {
                            if let Err(e) = sync_with_friend(&app_clone, &state_clone, &f_sync_id, &friend_addr).await {
                                println!("[gameindex] Passive sync with {} failed: {}", f_sync_id, e);
                            } else {
                                println!("[gameindex] Passive sync with {} succeeded", f_sync_id);
                            }
                        });
                    }
                }
            }
        }
    }
}

